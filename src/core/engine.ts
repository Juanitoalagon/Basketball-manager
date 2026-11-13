/**
 * Motor de partido posesión a posesión (reglas FIBA).
 *
 * Toda probabilidad sigue la misma forma:
 *   P = sigmoide( logit(base) + beta · (ataque − defensa) / 20 + contexto )
 * "base" es la tasa media de la liga para ese suceso; con dos jugadores iguales, sale la media.
 * Las constantes están en TUNE, documentadas, y las ajusta el banco de calibración (tests/calibration).
 * Todo lo aleatorio sale de la semilla del partido: misma semilla y mismas plantillas = mismo partido.
 */
import { type Attrs, type Pos, POSITIONS, overallAt } from './attributes';
import { type ShotKind, sampleShot, zoneOf } from './court';
import { Rng } from './rng';

export const TUNE = {
  /** Aciertos base por tipo de tiro con ataque = defensa. */
  make: { rim: 0.7, paint: 0.47, mid: 0.42, three: 0.29 } as Record<ShotKind, number>,
  bMake: 0.42, // cuánto pesa 20 puntos de diferencia ataque-defensa en el acierto (logit)
  cornerBonus: 0.12, // el triple de esquina es algo más fácil
  assistedBonus: 0.18,
  transitionBonus: 0.3,
  homeBonus: 0.06,
  buzzerPenalty: -0.5,
  /** Reparto de tipos de tiro (multiplicadores globales). */
  kind: { rim: 1.0, paint: 0.42, mid: 0.48, three: 1.3 } as Record<ShotKind, number>,
  kindK: 0.055, // cuánto empuja la habilidad hacia su tipo de tiro preferido
  cornerShare: 0.27,
  /** Pérdidas por posesión (y fase tras rebote ofensivo). */
  tov: 0.165,
  bTov: 0.4,
  stealShare: 0.52,
  /** Faltas. */
  nonShootingFoul: 0.17,
  shootFoul: { rim: 0.21, paint: 0.13, mid: 0.04, three: 0.017 } as Record<ShotKind, number>,
  /** Tapones. */
  block: { rim: 0.06, paint: 0.05, mid: 0.017, three: 0.008 } as Record<ShotKind, number>,
  bBlock: 0.55,
  /** Asistencias: probabilidad de que el tiro venga de un pase. */
  assistOpp: { rim: 0.46, paint: 0.32, mid: 0.35, three: 0.78 } as Record<ShotKind, number>,
  bAssist: 0.3,
  /** Rebote ofensivo tras fallo de campo y tras último tiro libre. */
  oreb: 0.31,
  orebFt: 0.13,
  bReb: 0.55,
  putback: 0.42,
  /** Libres: acierto con atributo 60. */
  ft: 0.755,
  ftK: 0.045,
  /** Ritmo: segundos medios de una posesión en estático y probabilidad de transición. */
  possSec: 17.4,
  possSd: 4.2,
  transition: 0.14,
  /** Fatiga: gasto por segundo en pista, recuperación por segundo en el banquillo, y penalización. */
  drain: 0.00112,
  recover: 0.0016,
  fatiguePenalty: 22,
  subMargin: 2.5,
  usageK: 0.075,
  formSd: 4,
  /** Quien gana de mucho al final se relaja un poco. */
  garbageRelax: -0.25,
  /** Puntos de atributo que suma (o resta) una moral de 100 (o de 30). */
  moraleEffect: 1.5,
  /** Forzar un tipo de tiro (o a un jugador) empeora su selección; restringirlo la mejora. Por unidad de log(multiplicador). */
  forcedShot: 0.18,
  /** Regresión del marcador: quien va por delante baja algo la intensidad; quien va por detrás aprieta. Por cada 10 puntos. */
  scoreRegression: 0.09,
};

export const BOX_FIELDS = ['sec', 'pts', 'fgm2', 'fga2', 'fgm3', 'fga3', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'fd', 'blka', 'pm'] as const;
export type BoxField = (typeof BOX_FIELDS)[number];
const F = Object.fromEntries(BOX_FIELDS.map((f, i) => [f, i])) as Record<BoxField, number>;

export interface EnginePlayer {
  id: number;
  pos1: Pos;
  pos2: Pos | null;
  height_cm: number;
  attrs: Attrs;
  /** 0-100; con 65 no influye. */
  morale?: number;
  /** Tendencias ajustadas por el entrenador (escala 1-99). Las que faltan, las naturales. */
  tend?: Partial<Record<TendKey, number>>;
}

/**
 * Tendencias de jugador (1-99): con qué frecuencia busca cada cosa. Las naturales salen de sus
 * atributos (un gran tirador tiende a tirar de tres; un buen taponador, a intentar tapones).
 * Escala: tendencia = 50 + (valor del motor − centro) · pendiente. Ajustarla desplaza el valor
 * del motor en (ajustada − natural) / pendiente. Sin ajustes, el partido es exactamente el mismo.
 */
