/**
 * Partido en directo. El motor simula el partido entero con tus órdenes; la pantalla lo va mostrando
 * posesión a posesión. Cada orden nueva (cambio, tiempo muerto, plan de tiro) se aplica en la posesión
 * actual y el resto del partido se vuelve a simular desde ahí: lo ya jugado no cambia.
 *
 * Lo visual: una pista completa donde aparecen los tiros de los dos equipos (el último, resaltado),
 * la evolución del marcador y las caras de tus cinco en pista con su cansancio y sus faltas.
 */
import { useEffect, useMemo, useState } from 'react';
import { COURT, CORNER_Y } from '../core/court';
import { DEFAULT_DEFENSE, type DefFocus, type Defense, EV, type Intervention, type Level, type Snapshot, type Tactics } from '../core/engine';
import { COMP_INFO } from '../core/names';
import { call } from '../db/client';
import { Face, parseColors } from './Face';
import { Loading, type Nav, Tabs, clock, shortName } from './kit';
import { DEF_HELP, FOCUS, PRESSURE } from './tactics';
import { PreviewView } from './preview';
import { pbpText } from './screens';

interface Person { id: number; name: string; number: number | null; pos1: string; ovr: number; nationality: string; birth_year: number; origin: string }
interface Info {
  game: { id: number; home_id: number; away_id: number; stage: string; day: number; competition_id: number };
  userSide: 0 | 1;
  people: Person[];
  clubs: { id: number; name: string; short: string; colors: string | null }[];
  roster: [number[], number[]];
  options: number[];
  season: number;
  meta: Record<number, { atPos: number[]; arch: string }>;
}
interface Sim { score: [number, number]; ot: number; pbp: number[][]; timeline: Snapshot[] }

const SPEEDS: [string, string][] = [['1400', 'Lento'], ['600', 'Normal'], ['150', 'Rápido']];
const KIND: [keyof Tactics['shot'], string][] = [['three', 'Triples'], ['mid', 'Media'], ['paint', 'Pintura'], ['rim', 'Aro']];

/* ───────────── Pista completa ───────────── */

// Pista FIBA en decímetros: 280 × 150. El local ataca la canasta derecha y el visitante la izquierda.
const CL = 280;
const CW = 150;
const RIM_IN = -COURT.baseline; // 16 dm desde la línea de fondo
/** Coordenadas del tiro (x lateral, y desde el aro) a la pista completa. */
function toCourt(side: number, x: number, y: number): [number, number] {
  return side === 0 ? [CL - RIM_IN - y, CW / 2 + x] : [RIM_IN + y, CW / 2 - x];
}

function hexDist(a: string, b: string) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}
/** Color de cada equipo en la pista: el principal, salvo que se parezcan demasiado. */
function teamInk(home: string | null, away: string | null): [string, string] {
  const h = parseColors(home);
  const a = parseColors(away);
  const pick = (c: [string, string, string]) => (c[0].toLowerCase() === '#ffffff' ? c[1] : c[0]);
  const hc = pick(h);
  let ac = pick(a);
  if (hexDist(hc, ac) < 120) ac = a[1].toLowerCase() === '#ffffff' ? a[2] : a[1];
  if (hexDist(hc, ac) < 120) ac = '#ffffff';
  return [hc, ac];
}

