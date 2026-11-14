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

/** dfga/dfgm: tiros que defendió el jugador (como defensor asignado) y cuántos entraron. */
export const BOX_FIELDS = ['sec', 'pts', 'fgm2', 'fga2', 'fgm3', 'fga3', 'ftm', 'fta', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'fd', 'blka', 'pm', 'dfga', 'dfgm'] as const;
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
  /** Cansancio acumulado de los últimos días (0 = fresco, 1 = reventado). */
  fatigue?: number;
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
/** Sistemas de ataque y de defensa (punto 12 del proyecto). */
export type OffSystem = 'equilibrado' | 'pickroll' | 'pickpop' | 'motion' | 'pacespace' | 'poste' | 'aislamientos' | 'transicion';
export type DefSystem = 'individual' | 'zona23' | 'zona32' | 'zona131' | 'switch' | 'drop' | 'hedge' | 'blitz';
export type Pace = 'lento' | 'normal' | 'rapido';
/** Marcaje especial a un rival: negarle el balón o dos contra uno. */
export interface Special { id: number; mode: 'negar' | 'dos' }
export interface Defense {
  pressure: Level;
  focus: DefFocus;
  /** Antiguo «marcaje especial» (equivale a negar el balón). */
  mark: number | null;
  system?: DefSystem;
  special?: Special | null;
  /** Emparejamientos manuales: atacante rival → defensor propio. El resto, automático. */
  matchups?: Record<number, number>;
}
export const DEFAULT_DEFENSE: Defense = { pressure: 'normal', focus: 'equilibrada', mark: null, system: 'individual', special: null, matchups: {} };
export type Role = 'rot' | 'poco' | 'fuera';
export type Level = 'menos' | 'normal' | 'mas';
/** Multiplicadores de las órdenes del entrenador. */
export const LEVEL_MULT: Record<Level, number> = { menos: 0.55, normal: 1, mas: 1.6 };
export interface Tactics {
  /** Plan de tiro del equipo: cuánto buscar cada tipo de tiro. */
  shot: Record<ShotKind, Level>;
  /** Defensa del equipo. */
  defense?: Defense;
  offense?: OffSystem;
  pace?: Pace;
  /** Tiempos muertos automáticos: si el rival hace un parcial de `run` puntos (o los tuyos están fundidos). */
  autoTimeout?: { on: boolean; run: number };
}
export const DEFAULT_TACTICS: Tactics = {
  shot: { rim: 'normal', paint: 'normal', mid: 'normal', three: 'normal' },
  defense: { ...DEFAULT_DEFENSE },
  offense: 'equilibrado',
  pace: 'normal',
  autoTimeout: { on: true, run: 8 },
};
export interface EngineTeam {
  clubId: number;
  players: EnginePlayer[];
  /** Decisiones del entrenador (solo el club del usuario). Sin ellas, todo automático. */
  lineup?: { starters: (number | null)[]; roles: Record<number, Role>; shoot?: Record<number, Level>; minutes?: Record<number, number> };
  tactics?: Tactics;
  /** Química del equipo (0-100, 50 = normal). */
  chemistry?: number;
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
  | { at: number; side: 0 | 1; kind: 'defense'; defense: Defense }
  | { at: number; side: 0 | 1; kind: 'offense'; offense: OffSystem; pace: Pace }
  | { at: number; side: 0 | 1; kind: 'autoTimeout'; on: boolean; run: number };

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
  /** Parcial en curso de cada equipo (puntos seguidos sin que anote el rival). */
  run: [number, number];
  /** Tiempos muertos que le quedan a cada equipo en esta parte. */
  tLeft: [number, number];
  /** Emparejamientos vigentes: atacante → defensor, para cada equipo atacante. */
  match: [Record<number, number>, Record<number, number>];
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
  /** Quintetos de cada equipo: «ids ordenados» → [segundos, puntos a favor, puntos en contra]. */
  units: [Map<string, number[]>, Map<string, number[]>];
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
  /** Cansancio acumulado con el que llega al partido (0-1). */
  fat: number;
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

/* ───────────── Sistemas tácticos ───────────── */

type KindW = Record<ShotKind, number>;
const K1: KindW = { rim: 1, paint: 1, mid: 1, three: 1 };
/**
 * Efectos de cada sistema de ataque: reparto de tiros, asistencias, pérdidas, ritmo y transición.
 * Son pequeños a propósito: lo que más pesa es el encaje con los jugadores (fit).
 */
export const OFF_SYS: Record<OffSystem, { label: string; hint: string; w: KindW; ast: number; tov: number; trans: number; sec: number; usage: number }> = {
  equilibrado: { label: 'Equilibrado', hint: 'Sin sistema dominante: cada uno juega a lo suyo', w: K1, ast: 0, tov: 0, trans: 1, sec: 1, usage: 1 },
  pickroll: { label: 'Pick & Roll', hint: 'Bloqueo y continuación: necesita un buen manejador y un interior que finalice', w: { rim: 1.18, paint: 0.95, mid: 1.05, three: 0.95 }, ast: 0.12, tov: 0.03, trans: 1, sec: 1, usage: 1 },
  pickpop: { label: 'Pick & Pop', hint: 'Bloqueo y apertura: manejador y un interior que tire', w: { rim: 0.92, paint: 0.9, mid: 1.12, three: 1.12 }, ast: 0.12, tov: 0.02, trans: 1, sec: 1, usage: 1 },
  motion: { label: 'Motion', hint: 'Movimiento de balón y jugadores: pase, IQ y juego sin balón', w: K1, ast: 0.28, tov: -0.04, trans: 1, sec: 1.04, usage: 0.8 },
  pacespace: { label: 'Pace & Space', hint: 'Abrir la pista y tirar de tres: necesita tiradores', w: { rim: 1.06, paint: 0.8, mid: 0.72, three: 1.3 }, ast: 0.08, tov: 0, trans: 1.15, sec: 0.96, usage: 1 },
  poste: { label: 'Juego al poste', hint: 'Balones dentro: necesita un interior de poste bajo', w: { rim: 1.04, paint: 1.55, mid: 0.9, three: 0.88 }, ast: -0.05, tov: 0.02, trans: 0.9, sec: 1.06, usage: 1 },
  aislamientos: { label: 'Aislamientos', hint: 'Balón a la estrella: necesita un gran creador', w: { rim: 1.02, paint: 0.95, mid: 1.15, three: 0.95 }, ast: -0.3, tov: -0.02, trans: 0.95, sec: 1.05, usage: 1.6 },
  transicion: { label: 'Transición rápida', hint: 'Correr siempre: necesita velocidad y fondo físico', w: { rim: 1.12, paint: 0.95, mid: 0.9, three: 1.02 }, ast: 0.02, tov: 0.05, trans: 1.7, sec: 0.92, usage: 1 },
};
/** Efectos de cada sistema defensivo sobre el ataque rival. */
export const DEF_SYS: Record<DefSystem, { label: string; hint: string; w: KindW; make: KindW; tov: number; oreb: number; drain: number; ast: number }> = {
  individual: { label: 'Individual', hint: 'Cada uno con su par: necesita buenos defensores exteriores', w: K1, make: { rim: 0, paint: 0, mid: 0, three: 0 }, tov: 0, oreb: 0, drain: 1, ast: 0 },
  zona23: { label: 'Zona 2-3', hint: 'Cierra la pintura; deja triples. Necesita ayudas y un protector del aro', w: { rim: 0.84, paint: 0.85, mid: 1.08, three: 1.14 }, make: { rim: -0.12, paint: -0.12, mid: 0.02, three: 0.06 }, tov: 0, oreb: 0.15, drain: 0.97, ast: 0.05 },
  zona32: { label: 'Zona 3-2', hint: 'Protege el perímetro; sufre en el poste', w: { rim: 1.05, paint: 1.12, mid: 0.98, three: 0.88 }, make: { rim: 0.04, paint: 0.06, mid: 0.02, three: -0.06 }, tov: 0.02, oreb: 0.1, drain: 0.98, ast: 0 },
  zona131: { label: 'Zona 1-3-1', hint: 'Trampas en las bandas: más pérdidas, esquinas abiertas', w: { rim: 0.95, paint: 0.98, mid: 1, three: 1.08 }, make: { rim: 0, paint: 0, mid: 0, three: 0.07 }, tov: 0.16, oreb: 0.12, drain: 1.05, ast: 0.05 },
  switch: { label: 'Cambios (switch)', hint: 'Cambiar en todos los bloqueos: frena el pase, pero genera desajustes', w: K1, make: { rim: 0, paint: 0.05, mid: 0, three: -0.02 }, tov: 0.02, oreb: 0, drain: 1, ast: -0.12 },
  drop: { label: 'Drop', hint: 'El pívot se hunde: protege el aro y concede media distancia', w: { rim: 0.88, paint: 0.95, mid: 1.15, three: 1 }, make: { rim: -0.08, paint: -0.04, mid: 0.07, three: 0.02 }, tov: -0.03, oreb: -0.05, drain: 0.97, ast: 0 },
  hedge: { label: 'Hedge', hint: 'El pívot sale fuerte al manejador: más pérdidas, más desgaste', w: K1, make: { rim: 0.03, paint: 0, mid: -0.02, three: 0.03 }, tov: 0.08, oreb: 0, drain: 1.05, ast: 0.05 },
  blitz: { label: 'Blitz (2x1 al bloqueo)', hint: 'Doble marcaje al manejador: muchas pérdidas o tiros liberados', w: { rim: 1.05, paint: 1, mid: 0.95, three: 1.05 }, make: { rim: 0.06, paint: 0.04, mid: 0.04, three: 0.06 }, tov: 0.22, oreb: 0, drain: 1.08, ast: 0.15 },
};
/** Interacciones ataque contra defensa (logit en el acierto del ataque y en las pérdidas). */
export const VS: Partial<Record<OffSystem, Partial<Record<DefSystem, { make?: Partial<KindW>; tov?: number }>>>> = {
  pickroll: { drop: { make: { mid: 0.06, rim: -0.05 } }, hedge: { tov: 0.05 }, switch: { make: { paint: 0.04 } } },
  pickpop: { drop: { make: { three: 0.08, mid: 0.06 } }, switch: { make: { three: -0.04 } } },
  pacespace: { zona23: { make: { three: 0.06 } }, zona131: { make: { three: 0.04 } }, zona32: { make: { three: 0.02 } } },
  poste: { zona23: { make: { paint: -0.08 } }, switch: { make: { paint: 0.08 } } },
  aislamientos: { switch: { make: { mid: -0.03, rim: -0.03 } }, zona23: { make: { rim: -0.06, mid: -0.04 } } },
  motion: { switch: { make: { three: 0.03, rim: 0.03 } }, blitz: { make: { three: 0.05 } } },
  transicion: { zona23: { make: { rim: 0.03 } } },
};

const bigs = <X extends { p: EnginePlayer }>(ps: X[]) => ps.filter((x) => x.p.pos1 === 'PF' || x.p.pos1 === 'C' || x.p.height_cm >= 204);
const mx = (xs: number[]) => (xs.length ? Math.max(...xs) : 40);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 40);
/** Encaje de un quinteto con un sistema (misma escala que los atributos; ~50 es un quinteto normal de la ACB). */
export function offFitOf(ps: EnginePlayer[], sys: OffSystem): number {
  const L = ps.map((p) => ({ p, r: ratings(p.attrs, p.height_cm, 0) }));
  const handler = mx(L.map((x) => 0.6 * x.r.handle + 0.4 * x.r.pass));
  const B = bigs(L);
  switch (sys) {
    case 'equilibrado': return OFF_C.equilibrado;
    case 'pickroll': return 0.5 * handler + 0.5 * mx(B.map((x) => x.r.rim));
    case 'pickpop': return 0.5 * handler + 0.5 * mx(B.map((x) => Math.max(x.r.three, x.r.mid)));
    case 'motion': return mean(L.map((x) => 0.5 * x.r.pass + 0.25 * x.p.attrs.iq + 0.25 * x.p.attrs.offb));
    case 'pacespace': return mean(L.map((x) => x.r.three).sort((a, b) => b - a).slice(0, 4));
    case 'poste': return mx(L.map((x) => x.r.post));
    case 'aislamientos': return mx(L.map((x) => 0.6 * x.r.usage + 0.4 * Math.max(x.r.mid, x.r.rim, x.r.three)));
    case 'transicion': return mean(L.map((x) => (x.p.attrs.spd + x.p.attrs.agi + x.p.attrs.sta) / 3));
  }
}
export function defFitOf(ps: EnginePlayer[], sys: DefSystem): number {
  const L = ps.map((p) => ({ p, r: ratings(p.attrs, p.height_cm, 0) }));
  const B = bigs(L);
  switch (sys) {
    case 'individual': return mean(L.map((x) => x.r.perD));
    case 'zona23': return 0.5 * mean(L.map((x) => x.r.help)) + 0.5 * mx(L.map((x) => x.r.rimProt));
    case 'zona32': return mean(L.map((x) => (x.r.perD + x.r.help) / 2));
    case 'zona131': return mean(L.map((x) => (x.r.steal + x.r.help) / 2));
    case 'switch': return mean(L.map((x) => Math.min(x.r.perD, x.r.intD))) + 12;
    case 'drop': return mx(L.map((x) => x.r.rimProt));
    case 'hedge': return mean(B.map((x) => (x.p.attrs.agi + x.p.attrs.spd + x.p.attrs.pnr) / 3));
    case 'blitz': return mean(L.map((x) => x.r.steal));
  }
}
/** Encaje medio de un quinteto normal de la ACB con cada sistema (calibrado con plantillas generadas). */
export const OFF_C: Record<OffSystem, number> = { equilibrado: 0, pickroll: 79, pickpop: 76, motion: 63, pacespace: 70, poste: 87, aislamientos: 78, transicion: 62 };
export const DEF_C: Record<DefSystem, number> = { individual: 65, zona23: 83, zona32: 67, zona131: 68, switch: 69, drop: 95, hedge: 59, blitz: 66 };
/** Ventaja (logit) por encaje: ±0,012 por punto respecto a la media, con tope de ±0,12. */
export const fitBonus = (fit: number, center: number) => Math.max(-0.12, Math.min(0.12, 0.012 * (fit - center)));

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
      const fat = Math.max(0, Math.min(1, p.fatigue ?? 0));
      return {
        p, r, d, fat, energy: 1 - 0.22 * fat, fouls: 0, onCourt: false,
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
  const teamsIn = [home, away];
  const isAI = [!home.lineup, !away.lineup];
  const offSys: OffSystem[] = [home.tactics?.offense ?? 'equilibrado', away.tactics?.offense ?? 'equilibrado'];
  const paces: Pace[] = [home.tactics?.pace ?? 'normal', away.tactics?.pace ?? 'normal'];
  const autoTO = [home.tactics?.autoTimeout ?? { on: true, run: isAI[0] ? 9 : 8 }, away.tactics?.autoTimeout ?? { on: true, run: isAI[1] ? 9 : 8 }];
  const chem = [((home.chemistry ?? 50) - 50) / 50, ((away.chemistry ?? 50) - 50) / 50];
  const PACE = { lento: { sec: 1.14, trans: 0.7 }, normal: { sec: 1, trans: 1 }, rapido: { sec: 0.88, trans: 1.35 } } as const;
  /** Parciales: puntos seguidos de cada equipo sin que anote el rival. */
  const runPts: [number, number] = [0, 0];
  /** Tiempos muertos que quedan en esta parte (FIBA: 2 en la primera, 3 en la segunda, 1 por prórroga). */
  const tLeft: [number, number] = [2, 2];
  const lastTO: [number, number] = [-99, -99];
  /** Tras un tiempo muerto, unas posesiones de concentración extra. */
  const focusUntil: [number, number] = [-1, -1];
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
      // Minutos objetivo: si va por encima de lo previsto, pierde prioridad; si va por debajo, la gana.
      const target = lu.minutes?.[l.p.id];
      if (target !== undefined && target !== null) {
        if (target <= 0) v -= 80;
        else {
          const elapsed = Math.min(2400, (period - 1) * 600 + (600 - clock));
          const expected = (target * elapsed) / 2400;
          v -= 0.9 * (l.box[F.sec]! / 60 - expected);
        }
      }
    }
    return garbage() ? 100 - v - (1 - l.energy) * 40 : v;
  };

  // Quinteto inicial: asignación voraz de los mejores a cada hueco.
  const starters = new Set<number>();
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

  const units: [Map<string, number[]>, Map<string, number[]>] = [new Map(), new Map()];
  const unitOf = (s: Side) => {
    const k = s.court.map((l) => l.p.id).sort((a, b) => a - b).join(',');
    return units[s.idx].get(k) ?? units[s.idx].set(k, [0, 0, 0]).get(k)!;
  };
  const spend = (t: number) => {
    clock -= t;
    for (const s of sides) if (s.court.length === 5) unitOf(s)[0] += t;
    for (const s of sides) {
      for (const l of s.all) {
        if (l.onCourt) {
          l.box[F.sec] += t;
          const sp = specialOf(s.idx);
          const denyGuard = sp && sp.mode === 'negar' && matchOf(s.idx).get(sp.id) === l ? 1.2 : 1;
          l.energy = Math.max(0.3, l.energy - t * T.drain * (1.35 - (l.r.sta / 100) * 0.7) * PRESS[defs[s.idx]!.pressure].drain * DEF_SYS[defs[s.idx]!.system ?? 'individual'].drain * (1 + l.d.defensa / 150) * (1 + 0.25 * l.fat) * denyGuard);
        } else {
          l.energy = Math.min(1, l.energy + t * T.recover);
        }
      }
    }
  };
  const addPts = (s: Side, l: Live, n: number) => {
    l.box[F.pts] += n;
    score[s.idx] += n;
    runPts[s.idx] += n;
    runPts[1 - s.idx] = 0;
    for (const x of sides[s.idx].court) x.box[F.pm] += n;
    for (const x of sides[1 - s.idx]!.court) x.box[F.pm] -= n;
    unitOf(sides[s.idx])[1] += n;
    unitOf(sides[1 - s.idx]!)[2] += n;
  };
  const avg = (xs: Live[], f: (l: Live) => number) => xs.reduce((a, l) => a + f(l), 0) / xs.length;

  /** Marcaje especial vigente de la defensa `d` (sobre un atacante que esté en pista). */
  const specialOf = (d: number): Special | null => {
    const df = defs[d]!;
    const sp = df.special ?? (df.mark ? { id: df.mark, mode: 'negar' as const } : null);
    if (!sp) return null;
    return sides[1 - d]!.court.some((l) => l.p.id === sp.id) ? sp : null;
  };
  /**
   * Emparejamientos de la defensa `d`: atacante → defensor. Primero los manuales; después, el mejor defensor
   * exterior (o interior, si es un pívot) sobre la principal amenaza; el resto, por posición.
   */
  const matchCache: [{ key: string; m: Map<number, Live> } | null, { key: string; m: Map<number, Live> } | null] = [null, null];
  const matchOf = (d: number): Map<number, Live> => {
    const D = sides[d]!;
    const O = sides[1 - d]!;
    const manual = defs[d]!.matchups ?? {};
    const key = `${O.court.map((l) => l.p.id).join(',')}|${D.court.map((l) => l.p.id).join(',')}|${JSON.stringify(manual)}`;
    const c = matchCache[d];
    if (c && c.key === key) return c.m;
    const m = new Map<number, Live>();
    const used = new Set<Live>();
    for (const a of O.court) {
      const dId = manual[a.p.id];
      const def = dId !== undefined ? D.court.find((l) => l.p.id === dId && !used.has(l)) : undefined;
      if (def) {
        m.set(a.p.id, def);
        used.add(def);
      }
    }
    const threat = (l: Live) => l.r.usage + 0.5 * Math.max(l.r.three, l.r.mid, l.r.rim, l.r.post);
    const rest = O.court.filter((a) => !m.has(a.p.id)).sort((x, y) => threat(y) - threat(x));
    const top = rest[0];
    if (top) {
      const perimeter = top.p.pos1 === 'PG' || top.p.pos1 === 'SG' || top.p.pos1 === 'SF';
      const cand = D.court.filter((l) => !used.has(l)).sort((x, y) => (perimeter ? y.r.perD - x.r.perD : y.r.intD - x.r.intD));
      if (cand[0]) {
        m.set(top.p.id, cand[0]);
        used.add(cand[0]);
      }
    }
    for (const a of O.court) {
      if (m.has(a.p.id)) continue;
      const ai = O.court.indexOf(a);
      const cand = D.court.filter((l) => !used.has(l)).sort((x, y) => Math.abs(D.court.indexOf(x) - ai) - Math.abs(D.court.indexOf(y) - ai));
      const def = cand[0] ?? D.court[ai] ?? D.court[0]!;
      m.set(a.p.id, def);
      used.add(def);
    }
    matchCache[d] = { key, m };
    return m;
  };

  /** Rebote tras un fallo. Devuelve quién lo coge si es ofensivo; null si es defensivo. */
  const rebound = (O: Side, D: Side, base: number, blocked: boolean): Live | null => {
    const diff = avg(O.court, (l) => eff(l, l.r.oreb + 0.4 * l.d.rebote)) - avg(D.court, (l) => eff(l, l.r.dreb));
    const offensive = rng.chance(sig(logit(base) + T.bReb * diff / 20 - (blocked ? 0.3 : 0) + DEF_SYS[defs[D.idx]!.system ?? 'individual'].oreb));
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

  /** Encaje del quinteto en pista con su sistema (se recalcula solo cuando cambia el quinteto o el sistema). */
  const fitCache = new Map<string, number>();
  const fitOf = (side: number, what: 'off' | 'def'): number => {
    const S = sides[side]!;
    const sys = what === 'off' ? offSys[side]! : defs[side]!.system ?? 'individual';
    const key = `${side}${what}${sys}|${S.court.map((l) => l.p.id).join(',')}`;
    let v = fitCache.get(key);
    if (v === undefined) {
      const ps = S.court.map((l) => l.p);
      v = what === 'off' ? offFitOf(ps, sys as OffSystem) : defFitOf(ps, sys as DefSystem);
      fitCache.set(key, v);
    }
    return v;
  };

  /** Una posesión completa. Devuelve si acabó con balón vivo (opción de transición para el rival). */
  const possession = (o: 0 | 1, transitionIn: boolean): boolean => {
    const O = sides[o];
    const D = sides[1 - o]!;
    poss[o] += 1;
    let shotClock = 24;
    // Si el rival cargó el rebote ofensivo, hay más opciones de correr.
    const crash = avg(D.court, (l) => Math.max(0, l.d.rebote));
    const dd = defs[D.idx]!;
    const press = PRESS[dd.pressure];
    const os = OFF_SYS[offSys[o]!];
    const dsys = dd.system ?? 'individual';
    const ds = DEF_SYS[dsys];
    const vs = VS[offSys[o]!]?.[dsys] ?? {};
    const pace = PACE[paces[o]!];
    let sp = specialOf(D.idx);
    let M = matchOf(D.idx);
    let fitAdj = 0;
    // Rachas: quien lleva un parcial de 7 o más juega con confianza; el que lo sufre, nervioso.
    const mom = (runPts[o] >= 7 ? 0.06 : 0) + (possIdx < focusUntil[o]! ? 0.04 : 0);
    const rattled = runPts[D.idx] >= 7 ? 0.06 : 0;
    let transition = transitionIn && rng.chance(Math.min(0.5, (T.transition + 0.003 * crash) * os.trans * pace.trans));
    let putbackBy: Live | null = null;
    let nsFoulDone = false;

    for (let phase = 0; phase < 8; phase++) {
      if (clock <= 0) return false;
      // Tras una falta puede haber cambios: emparejamientos y encaje del quinteto actual.
      sp = specialOf(D.idx);
      M = matchOf(D.idx);
      fitAdj = fitBonus(fitOf(o, 'off'), OFF_C[offSys[o]!]) - fitBonus(fitOf(D.idx, 'def'), DEF_C[dsys]);
      let dur = transition ? 3 + rng.next() * 4 : Math.min(shotClock - 0.5, Math.max(3, T.possSec * os.sec * pace.sec + (rng.next() + rng.next() + rng.next() - 1.5) * T.possSd * 1.4));
      if (putbackBy) dur = 1 + rng.next() * 2;
      let buzzer = false;
      if (dur >= clock) {
        dur = clock;
        buzzer = true;
      }

      // Pérdida
      if (!putbackBy) {
        const handler = weighted(rng, O.court, (l) => Math.pow(Math.max(5, l.r.handle) / 50, 4) * (sp && sp.id === l.p.id ? (sp.mode === 'dos' ? 0.6 : 0.5) : 1));
        const spTov = sp && sp.id === handler.p.id ? (sp.mode === 'dos' ? 0.25 : 0.08) : 0;
        const pT = sig(logit(T.tov) + press.tov + os.tov + ds.tov + (vs.tov ?? 0) + rattled + spTov - 0.05 * chem[o]! - T.bTov * (eff(handler, handler.r.handle) - avg(D.court, (l) => eff(l, l.r.steal + 0.4 * l.d.robo))) / 20);
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
      const spW = (l: Live) => (sp && sp.id === l.p.id ? (sp.mode === 'dos' ? 0.45 : 0.62) : 1);
      const shooter = putbackBy ?? weighted(rng, O.court, (l) => l.usageMult * spW(l) * Math.exp(T.usageK * os.usage * (eff(l, l.r.usage + l.d.uso) - 55)));
      const slot = O.court.indexOf(shooter);
      const defender = M.get(shooter.p.id) ?? D.court[slot] ?? D.court[0]!;
      let kind: ShotKind;
      if (putbackBy) kind = rng.chance(0.85) ? 'rim' : 'paint';
      else {
        const plan = plans[o]!;
        const fw = FOCUS_W[dd.focus];
        const sw = (k: ShotKind) => shooter.kindW[k] * LEVEL_MULT[plan[k]] * fw[k] * os.w[k] * ds.w[k];
        const w = { rim: sw('rim'), paint: sw('paint'), mid: sw('mid'), three: sw('three') };
        if (transition) {
          w.rim *= 2.2;
          w.mid *= 0.5;
        }
        kind = weighted(rng, ['rim', 'paint', 'mid', 'three'] as ShotKind[], (k) => w[k]);
      }
      const corner = kind === 'three' && rng.chance(T.cornerShare + (shooter.r.three - 50) * 0.002);
      const others = O.court.filter((l) => l !== shooter);
      const teamPass = avg(others, (l) => l.r.pass + 0.5 * l.d.pase);
      const doubled = !!sp && sp.mode === 'dos' && sp.id !== shooter.p.id;
      const assistedOpp = !putbackBy && rng.chance(sig(logit(T.assistOpp[kind]) + T.bAssist * (teamPass - 50) / 20 + os.ast + ds.ast + (doubled ? 0.25 : 0)));
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
      const markAdj = !sp ? 0 : sp.id === shooter.p.id ? (sp.mode === 'dos' ? -0.32 : -0.08) : sp.mode === 'dos' ? 0.1 : 0.03;
      const sysAdj = fitAdj + ds.make[kind] + (vs.make?.[kind] ?? 0) + mom + 0.05 * chem[o]!;
      const margin = score[o] - score[1 - o];
      const clutch = period >= 4 && clock < 120 && Math.abs(margin) <= 6 ? 0.25 * (shooter.r.clutch - 50) / 50 : 0;
      let lg =
        logit(T.make[kind]) + T.bMake * (off - def) / 20 + (assistedOpp ? T.assistedBonus : -0.04) +
        (transition ? T.transitionBonus : 0) + (o === 0 ? T.homeBonus : -T.homeBonus) + clutch +
        (corner ? T.cornerBonus : 0) + (buzzer ? T.buzzerPenalty : 0) + (putbackBy ? 0.1 : 0) +
        (garbage() && margin > 0 ? T.garbageRelax : 0) - T.forcedShot * Math.log(planMult(O, kind) * (putbackBy ? 1 : shooter.usageMult)) - T.scoreRegression * Math.max(-25, Math.min(25, margin)) / 10 -
        T.forcedShot * forced + markAdj + press.make + FOCUS_MAKE[dd.focus][kind] + 0.003 * avg(D.court, (l) => l.d.robo) + sysAdj;
      const pFoul = sig(logit(T.shootFoul[kind]) + 0.4 * (shooter.r.foulDraw - 50) / 20 + 0.3 * (50 - defender.r.disc) / 20 + 0.008 * defender.d.defensa + (kind === 'rim' || kind === 'paint' ? 0.006 * avg(D.court, (l) => l.d.tapon) : 0));
      const fouled = !buzzer && rng.chance(pFoul);
      if (fouled) lg -= 0.55; // los tiros con falta entran menos
      const blocker = kind === 'rim' || kind === 'paint' ? weighted(rng, D.court, (l) => Math.pow(Math.max(5, l.r.rimProt) / 50, 4) * Math.exp(0.04 * l.d.tapon)) : defender;
      const blocked = !fouled && rng.chance(sig(logit(T.block[kind]) + T.bBlock * (eff(blocker, blocker.r.rimProt) - off) / 20 + 0.012 * blocker.d.tapon));
      const made = !blocked && rng.chance(sig(lg));
      spend(dur);

      const three = kind === 'three';
      shooter.box[three ? F.fga3 : F.fga2] += 1;
      defender.box[F.dfga] += 1;
      if (made) defender.box[F.dfgm] += 1;
      let passer: Live | null = null;
      if (made) {
        shooter.box[three ? F.fgm3 : F.fgm2] += 1;
        addPts(O, shooter, three ? 3 : 2);
        if (assistedOpp) {
          passer = weighted(rng, others, (l) => Math.pow(Math.max(5, l.r.pass) / 50, 2.5) * Math.exp(0.04 * l.d.pase) * (doubled && sp!.id === l.p.id ? 1.8 : 1));
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

  /** Pide un tiempo muerto: corta el parcial del rival, da algo de aire y unas posesiones de concentración. */
  const callTimeout = (sIdx: 0 | 1, auto: boolean) => {
    if (tLeft[sIdx] <= 0) return false;
    tLeft[sIdx] -= 1;
    lastTO[sIdx] = possIdx;
    runPts[1 - sIdx] = 0;
    focusUntil[sIdx] = possIdx + 6;
    for (const l of sides[sIdx].court) l.energy = Math.min(1, l.energy + 0.07);
    ev(EV.TIMEOUT, sIdx, 0, 0, auto ? 1 : 0);
    autoSubs(sides[sIdx]);
    return true;
  };
  /** Tiempos muertos automáticos (del ayudante en tu equipo; del entrenador rival en la IA). */
  const autoTimeouts = () => {
    for (const sIdx of [0, 1] as const) {
      const cfg = autoTO[sIdx]!;
      if (!cfg.on || tLeft[sIdx] <= 0 || clock < 20 || possIdx - lastTO[sIdx]! < 8) continue;
      const tired = avg(sides[sIdx].court, (l) => l.energy) < 0.62 && tLeft[sIdx] > 1;
      if (runPts[1 - sIdx]! >= cfg.run || tired) callTimeout(sIdx, true);
    }
  };
  /** La IA ajusta su defensa en el descanso: niega el balón (o hace 2x1) a quien más le está anotando. */
  const aiAdjust = () => {
    for (const d of [0, 1] as const) {
      if (!isAI[d] || defs[d]!.special) continue;
      const opp = sides[1 - d]!.all.reduce((a, b) => (b.box[F.pts]! > a.box[F.pts]! ? b : a));
      if (opp.box[F.pts]! >= 20) defs[d] = { ...defs[d]!, special: { id: opp.p.id, mode: 'dos' } };
      else if (opp.box[F.pts]! >= 13) defs[d] = { ...defs[d]!, special: { id: opp.p.id, mode: 'negar' } };
    }
  };

  /** Emparejamientos de la defensa d como objeto (atacante → defensor) para la pantalla. */
  const matchObj = (d: number): Record<number, number> => Object.fromEntries([...matchOf(d).entries()].map(([a, l]) => [a, l.p.id]));
  const jumpWinner: 0 | 1 = rng.chance(0.5) ? 0 : 1;
  let ot = 0;
  while (true) {
    clock = period <= 4 ? 600 : 300;
    if (period === 3) {
      tLeft[0] = 3;
      tLeft[1] = 3;
      aiAdjust();
    } else if (period >= 5) {
      tLeft[0] = 1;
      tLeft[1] = 1;
    }
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
        } else if (iv.kind === 'timeout') callTimeout(iv.side, false);
        else if (iv.kind === 'plan') plans[iv.side] = { ...iv.shot };
        else if (iv.kind === 'auto') autoOn[iv.side] = iv.on;
        else if (iv.kind === 'defense') defs[iv.side] = { ...DEFAULT_DEFENSE, ...iv.defense };
        else if (iv.kind === 'offense') {
          offSys[iv.side] = iv.offense;
          paces[iv.side] = iv.pace;
        } else if (iv.kind === 'autoTimeout') autoTO[iv.side] = { on: iv.on, run: iv.run };
      }
      autoTimeouts();
      if (timeline) {
        const energy: Record<number, number> = {};
        const fouls: Record<number, number> = {};
        for (const s of sides) for (const l of s.all) { energy[l.p.id] = Math.round(l.energy * 100) / 100; fouls[l.p.id] = l.fouls; }
        timeline.push({ i: possIdx, period, clock: Math.ceil(clock), score: [score[0], score[1]], court: [sides[0].court.map((l) => l.p.id), sides[1].court.map((l) => l.p.id)], energy, fouls, teamFouls: [sides[0].teamFouls, sides[1].teamFouls], run: [runPts[0], runPts[1]], tLeft: [tLeft[0], tLeft[1]], match: [matchObj(1), matchObj(0)] });
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
    timeline.push({ i: possIdx, period, clock: 0, score: [score[0], score[1]], court: [sides[0].court.map((l) => l.p.id), sides[1].court.map((l) => l.p.id)], energy, fouls, teamFouls: [sides[0].teamFouls, sides[1].teamFouls], run: [runPts[0], runPts[1]], tLeft: [tLeft[0], tLeft[1]], match: [matchObj(1), matchObj(0)] });
  }
  return { score, ot, poss, box, side, starters, shots, pbp, timeline, units };
}