export const TEND_KEYS = ['uso', 'tres', 'media', 'aro', 'poste', 'pase', 'defensa', 'robo', 'tapon', 'rebote'] as const;
export type TendKey = (typeof TEND_KEYS)[number];
export const TEND_INFO: Record<TendKey, { label: string; hint: string; c: number; m: number }> = {
  uso: { label: 'Toques (uso)', hint: 'Cuántas posesiones acaban en sus manos', c: 55, m: 1.6 },
  tres: { label: 'Tiro de tres', hint: 'Cuánto busca el triple cuando tira', c: 50, m: 1.2 },
  media: { label: 'Media distancia', hint: 'Cuánto busca el tiro de media', c: 50, m: 1.2 },
  aro: { label: 'Penetración', hint: 'Cuánto ataca el aro', c: 50, m: 1.2 },
  poste: { label: 'Juego al poste', hint: 'Cuánto juega de espaldas en la pintura', c: 50, m: 1.2 },
  pase: { label: 'Pase', hint: 'Cuánto busca al compañero (más asistencias)', c: 50, m: 1.2 },
  defensa: { label: 'Esfuerzo defensivo', hint: 'Defiende más fuerte: mejor defensa, más cansancio y faltas', c: 50, m: 1.2 },
  robo: { label: 'Buscar robos', hint: 'Más robos y pérdidas rivales, pero más faltas', c: 50, m: 1.2 },
  tapon: { label: 'Intentar tapones', hint: 'Más tapones, pero más faltas en el tiro', c: 50, m: 1.2 },
  rebote: { label: 'Ir al rebote ofensivo', hint: 'Más rebotes ofensivos, pero el rival corre más', c: 50, m: 1.2 },
};
const tendRaw = (r: R): Record<TendKey, number> => ({
  uso: r.usage, tres: r.three, media: r.mid, aro: r.rim, poste: r.post, pase: r.pass,
  defensa: (r.perD + r.intD) / 2, robo: r.steal, tapon: r.rimProt, rebote: r.oreb,
});
export function naturalTendencies(a: Attrs, heightCm: number): Record<TendKey, number> {
  const raw = tendRaw(ratings(a, heightCm, 0));
  const out = {} as Record<TendKey, number>;
  for (const k of TEND_KEYS) out[k] = Math.max(1, Math.min(99, Math.round(50 + (raw[k] - TEND_INFO[k].c) * TEND_INFO[k].m)));
  return out;
}

/** Defensa de equipo: presión, a qué se cierra y marcaje especial a un rival. */
export type DefFocus = 'equilibrada' | 'pintura' | 'perimetro';
export interface Defense { pressure: Level; focus: DefFocus; mark: number | null }
export const DEFAULT_DEFENSE: Defense = { pressure: 'normal', focus: 'equilibrada', mark: null };
export type Role = 'rot' | 'poco' | 'fuera';
export type Level = 'menos' | 'normal' | 'mas';
/** Multiplicadores de las órdenes del entrenador. */
export const LEVEL_MULT: Record<Level, number> = { menos: 0.55, normal: 1, mas: 1.6 };
export interface Tactics {
  /** Plan de tiro del equipo: cuánto buscar cada tipo de tiro. */
  shot: Record<ShotKind, Level>;
  /** Defensa del equipo. */
  defense?: Defense;
}
export const DEFAULT_TACTICS: Tactics = { shot: { rim: 'normal', paint: 'normal', mid: 'normal', three: 'normal' }, defense: { pressure: 'normal', focus: 'equilibrada', mark: null } };
export interface EngineTeam {
  clubId: number;
  players: EnginePlayer[];
  /** Decisiones del entrenador (solo el club del usuario). Sin ellas, todo automático. */
  lineup?: { starters: (number | null)[]; roles: Record<number, Role>; shoot?: Record<number, Level> };
  tactics?: Tactics;
}

/** Reparto natural de tiros de un jugador según sus atributos (sin órdenes del entrenador). */
export function shotTendencies(a: Attrs, heightCm: number): Record<ShotKind, number> {
  const r = ratings(a, heightCm, 0);
  const ex = (x: number) => Math.exp(TUNE.kindK * (x - 50));
  const w = { rim: TUNE.kind.rim * ex(r.rim), paint: TUNE.kind.paint * ex(r.post), mid: TUNE.kind.mid * ex(r.mid), three: TUNE.kind.three * ex(r.three) };
  const t = w.rim + w.paint + w.mid + w.three;
  return { rim: w.rim / t, paint: w.paint / t, mid: w.mid / t, three: w.three / t };
}

/** Códigos del relato jugada a jugada. Cada evento: [tipo, cuarto, segundos restantes, lado, p1, p2, extra]. */
export const EV = { MADE: 1, MISS: 2, FT_MADE: 3, FT_MISS: 4, OREB: 5, DREB: 6, TOV: 7, FOUL: 8, SUB: 9, START: 10, END: 11, TIMEOUT: 12 } as const;
export const KIND_CODE: Record<ShotKind, number> = { rim: 0, paint: 1, mid: 2, three: 3 };