function CourtMarks() {
  const r3 = COURT.three;
  const cy = CORNER_Y;
  const kl = COURT.ftLineY + RIM_IN; // largo de la zona: 5,8 m
  return (
    <g fill="none" stroke="var(--courtline)" strokeWidth="0.7">
      <rect x="0.5" y="0.5" width={CL - 1} height={CW - 1} />
      <line x1={CL / 2} y1="0" x2={CL / 2} y2={CW} />
      <circle cx={CL / 2} cy={CW / 2} r="18" />
      {/* Izquierda */}
      <rect x="0" y={CW / 2 - COURT.laneHalf} width={kl} height={COURT.laneHalf * 2} />
      <circle cx={kl} cy={CW / 2} r="18" />
      <path d={`M0 ${CW / 2 - COURT.corner}H${RIM_IN + cy}A${r3} ${r3} 0 0 1 ${RIM_IN + cy} ${CW / 2 + COURT.corner}H0`} />
      <path d={`M${RIM_IN} ${CW / 2 - COURT.rim}A${COURT.rim} ${COURT.rim} 0 0 1 ${RIM_IN} ${CW / 2 + COURT.rim}`} />
      <line x1={RIM_IN - 4} y1={CW / 2 - 9} x2={RIM_IN - 4} y2={CW / 2 + 9} strokeWidth="1.2" />
      <circle cx={RIM_IN} cy={CW / 2} r="2.3" stroke="#f08a3c" />
      {/* Derecha */}
      <rect x={CL - kl} y={CW / 2 - COURT.laneHalf} width={kl} height={COURT.laneHalf * 2} />
      <circle cx={CL - kl} cy={CW / 2} r="18" />
      <path d={`M${CL} ${CW / 2 - COURT.corner}H${CL - RIM_IN - cy}A${r3} ${r3} 0 0 0 ${CL - RIM_IN - cy} ${CW / 2 + COURT.corner}H${CL}`} />
      <path d={`M${CL - RIM_IN} ${CW / 2 - COURT.rim}A${COURT.rim} ${COURT.rim} 0 0 0 ${CL - RIM_IN} ${CW / 2 + COURT.rim}`} />
      <line x1={CL - RIM_IN + 4} y1={CW / 2 - 9} x2={CL - RIM_IN + 4} y2={CW / 2 + 9} strokeWidth="1.2" />
      <circle cx={CL - RIM_IN} cy={CW / 2} r="2.3" stroke="#f08a3c" />
    </g>
  );
}

interface ShotEv { k: number; side: number; x: number; y: number; made: boolean; period: number; who: number; pts: number }

function LiveCourt({ shots, ink, period, shorts, names }: { shots: ShotEv[]; ink: [string, string]; period: number; shorts: [string, string]; names: Record<number, string> }) {
  const [scope, setScope] = useState<'q' | 'all'>('q');
  const visible = scope === 'all' ? shots : shots.filter((s) => s.period === period);
  const last = shots[shots.length - 1];
  const madePct = (side: number) => {
    const xs = visible.filter((s) => s.side === side);
    return xs.length ? `${xs.filter((s) => s.made).length}/${xs.length}` : '0/0';
  };
  return (
    <div className="court-live">
      <svg viewBox={`0 0 ${CL} ${CW}`} role="img" aria-label="Tiros del partido en la pista">
        <rect x="0" y="0" width={CL} height={CW} fill="var(--court)" rx="3" />
        <text x={CL * 0.25} y={CW / 2 + 4} textAnchor="middle" fontSize="13" fontWeight="800" fill={ink[1]} opacity="0.22">{shorts[1]}</text>
        <text x={CL * 0.75} y={CW / 2 + 4} textAnchor="middle" fontSize="13" fontWeight="800" fill={ink[0]} opacity="0.22">{shorts[0]}</text>
        <CourtMarks />
        {visible.map((s) => {
          const [cx, cy] = toCourt(s.side, s.x, s.y);
          const c = ink[s.side]!;
          return s.made
            ? <circle key={s.k} cx={cx} cy={cy} r="2.4" fill={c} stroke="rgba(0,0,0,0.55)" strokeWidth="0.5" opacity={s === last ? 1 : 0.85} />
            : <g key={s.k} stroke={c} strokeWidth="0.9" opacity={s === last ? 1 : 0.7}><line x1={cx - 1.8} y1={cy - 1.8} x2={cx + 1.8} y2={cy + 1.8} /><line x1={cx - 1.8} y1={cy + 1.8} x2={cx + 1.8} y2={cy - 1.8} /></g>;
        })}
        {last && (() => {
          const [cx, cy] = toCourt(last.side, last.x, last.y);
          const lx = Math.max(24, Math.min(CL - 24, cx));
          return (
            <g key={`p${last.k}`}>
              <circle className="pulse" cx={cx} cy={cy} r="2.4" stroke={ink[last.side]} />
              <text className="lbl" x={lx} y={cy < 14 ? cy + 11 : cy - 5} textAnchor="middle">
                {(names[last.who] ?? '').split(' ').slice(-1)[0]} {last.made ? `+${last.pts}` : '✗'}
              </text>
            </g>
          );
        })()}
      </svg>
      <div className="row tight" style={{ justifyContent: 'space-between', marginTop: 4 }}>
        <span className="small muted">● anotado · ✕ fallado · {shorts[1]} {madePct(1)} · {shorts[0]} {madePct(0)}</span>
        <Tabs<'q' | 'all'> small value={scope} onChange={setScope} options={[['q', 'Este cuarto'], ['all', 'Todo']]} />
      </div>
    </div>
  );
}

/** Evolución de la diferencia en el marcador (local − visitante) hasta la posesión actual. */
function GameFlow({ timeline, cursor, total, ink, shorts }: { timeline: Snapshot[]; cursor: number; total: number; ink: [string, string]; shorts: [string, string] }) {
  const W = 300;
  const H = 70;
  const pts = timeline.filter((t) => t.i <= cursor);
  const maxAbs = Math.max(8, ...timeline.map((t) => Math.abs(t.score[0] - t.score[1])));
  const X = (i: number) => (i / Math.max(1, total)) * W;
  const Y = (d: number) => H / 2 - (d / maxAbs) * (H / 2 - 4);
  const path = pts.map((t, k) => `${k ? 'L' : 'M'}${X(t.i).toFixed(1)} ${Y(t.score[0] - t.score[1]).toFixed(1)}`).join('');
  const qs = timeline.filter((t, k) => k > 0 && t.period !== timeline[k - 1]!.period).map((t) => t.i);
  const lastPt = pts[pts.length - 1];
  return (
    <div className="flow">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Evolución del marcador">
        <defs>
          <clipPath id="up"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id="dn"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        {qs.map((i) => <line key={i} x1={X(i)} x2={X(i)} y1="0" y2={H} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {lastPt && (
          <>
            <path d={`${path}L${X(lastPt.i)} ${H / 2}L0 ${H / 2}Z`} fill={ink[0]} opacity="0.35" clipPath="url(#up)" />
            <path d={`${path}L${X(lastPt.i)} ${H / 2}L0 ${H / 2}Z`} fill={ink[1]} opacity="0.35" clipPath="url(#dn)" />
            <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="row tight small muted" style={{ justifyContent: 'space-between', marginTop: 0 }}>
        <span>▲ manda {shorts[0]}</span>
        <span>▼ manda {shorts[1]}</span>
      </div>
    </div>
  );
}

function Energy({ e }: { e: number }) {
  return <div className="fat"><i style={{ width: `${Math.round(e * 100)}%` }} className={e < 0.6 ? 'low' : e < 0.75 ? 'mid' : ''} /></div>;
}

/** Cara generada; los jugadores reales llevan solo su dorsal (no inventamos su aspecto). */
function PFace({ p, age, colors, size }: { p: Person; age: number; colors: string | null; size: number }) {
  if (p.origin === 'real') {
    const c = parseColors(colors);
    return <span className="face" style={{ width: size, height: size * 1.5, display: 'grid', placeItems: 'center', background: c[0], color: c[1], borderRadius: 8, fontWeight: 800 }}>{p.number ?? ''}</span>;
  }
  return <Face id={p.id} nationality={p.nationality} age={age} colors={colors} size={size} />;
}

/* ───────────── Pantalla ───────────── */

export function LiveScreen({ nav, onDone }: { nav: Nav; onDone: (gameId: number) => void }) {
  const [gameId, setGameId] = useState<number | undefined>(undefined);
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [ivs, setIvs] = useState<Intervention[]>([]);
  const [sim, setSim] = useState<Sim | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('600');
  const [pick, setPick] = useState<number | null>(null);
  const [plan, setPlan] = useState<Tactics['shot'] | null>(null);
  const [def, setDef] = useState<Defense>(DEFAULT_DEFENSE);
  const [showPrev, setShowPrev] = useState(true);
  const [auto, setAuto] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setInfo(undefined);
    setSim(null);
    setIvs([]);
    setCursor(0);
    setPlaying(false);
    void call<Info | null>('liveStart', { gameId }).then(async (i) => {
      setInfo(i);
      if (i) {
        const clubId = i.userSide === 0 ? i.game.home_id : i.game.away_id;
        const t = await call<Tactics>('tactics', { clubId });
        setPlan(t.shot);
        setDef({ ...DEFAULT_DEFENSE, ...t.defense, mark: null });
      }
    }).catch((e: Error) => setErr(e.message));
  }, [gameId]);
  useEffect(() => {
    if (!info) return;
    void call<Sim>('liveSim', { interventions: ivs }).then(setSim).catch((e: Error) => setErr(e.message));
  }, [info, ivs]);
  const last = sim ? sim.timeline.length - 1 : 0;
  useEffect(() => {
    if (!playing || !sim) return;
    if (cursor >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setCursor((c) => Math.min(last, c + 1)), Number(speed));
    return () => clearTimeout(t);
  }, [playing, cursor, sim, speed, last]);

  const people = useMemo(() => new Map(info?.people.map((p) => [p.id, p]) ?? []), [info]);
  const names = useMemo(() => Object.fromEntries(info?.people.map((p) => [p.id, p.name]) ?? []), [info]);
  // Estadística de cada jugador hasta la posesión actual, sacada del relato.
  const stats = useMemo(() => {
    const m = new Map<number, { pts: number; reb: number; ast: number; fgm: number; fga: number }>();
    const g = (id: number) => m.get(id) ?? m.set(id, { pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0 }).get(id)!;
    for (const e of sim?.pbp ?? []) {
      if (e[7]! >= cursor) break;
      if (e[0] === EV.MADE) {
        g(e[4]!).pts += Math.floor((e[6]! % 100) / 10);
        g(e[4]!).fgm += 1;
        g(e[4]!).fga += 1;
        if (e[5]) g(e[5]).ast += 1;
      } else if (e[0] === EV.MISS) g(e[4]!).fga += 1;
      else if (e[0] === EV.FT_MADE) g(e[4]!).pts += 1;
      else if (e[0] === EV.OREB || e[0] === EV.DREB) g(e[4]!).reb += 1;
    }
    return m;
  }, [sim, cursor]);
  const shots = useMemo<ShotEv[]>(() => {
    const out: ShotEv[] = [];
    (sim?.pbp ?? []).forEach((e, k) => {
      if (e[7]! >= cursor || (e[0] !== EV.MADE && e[0] !== EV.MISS)) return;
      out.push({ k, side: e[3]!, x: Math.floor(e[6]! / 1000) - 100, y: e[8] ?? 0, made: e[0] === EV.MADE, period: e[1]!, who: e[4]!, pts: Math.floor((e[6]! % 100) / 10) });
    });
    return out;
  }, [sim, cursor]);

  if (info === undefined) return <><Loading error={err} /></>;
  if (info === null) {
    return (
      <div>
        <button className="back" onClick={nav.back}>‹ Volver</button>
        <p className="muted">Tu equipo no juega en la próxima jornada.</p>
      </div>
    );
  }
  if (!sim || !plan) return <Loading error={err} />;
  const side = info.userSide;
  const snap = sim.timeline[Math.min(cursor, last)]!;
  const finished = cursor >= last;
  const club = (i: 0 | 1) => info.clubs.find((c) => c.id === (i === 0 ? info.game.home_id : info.game.away_id))!;
  const ink = teamInk(club(0).colors, club(1).colors);
  const shorts: [string, string] = [club(0).short, club(1).short];
  const timeoutsUsed = ivs.filter((i) => i.kind === 'timeout').length;
  const add = (iv: Omit<Intervention, 'at' | 'side'>) => {
    setPlaying(false);
    setIvs((xs) => [...xs, { ...(iv as Intervention), at: cursor, side }]);
  };
  const court = snap.court[side];
  const opp = snap.court[side === 0 ? 1 : 0];
  const pickSlot = pick !== null ? court.indexOf(pick) : -1;
  // Banquillo ordenado por su media en el puesto del que sale (los eliminados, al final).
  const bench = info.roster[side].filter((id) => !court.includes(id)).sort((a, b) =>
    Number((snap.fouls[a] ?? 0) >= 5) - Number((snap.fouls[b] ?? 0) >= 5) ||
    (pickSlot >= 0 ? (info.meta[b]?.atPos[pickSlot] ?? 0) - (info.meta[a]?.atPos[pickSlot] ?? 0) : 0));
  // El rival que más daño está haciendo (puntos, rebotes y asistencias).
  const oppAll = info.roster[side === 0 ? 1 : 0];
  const heat = (id: number) => { const x = stats.get(id); return x ? x.pts + 0.5 * x.reb + 0.7 * x.ast : 0; };
  const hot = [...oppAll].sort((a, b) => heat(b) - heat(a))[0];
  const hotS = hot !== undefined ? stats.get(hot) : undefined;
  const setDefense = (d: Defense) => { setDef(d); add({ kind: 'defense', defense: d } as Intervention); };
  const events = sim.pbp.filter((e) => e[7]! < cursor && (e[0] !== EV.SUB || e[3] === side)).slice(-14).reverse();
  const lastPlay = events.find((e) => e[0] !== EV.START && e[0] !== EV.END);
  const periodLabel = snap.period <= 4 ? `${snap.period}º cuarto` : snap.period === 5 ? 'Prórroga' : `${snap.period - 4}ª prórroga`;
  const toPeriodEnd = () => {
    const nxt = sim.timeline.find((t) => t.i > cursor && t.period > snap.period);
    setCursor(nxt ? nxt.i : last);
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = await call<{ gameId: number }>('liveFinish', { interventions: ivs });
      onDone(r.gameId);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };
  const myColors = club(side).colors;
  const age = (p: Person) => info.season - p.birth_year;
  const doSub = (inId: number) => {
    if (pick === null) return;
    if (auto) {
      setAuto(false);
      add({ kind: 'auto', on: false } as Intervention);
    }
    add({ kind: 'sub', in: inId, out: pick } as Intervention);
    setPick(null);
  };

  return (
    <div className="live-screen">
      <button className="back" onClick={() => { if (finished || ivs.length === 0 && cursor === 0 || confirm('Si sales ahora no se guarda nada: el partido se simulará normal al avanzar. ¿Salir?')) nav.back(); }}>‹ Salir</button>
      {info.options.length > 1 && cursor === 0 && ivs.length === 0 && (
        <div className="gamepick">
          <span className="muted small">Hoy juegas {info.options.length} partidos. Elige cuál ver en directo (el otro se simula):</span>
          {info.options.map((id) => (
            <button key={id} className={id === info.game.id ? '' : 'sec'} onClick={() => setGameId(id)}>{id === info.game.id ? '✓ ' : ''}Partido {info.options.indexOf(id) + 1}</button>
          ))}
        </div>
      )}
      <div className="lv">
      <div className="lv-left">
      <section className="hero">
        <div className="muted small" style={{ textAlign: 'center' }}>{COMP_INFO[info.game.competition_id]?.name ?? ''} · día {info.game.day}</div>
        <div className="scorebug">
          <div className="t"><span className="sw" style={{ background: ink[0] }} /><span className={side === 0 ? '' : 'muted'}>{club(0).short}</span></div>
          <div>
            <div className="sc">{snap.score[0]} - {snap.score[1]}</div>
            <div className="clk">{finished ? 'Final' : `${periodLabel} · ${clock(snap.clock)}`} · faltas {snap.teamFouls[0]}-{snap.teamFouls[1]}</div>
          </div>
          <div className="t r"><span className={side === 1 ? '' : 'muted'}>{club(1).short}</span><span className="sw" style={{ background: ink[1] }} /></div>
        </div>
        <LiveCourt shots={shots} ink={ink} period={snap.period} shorts={shorts} names={names} />
        <p className="lastplay">{lastPlay ? <><span className="muted">{clock(lastPlay[2]!)} · {shorts[lastPlay[3]!]}</span> {pbpText(lastPlay, names)}</> : <span className="muted">Pulsa «Jugar» para empezar.</span>}</p>
      </section>
      {err && <p className="error">{err}</p>}
      {cursor === 0 && (
        <div className="row">
          <button className="sec" onClick={() => setShowPrev(!showPrev)}>{showPrev ? 'Ocultar la previa' : 'Ver la previa'}</button>
        </div>
      )}
      {cursor === 0 && showPrev && <PreviewView gameId={info.game.id} nav={nav} />}

      {!finished ? (
        <div className="row">
          <button onClick={() => setPlaying(!playing)}>{playing ? '❚❚ Pausa' : '▶ Jugar'}</button>
          <button className="sec" onClick={() => { setPlaying(false); setCursor(Math.min(last, cursor + 1)); }}>+1 posesión</button>
          <button className="sec" onClick={() => { setPlaying(false); toPeriodEnd(); }}>Fin del cuarto</button>
          <button className="sec" onClick={() => { setPlaying(false); setCursor(last); }}>Hasta el final</button>
          <Tabs<string> small value={speed} onChange={setSpeed} options={SPEEDS} />
        </div>
      ) : (
        <div className="row">
          <button disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar resultado y ver estadísticas'}</button>
        </div>
      )}
      </div>
      <div className="lv-right">

      <section>
        <h3>En pista · {club(side).short} {!finished && <span className="muted small">— toca un jugador para cambiarlo</span>}</h3>
        <div className="oncourt">
          {court.map((id) => {
            const p = people.get(id)!;
            const st = stats.get(id) ?? { pts: 0, reb: 0, ast: 0 };
            return (
              <div key={id} className={`pc ${pick === id ? 'sel' : ''}`} onClick={() => !finished && setPick(pick === id ? null : id)} role="button" aria-pressed={pick === id}>
                {(snap.fouls[id] ?? 0) > 0 && <span className={`fouls ${(snap.fouls[id] ?? 0) >= 4 ? 'bad' : ''}`}>{snap.fouls[id]}f</span>}
                <PFace p={p} age={age(p)} colors={myColors} size={40} />
                <div className="n">{p.name.split(' ').slice(-1)[0]}</div>
                <div className="muted">{p.pos1} · {p.ovr}</div>
                <div className="arch">{info.meta[id]?.arch}</div>
                <div><b>{st.pts}</b> pts · {st.reb} r</div>
                <Energy e={snap.energy[id] ?? 1} />
              </div>
            );
          })}
        </div>
        {pick !== null && !finished && (
          <div className="card">
            <p className="small">Entra por <b>{people.get(pick)?.name}</b>:</p>
            <div className="bench oncourt">
              {bench.map((id) => {
                const p = people.get(id)!;
                const out = (snap.fouls[id] ?? 0) >= 5;
                return (
                  <div key={id} className="pc" style={out ? { opacity: 0.4 } : undefined} onClick={() => !out && doSub(id)} role="button" aria-disabled={out}>
                    {(snap.fouls[id] ?? 0) > 0 && <span className="fouls">{snap.fouls[id]}f</span>}
                    <PFace p={p} age={age(p)} colors={myColors} size={34} />
                    <div className="n">{p.name.split(' ').slice(-1)[0]}</div>
                    <div className="muted">{pickSlot >= 0 ? `${['PG', 'SG', 'SF', 'PF', 'C'][pickSlot]} ${info.meta[id]?.atPos[pickSlot] ?? p.ovr}` : `${p.pos1} · ${p.ovr}`}</div>
                    <div className="arch">{info.meta[id]?.arch}</div>
                    <Energy e={snap.energy[id] ?? 1} />
                    {out && <div className="bad">Eliminado</div>}
                  </div>
                );
              })}
            </div>
            <p className="muted small">Al hacer un cambio manual se desactivan los cambios automáticos.</p>
          </div>
        )}
        <p className="oppline">Rival en pista: {opp.map((id) => `${people.get(id)?.name.split(' ').slice(-1)[0] ?? '¿?'} (${stats.get(id)?.pts ?? 0})`).join(' · ')}</p>
        {!finished && (
          <div className="row">
            <button className="sec" disabled={timeoutsUsed >= 5} onClick={() => add({ kind: 'timeout' } as Intervention)}>Tiempo muerto ({5 - timeoutsUsed})</button>
            <label className="row tight"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); add({ kind: 'auto', on: e.target.checked } as Intervention); }} /> Cambios automáticos</label>
          </div>
        )}
      </section>

      <section>
        <h3>Marcador</h3>
        <GameFlow timeline={sim.timeline} cursor={cursor} total={last} ink={ink} shorts={shorts} />
      </section>

      {!finished && (
        <section>
          <h3>Defensa</h3>
          {hot !== undefined && hotS && hotS.pts > 0 && (
            <p className="small">🔥 En racha: <b>{people.get(hot)?.name}</b> — {hotS.pts} pts ({hotS.fgm}/{hotS.fga}), {hotS.reb} reb, {hotS.ast} ast{opp.includes(hot) ? ' · en pista' : ' · en el banquillo'}</p>
          )}
          <div className="slot">
            <span className="sl">Intensidad</span>
            <Tabs<Level> small value={def.pressure} onChange={(v) => setDefense({ ...def, pressure: v })} options={PRESSURE} />
          </div>
          <div className="slot">
            <span className="sl">Prioridad</span>
            <Tabs<DefFocus> small value={def.focus} onChange={(v) => setDefense({ ...def, focus: v })} options={FOCUS} />
          </div>
          <div className="slot">
            <span className="sl">Marcaje especial</span>
            <select value={def.mark ?? ''} onChange={(e) => setDefense({ ...def, mark: e.target.value ? Number(e.target.value) : null })} aria-label="Marcaje especial">
              <option value="">Nadie</option>
              {oppAll.map((id) => <option key={id} value={id}>{shortName(people.get(id)?.name ?? '')} · {stats.get(id)?.pts ?? 0} pts{id === hot ? ' 🔥' : ''}</option>)}
            </select>
          </div>
          <p className="muted small">{DEF_HELP}</p>
        </section>
      )}

      {!finished && (
        <section>
          <h3>Plan de tiro</h3>
          {KIND.map(([k, label]) => (
            <div key={k} className="slot">
              <span className="sl">{label}</span>
              <Tabs<Level> small value={plan[k]} onChange={(v) => { const p2 = { ...plan, [k]: v }; setPlan(p2); add({ kind: 'plan', shot: p2 } as Intervention); }} options={[['menos', 'Menos'], ['normal', 'Normal'], ['mas', 'Más']]} />
            </div>
          ))}
        </section>
      )}

      <section>
        <h3>Jugada a jugada</h3>
        <ul className="pbp">
          {events.map((e, i) => (
            <li key={i} className={`${e[3] === 0 ? 'h' : 'a'} ${e[0] === EV.MADE || e[0] === EV.FT_MADE ? 'sc' : ''}`}>
              <span className="t">{e[0] === EV.START || e[0] === EV.END ? '' : clock(e[2]!)}</span>
              <span className="who">{e[0] === EV.START || e[0] === EV.END ? '' : shorts[e[3]!]}</span>
              <span className="tx">{e[0] === EV.START ? `Empieza el ${e[1]! <= 4 ? `${e[1]}º cuarto` : 'tiempo extra'}` : e[0] === EV.END ? 'Final del periodo' : pbpText(e, names)}</span>
              <span className="s" />
            </li>
          ))}
        </ul>
        {events.length === 0 && <p className="muted">Pulsa «Jugar» para empezar.</p>}
      </section>
      </div>
      </div>
    </div>
  );
}