/** Órdenes del entrenador durante un partido en directo, aplicadas al empezar la posesión número `at`. */
export type Intervention =
  | { at: number; side: 0 | 1; kind: 'sub'; in: number; out: number }
  | { at: number; side: 0 | 1; kind: 'timeout' }
  | { at: number; side: 0 | 1; kind: 'plan'; shot: Tactics['shot'] }
  | { at: number; side: 0 | 1; kind: 'auto'; on: boolean }
  | { at: number; side: 0 | 1; kind: 'defense'; defense: Defense };

/** Foto del partido al empezar cada posesión (solo en directo). */
export interface Snapshot {
  i: number;
  period: number;
  clock: number;
  score: [number, number];
  court: [number[], number[]];
  energy: Record<number, number>;
  fouls: Record<number, number>;
  teamFouls: [number, number];
}

export interface GameResult {
  score: [number, number];
  ot: number;
  poss: [number, number];
  box: Map<number, number[]>;
  side: Map<number, 0 | 1>;
  starters: Set<number>;
  /** Por tiro: jugador, x, y, empaquetado (zona | acierto<<4 | asistido<<5 | taponado<<6 | rebote<<7 | cuarto<<8). */
  shots: number[];
  pbp: number[][] | null;
  timeline?: Snapshot[];
}

interface R {
  three: number; mid: number; rim: number; post: number; ft: number; pass: number; handle: number; usage: number;
  oreb: number; dreb: number; perD: number; intD: number; rimProt: number; steal: number; foulDraw: number;
  disc: number; sta: number; clutch: number; help: number;
}
interface Live {
  p: EnginePlayer;
  r: R;
  /** Desplazamiento de cada tendencia respecto a la natural, en unidades del motor (0 sin ajustes). */
  d: Record<TendKey, number>;
  kindW: Record<ShotKind, number>;
  usageMult: number;
  energy: number;
  fouls: number;
  box: number[];
  onCourt: boolean;
}
interface Side {
  idx: 0 | 1;
  all: Live[];
  court: Live[]; // 5, ordenados por hueco PG..C
  teamFouls: number;
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

function ratings(a: Attrs, heightCm: number, form: number): R {
  const h = (heightCm - 200) * 0.6;
  return {
    three: a.sht3 + 0.1 * (a.offb - 50) + form,
    mid: 0.7 * a.sht2 + 0.3 * a.cre + form,
    rim: 0.5 * a.fin + 0.25 * a.drive + 0.125 * (a.str + a.jmp) + h * 0.5 + form,
    post: 0.6 * a.post + 0.2 * a.str + 0.2 * a.fin + h * 0.5 + form,
    ft: a.ft + form * 0.5,
    pass: 0.5 * a.pas + 0.5 * a.vis,
    handle: 0.6 * a.hdl + 0.25 * a.iq + 0.15 * a.vis,
    usage: 0.4 * a.cre + 0.15 * a.drive + 0.15 * Math.max(a.sht3, a.sht2) + 0.15 * a.post * 0.6 + 0.15 * a.fin,
    oreb: 0.6 * a.oreb + 0.2 * a.jmp + 0.2 * a.str + h,
    dreb: 0.6 * a.dreb + 0.2 * a.jmp + 0.2 * a.str + h,
    perD: 0.55 * a.perd + 0.15 * a.agi + 0.15 * a.spd + 0.15 * a.ant,
    intD: 0.6 * a.intd + 0.2 * a.str + 0.2 * a.jmp + h * 0.5,
    rimProt: 0.4 * a.blk + 0.3 * a.intim + 0.3 * a.intd + h,
    steal: 0.5 * a.stl + 0.5 * a.ant,
    foulDraw: 0.4 * a.drive + 0.3 * a.fin + 0.3 * a.str,
    disc: a.disc,
    sta: a.sta,
    clutch: a.clutch,
    help: a.hlpd,
  };
}

function weighted<T>(rng: Rng, items: T[], w: (t: T) => number): T {
  let total = 0;
  const ws = items.map((it) => {
    const x = Math.max(1e-9, w(it));
    total += x;
    return x;
  });
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

export function simulateGame(home: EngineTeam, away: EngineTeam, seed: number, opts: { pbp?: boolean; interventions?: Intervention[]; timeline?: boolean } = {}): GameResult {
  const rng = new Rng(seed);
  const T = TUNE;
  const pbp: number[][] | null = opts.pbp ? [] : null;
  const shots: number[] = [];
  const score: [number, number] = [0, 0];
  const poss: [number, number] = [0, 0];
  let period = 1;
  let clock = 600;

  const mkSide = (t: EngineTeam, idx: 0 | 1): Side => {
    const all = t.players.map<Live>((p) => {
      const form = (rng.next() + rng.next() + rng.next() - 1.5) * T.formSd * 1.4 * (1 - p.attrs.cons / 150) + ((p.morale ?? 65) - 65) / 35 * T.moraleEffect;
      const r = ratings(p.attrs, p.height_cm, form);
      const ex = (x: number) => Math.exp(T.kindK * (x - 50));
      const d = { uso: 0, tres: 0, media: 0, aro: 0, poste: 0, pase: 0, defensa: 0, robo: 0, tapon: 0, rebote: 0 } as Record<TendKey, number>;
      if (p.tend) {
        const nat = naturalTendencies(p.attrs, p.height_cm);
        for (const k of TEND_KEYS) if (p.tend[k] !== undefined) d[k] = (p.tend[k]! - nat[k]) / TEND_INFO[k].m;
      }
      return {
        p, r, d, energy: 1, fouls: 0, onCourt: false,
        box: new Array(BOX_FIELDS.length).fill(0),
        // Sin el plan del entrenador: el plan se aplica al elegir el tiro y puede cambiar en directo.
        kindW: { rim: T.kind.rim * ex(r.rim + d.aro), paint: T.kind.paint * ex(r.post + d.poste), mid: T.kind.mid * ex(r.mid + d.media), three: T.kind.three * ex(r.three + d.tres) },
        usageMult: LEVEL_MULT[t.lineup?.shoot?.[p.id] ?? 'normal'],
      };
    });
    return { idx, all, court: [], teamFouls: 0 };
  };
  const sides: [Side, Side] = [mkSide(home, 0), mkSide(away, 1)];
  const plans: Tactics['shot'][] = [{ ...(home.tactics?.shot ?? DEFAULT_TACTICS.shot) }, { ...(away.tactics?.shot ?? DEFAULT_TACTICS.shot) }];
  const autoOn = [true, true];
  const defs: Defense[] = [{ ...DEFAULT_DEFENSE, ...home.tactics?.defense }, { ...DEFAULT_DEFENSE, ...away.tactics?.defense }];
  const PRESS = { menos: { tov: -0.22, foul: 0.85, drain: 0.93, make: -0.03 }, normal: { tov: 0, foul: 1, drain: 1, make: 0 }, mas: { tov: 0.28, foul: 1.25, drain: 1.12, make: 0.05 } } as const;
  const FOCUS_W: Record<DefFocus, Record<ShotKind, number>> = {
    equilibrada: { rim: 1, paint: 1, mid: 1, three: 1 },
    pintura: { rim: 0.82, paint: 0.85, mid: 1, three: 1.12 },
    perimetro: { rim: 1.12, paint: 1.05, mid: 0.92, three: 0.85 },
  };
  const FOCUS_MAKE: Record<DefFocus, Record<ShotKind, number>> = {
    equilibrada: { rim: 0, paint: 0, mid: 0, three: 0 },
    pintura: { rim: -0.15, paint: -0.15, mid: 0.06, three: 0.08 },
    perimetro: { rim: 0.1, paint: 0.1, mid: -0.08, three: -0.12 },
  };
  let possIdx = 0;
  const timeline: Snapshot[] | undefined = opts.timeline ? [] : undefined;
  const pending = [...(opts.interventions ?? [])].sort((a, b) => a.at - b.at);
  const planMult = (s: Side, k: ShotKind) => LEVEL_MULT[plans[s.idx]![k]];
  const ev = (type: number, side: number, p1 = 0, p2 = 0, extra = 0, y = 0) => pbp?.push([type, period, Math.ceil(clock), side, p1, p2, extra, possIdx, y]);

  const eff = (l: Live, x: number) => x - (1 - l.energy) * T.fatiguePenalty;
  // Tiempo de la basura: con el partido decidido, los dos entrenadores sacan al banquillo.
  const garbage = () => {
    const m = Math.abs(score[0] - score[1]);
    return period >= 4 && ((clock < 360 && m >= 20) || (clock < 180 && m >= 14));
  };
  const lineupOf = new Map<Live, EngineTeam['lineup']>();
  const value = (l: Live, slot: Pos) => {
    let v = overallAt(l.p.attrs, l.p, slot) - (1 - l.energy) * 40;
    const lu = lineupOf.get(l);
    if (lu) {
      // El titular elegido para un hueco tiene preferencia en él; los roles reparten el resto de minutos.
      if (lu.starters[POSITIONS.indexOf(slot)] === l.p.id) v += 6;
      const role = lu.roles[l.p.id] ?? 'rot';
      if (role === 'poco') v -= 9;
      if (role === 'fuera') v -= 80;
    }
    return garbage() ? 100 - v - (1 - l.energy) * 40 : v;
  };

  // Quinteto inicial: asignación voraz de los mejores a cada hueco.
  const starters = new Set<number>();
  const teamsIn = [home, away];
  for (const s of sides) {
    const lu = teamsIn[s.idx]!.lineup;
    if (lu) for (const l of s.all) lineupOf.set(l, lu);
    const pairs: { l: Live; slot: number; v: number }[] = [];
    s.all.forEach((l) => POSITIONS.forEach((pos, slot) => pairs.push({ l, slot, v: overallAt(l.p.attrs, l.p, pos) })));
    pairs.sort((a, b) => b.v - a.v);
    const court: (Live | undefined)[] = new Array(5).fill(undefined);
    if (lu) {
      lu.starters.forEach((id, slot) => {
        const l = s.all.find((x) => x.p.id === id);
        if (l && !l.onCourt) {
          court[slot] = l;
          l.onCourt = true;
          starters.add(l.p.id);
        }
      });
    }
    for (const pr of pairs) {
      if (court[pr.slot] || pr.l.onCourt) continue;
      court[pr.slot] = pr.l;
      pr.l.onCourt = true;
      starters.add(pr.l.p.id);
    }
    s.court = court.filter((x): x is Live => !!x);
  }

  const autoSubs = (s: Side) => {
    for (let slot = 0; slot < s.court.length; slot++) {
      const cur = s.court[slot]!;
      const pos = POSITIONS[slot]!;
      const forced = cur.fouls >= 5;
      if (!autoOn[s.idx] && !forced) continue;
      let best: Live | null = null;
      let bestV = forced ? -Infinity : value(cur, pos) + T.subMargin;
      for (const b of s.all) {
        if (b.onCourt || b.fouls >= 5) continue;
        const v = value(b, pos);
        if (v > bestV) {
          bestV = v;
          best = b;
        }
      }
      if (best) {
        cur.onCourt = false;
        best.onCourt = true;
        s.court[slot] = best;
        ev(EV.SUB, s.idx, best.p.id, cur.p.id);
      }
    }
  };

  const spend = (t: number) => {
    clock -= t;
    for (const s of sides) {
      for (const l of s.all) {
        if (l.onCourt) {
          l.box[F.sec] += t;
          l.energy = Math.max(0.3, l.energy - t * T.drain * (1.35 - (l.r.sta / 100) * 0.7) * PRESS[defs[s.idx]!.pressure].drain * (1 + l.d.defensa / 150));
        } else {
          l.energy = Math.min(1, l.energy + t * T.recover);
        }
      }
    }
  };
  const addPts = (s: Side, l: Live, n: number) => {
    l.box[F.pts] += n;
    score[s.idx] += n;
    for (const x of sides[s.idx].court) x.box[F.pm] += n;
    for (const x of sides[1 - s.idx]!.court) x.box[F.pm] -= n;
  };
  const avg = (xs: Live[], f: (l: Live) => number) => xs.reduce((a, l) => a + f(l), 0) / xs.length;

  /** Rebote tras un fallo. Devuelve quién lo coge si es ofensivo; null si es defensivo. */
  const rebound = (O: Side, D: Side, base: number, blocked: boolean): Live | null => {
    const diff = avg(O.court, (l) => eff(l, l.r.oreb + 0.4 * l.d.rebote)) - avg(D.court, (l) => eff(l, l.r.dreb));
    const offensive = rng.chance(sig(logit(base) + T.bReb * diff / 20 - (blocked ? 0.3 : 0)));
    const S = offensive ? O : D;
    const who = weighted(rng, S.court, (l) => Math.pow(Math.max(5, offensive ? l.r.oreb : l.r.dreb) / 50, 3) * (offensive ? Math.exp(0.03 * l.d.rebote) : 1));
    who.box[offensive ? F.orb : F.drb] += 1;
    ev(offensive ? EV.OREB : EV.DREB, S.idx, who.p.id);
    return offensive ? who : null;
  };

  /** Tiros libres. Devuelve 'oreb' si el último falla y lo recoge el ataque. */
  const freeThrows = (O: Side, D: Side, shooter: Live, n: number): 'end' | 'oreb' => {
    for (let i = 0; i < n; i++) {
      shooter.box[F.fta] += 1;
      const clutch = period >= 4 && clock < 120 && Math.abs(score[0] - score[1]) <= 6 ? 0.2 * (shooter.r.clutch - 50) / 50 : 0;
      if (rng.chance(sig(logit(T.ft) + T.ftK * (shooter.r.ft - 60) + clutch))) {
        shooter.box[F.ftm] += 1;
        addPts(O, shooter, 1);
        ev(EV.FT_MADE, O.idx, shooter.p.id);
      } else {
        ev(EV.FT_MISS, O.idx, shooter.p.id);
        if (i === n - 1) return rebound(O, D, T.orebFt, false) ? 'oreb' : 'end';
      }
    }
    return 'end';
  };

  const foul = (D: Side, fouler: Live, fouled: Live, shooting: boolean) => {
    fouler.box[F.pf] += 1;
    fouler.fouls += 1;
    fouled.box[F.fd] += 1;
    D.teamFouls += 1;
    ev(EV.FOUL, D.idx, fouler.p.id, fouled.p.id, shooting ? 1 : 0);
  };

  /** Una posesión completa. Devuelve si acabó con balón vivo (opción de transición para el rival). */
  const possession = (o: 0 | 1, transitionIn: boolean): boolean => {
    const O = sides[o];
    const D = sides[1 - o]!;
    poss[o] += 1;
    let shotClock = 24;
    // Si el rival cargó el rebote ofensivo, hay más opciones de correr.
    const crash = avg(D.court, (l) => Math.max(0, l.d.rebote));
    let transition = transitionIn && rng.chance(T.transition + 0.003 * crash);
    const dd = defs[D.idx]!;
    const press = PRESS[dd.pressure];
    let putbackBy: Live | null = null;
    let nsFoulDone = false;

    for (let phase = 0; phase < 8; phase++) {
      if (clock <= 0) return false;
      let dur = transition ? 3 + rng.next() * 4 : Math.min(shotClock - 0.5, Math.max(3, T.possSec + (rng.next() + rng.next() + rng.next() - 1.5) * T.possSd * 1.4));
      if (putbackBy) dur = 1 + rng.next() * 2;
      let buzzer = false;
      if (dur >= clock) {
        dur = clock;
        buzzer = true;
      }

      // Pérdida
      if (!putbackBy) {
        const handler = weighted(rng, O.court, (l) => Math.pow(Math.max(5, l.r.handle) / 50, 4));
        const pT = sig(logit(T.tov) + press.tov - T.bTov * (eff(handler, handler.r.handle) - avg(D.court, (l) => eff(l, l.r.steal + 0.4 * l.d.robo))) / 20);
        if (rng.chance(pT * (phase > 0 ? 0.6 : 1))) {
          spend(dur * (0.3 + rng.next() * 0.7));
          const who = rng.chance(0.65) ? handler : weighted(rng, O.court, (l) => 60 - l.r.handle / 2);
          who.box[F.tov] += 1;
          const pSteal = T.stealShare + 0.25 * (avg(D.court, (l) => l.r.steal) - 50) / 50;
          let stealer = 0;
          if (rng.chance(pSteal)) {
            const st = weighted(rng, D.court, (l) => Math.pow(Math.max(5, l.r.steal) / 50, 3) * Math.exp(0.03 * l.d.robo));
            st.box[F.stl] += 1;
            stealer = st.p.id;
          }
          ev(EV.TOV, o, who.p.id, stealer);
          if (!stealer) {
            autoSubs(O);
            autoSubs(D);
          }
          return stealer !== 0;
        }
      }

      // Falta sin tiro
      if (!nsFoulDone && !putbackBy && !buzzer && rng.chance(T.nonShootingFoul * press.foul * Math.exp(0.006 * avg(D.court, (l) => l.d.defensa + l.d.robo)))) {
        nsFoulDone = true;
        const t = Math.max(1, dur * rng.next() * 0.8);
        spend(t);
        shotClock = Math.max(14, shotClock - t);
        const fouler = weighted(rng, D.court, (l) => (110 - l.r.disc) * Math.exp(0.02 * (l.d.defensa + l.d.robo)));
        const fouled = weighted(rng, O.court, (l) => l.r.foulDraw);
        foul(D, fouler, fouled, false);
        autoSubs(O);
        autoSubs(D);
        if (D.teamFouls > 4) {
          const res = freeThrows(O, D, fouled, 2);
          if (res === 'end') return false;
          shotClock = 14;
          continue;
        }
        if (clock <= 0) return false;
        continue;
      }

      // Tiro
      const shooter = putbackBy ?? weighted(rng, O.court, (l) => l.usageMult * (l.p.id === dd.mark ? 0.6 : 1) * Math.exp(T.usageK * (eff(l, l.r.usage + l.d.uso) - 55)));
      const slot = O.court.indexOf(shooter);
      const defender = D.court[slot] ?? D.court[0]!;
      let kind: ShotKind;
      if (putbackBy) kind = rng.chance(0.85) ? 'rim' : 'paint';
      else {
        const plan = plans[o]!;
        const fw = FOCUS_W[dd.focus];
        const w = { rim: shooter.kindW.rim * LEVEL_MULT[plan.rim] * fw.rim, paint: shooter.kindW.paint * LEVEL_MULT[plan.paint] * fw.paint, mid: shooter.kindW.mid * LEVEL_MULT[plan.mid] * fw.mid, three: shooter.kindW.three * LEVEL_MULT[plan.three] * fw.three };
        if (transition) {
          w.rim *= 2.2;
          w.mid *= 0.5;
        }
        kind = weighted(rng, ['rim', 'paint', 'mid', 'three'] as ShotKind[], (k) => w[k]);
      }
      const corner = kind === 'three' && rng.chance(T.cornerShare + (shooter.r.three - 50) * 0.002);
      const others = O.court.filter((l) => l !== shooter);
      const teamPass = avg(others, (l) => l.r.pass + 0.5 * l.d.pase);
      const assistedOpp = !putbackBy && rng.chance(sig(logit(T.assistOpp[kind]) + T.bAssist * (teamPass - 50) / 20));
      const off = eff(shooter, kind === 'three' ? shooter.r.three : kind === 'mid' ? shooter.r.mid : kind === 'rim' ? shooter.r.rim : shooter.r.post);
      const help = avg(D.court, (l) => l.r.help);
      const rimP = Math.max(...D.court.map((l) => eff(l, l.r.rimProt)));
      const effort = 0.15 * defender.d.defensa;
      const def =
        effort +
        (kind === 'three' || kind === 'mid'
          ? 0.7 * eff(defender, defender.r.perD) + 0.3 * help
          : kind === 'rim'
            ? 0.4 * eff(defender, defender.r.intD) + 0.6 * rimP
            : 0.5 * eff(defender, defender.r.intD) + 0.5 * rimP);
      const kindD = kind === 'three' ? shooter.d.tres : kind === 'mid' ? shooter.d.media : kind === 'rim' ? shooter.d.aro : shooter.d.poste;
      const forced = putbackBy ? 0 : T.usageK * shooter.d.uso + T.kindK * kindD;
      const markAdj = dd.mark === null ? 0 : shooter.p.id === dd.mark ? -0.22 : 0.04;
      const margin = score[o] - score[1 - o];
      const clutch = period >= 4 && clock < 120 && Math.abs(margin) <= 6 ? 0.25 * (shooter.r.clutch - 50) / 50 : 0;
      let lg =
        logit(T.make[kind]) + T.bMake * (off - def) / 20 + (assistedOpp ? T.assistedBonus : -0.04) +
        (transition ? T.transitionBonus : 0) + (o === 0 ? T.homeBonus : -T.homeBonus) + clutch +
        (corner ? T.cornerBonus : 0) + (buzzer ? T.buzzerPenalty : 0) + (putbackBy ? 0.1 : 0) +
        (garbage() && margin > 0 ? T.garbageRelax : 0) - T.forcedShot * Math.log(planMult(O, kind) * (putbackBy ? 1 : shooter.usageMult)) - T.scoreRegression * Math.max(-25, Math.min(25, margin)) / 10 -
        T.forcedShot * forced + markAdj + press.make + FOCUS_MAKE[dd.focus][kind] + 0.003 * avg(D.court, (l) => l.d.robo);
      const pFoul = sig(logit(T.shootFoul[kind]) + 0.4 * (shooter.r.foulDraw - 50) / 20 + 0.3 * (50 - defender.r.disc) / 20 + 0.008 * defender.d.defensa + (kind === 'rim' || kind === 'paint' ? 0.006 * avg(D.court, (l) => l.d.tapon) : 0));
      const fouled = !buzzer && rng.chance(pFoul);
      if (fouled) lg -= 0.55; // los tiros con falta entran menos
      const blocker = kind === 'rim' || kind === 'paint' ? weighted(rng, D.court, (l) => Math.pow(Math.max(5, l.r.rimProt) / 50, 4) * Math.exp(0.04 * l.d.tapon)) : defender;
      const blocked = !fouled && rng.chance(sig(logit(T.block[kind]) + T.bBlock * (eff(blocker, blocker.r.rimProt) - off) / 20 + 0.012 * blocker.d.tapon));
      const made = !blocked && rng.chance(sig(lg));
      spend(dur);

      const three = kind === 'three';
      shooter.box[three ? F.fga3 : F.fga2] += 1;
      let passer: Live | null = null;
      if (made) {
        shooter.box[three ? F.fgm3 : F.fgm2] += 1;
        addPts(O, shooter, three ? 3 : 2);
        if (assistedOpp) {
          passer = weighted(rng, others, (l) => Math.pow(Math.max(5, l.r.pass) / 50, 2.5) * Math.exp(0.04 * l.d.pase));
          passer.box[F.ast] += 1;
        }
      }
      if (blocked) {
        blocker.box[F.blk] += 1;
        shooter.box[F.blka] += 1;
      }
      const pt = sampleShot(rng, kind, { corner });
      const zone = zoneOf(pt.x, pt.y);
      shots.push(shooter.p.id, pt.x, pt.y, zone | (made ? 16 : 0) | (passer ? 32 : 0) | (blocked ? 64 : 0) | (putbackBy ? 128 : 0) | (Math.min(period, 15) << 8));
      ev(made ? EV.MADE : EV.MISS, o, shooter.p.id, passer?.p.id ?? (blocked ? blocker.p.id : 0), KIND_CODE[kind] + (three ? 30 : 20) + (blocked ? 100 : 0) + (pt.x + 100) * 1000, pt.y);
      putbackBy = null;
      transition = false;

      if (fouled) {
        const fouler = kind === 'rim' || kind === 'paint' ? (rng.chance(0.5) ? defender : blocker) : defender;
        foul(D, fouler, shooter, true);
        autoSubs(O);
        autoSubs(D);
        const res = freeThrows(O, D, shooter, made ? 1 : three ? 3 : 2);
        if (res === 'end') {
          autoSubs(O);
          autoSubs(D);
          return false;
        }
        shotClock = 14;
        continue;
      }
      if (made) {
        autoSubs(O);
        autoSubs(D);
        return false;
      }
      if (clock <= 0) return false;
      const orebBy = rebound(O, D, T.oreb, blocked);
      if (orebBy) {
        shotClock = 14;
        if (rng.chance(T.putback)) putbackBy = orebBy;
        continue;
      }
      return true;
    }
    return false;
  };

  const jumpWinner: 0 | 1 = rng.chance(0.5) ? 0 : 1;
  let ot = 0;
  while (true) {
    clock = period <= 4 ? 600 : 300;
    for (const s of sides) {
      s.teamFouls = 0;
      const rest = period === 3 ? 0.35 : 0.18;
      for (const l of s.all) l.energy = Math.min(1, l.energy + rest);
      if (period > 1) autoSubs(s);
    }
    ev(EV.START, 0);
    let o: 0 | 1 = period === 1 || period === 3 ? jumpWinner : period <= 4 ? ((1 - jumpWinner) as 0 | 1) : rng.chance(0.5) ? 0 : 1;
    let live = false;
    while (clock > 0) {
      // Órdenes del entrenador pendientes para esta posesión.
      while (pending.length && pending[0]!.at <= possIdx) {
        const iv = pending.shift()!;
        const s = sides[iv.side];
        if (iv.kind === 'sub') {
          const out = s.court.findIndex((l) => l.p.id === iv.out);
          const inn = s.all.find((l) => l.p.id === iv.in && !l.onCourt && l.fouls < 5);
          if (out >= 0 && inn) {
            s.court[out]!.onCourt = false;
            ev(EV.SUB, s.idx, inn.p.id, s.court[out]!.p.id);
            inn.onCourt = true;
            s.court[out] = inn;
          }
        } else if (iv.kind === 'timeout') {
          for (const l of s.court) l.energy = Math.min(1, l.energy + 0.07);
          ev(EV.TIMEOUT, s.idx);
        } else if (iv.kind === 'plan') plans[iv.side] = { ...iv.shot };
        else if (iv.kind === 'auto') autoOn[iv.side] = iv.on;
        else if (iv.kind === 'defense') defs[iv.side] = { ...iv.defense };
      }
      if (timeline) {
        const energy: Record<number, number> = {};
        const fouls: Record<number, number> = {};
        for (const s of sides) for (const l of s.all) { energy[l.p.id] = Math.round(l.energy * 100) / 100; fouls[l.p.id] = l.fouls; }
        timeline.push({ i: possIdx, period, clock: Math.ceil(clock), score: [score[0], score[1]], court: [sides[0].court.map((l) => l.p.id), sides[1].court.map((l) => l.p.id)], energy, fouls, teamFouls: [sides[0].teamFouls, sides[1].teamFouls] });
      }
      live = possession(o, live);
      possIdx++;
      o = (1 - o) as 0 | 1;
    }
    ev(EV.END, 0);
    if (period >= 4 && score[0] !== score[1]) break;
    if (period >= 4) ot += 1;
    period += 1;
    if (period > 20) break; // salvaguarda
  }

  const box = new Map<number, number[]>();
  const side = new Map<number, 0 | 1>();
  for (const s of sides) {
    for (const l of s.all) {
      const b = Array.from(l.box);
      b[F.sec] = Math.round(b[F.sec]!);
      box.set(l.p.id, b);
      side.set(l.p.id, s.idx);
    }
    // Los segundos redondeados deben sumar exactamente 5 × duración del partido.
    const total = (2400 + ot * 300) * 5;
    const rows = s.all.map((l) => box.get(l.p.id)!);
    const diff = total - rows.reduce((a, b) => a + b[F.sec]!, 0);
    if (diff !== 0) rows.reduce((a, b) => (b[F.sec]! > a[F.sec]! ? b : a))[F.sec]! += diff;
  }
  if (timeline) {
    const energy: Record<number, number> = {};
    const fouls: Record<number, number> = {};
    for (const s of sides) for (const l of s.all) { energy[l.p.id] = Math.round(l.energy * 100) / 100; fouls[l.p.id] = l.fouls; }
    timeline.push({ i: possIdx, period, clock: 0, score: [score[0], score[1]], court: [sides[0].court.map((l) => l.p.id), sides[1].court.map((l) => l.p.id)], energy, fouls, teamFouls: [sides[0].teamFouls, sides[1].teamFouls] });
  }
  return { score, ot, poss, box, side, starters, shots, pbp, timeline };
}
