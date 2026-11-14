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
import { DEFAULT_DEFENSE, DEFAULT_TACTICS, DEF_SYS, OFF_SYS, type DefFocus, type DefSystem, type Defense, EV, type Intervention, type Level, type OffSystem, type Pace, type Snapshot, type Tactics } from '../core/engine';
import { COMP_INFO } from '../core/names';
import { call } from '../db/client';
import { Face, parseColors } from './Face';
import { Loading, type Nav, Tabs, clock, f1, shortName, useData, useSticky } from './kit';
import { DEF_HELP, FOCUS, PACES, PRESSURE, SystemPicker } from './tactics';
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
  meta: Record<number, { atPos: number[]; arch: string; pos2: string | null; perd: number; intd: number }>;
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

/* ───────────── Jugada animada (media pista) ───────────── */

/** Posición orientativa de cada hueco del quinteto (solo para dibujar de dónde sale el pase). */
const SLOT_XY: [number, number][] = [[75, 86], [128, 58], [22, 58], [136, 14], [96, 26]];
/** Media pista: el aro arriba. Coordenadas del tiro (x lateral, y desde el aro) → dibujo. */
const HX = (x: number) => 75 + x;
const HY = (y: number) => 16 + y;

function HalfCourt() {
  const r3 = COURT.three;
  return (
    <g fill="none" stroke="var(--courtline)" strokeWidth="0.7">
      <rect x="0.5" y="0.5" width="149" height="99" />
      <rect x={75 - COURT.laneHalf} y="0" width={COURT.laneHalf * 2} height={COURT.ftLineY + 16} />
      <circle cx="75" cy={COURT.ftLineY + 16} r="18" />
      <path d={`M${75 - COURT.corner} 0V${16 + CORNER_Y}A${r3} ${r3} 0 0 0 ${75 + COURT.corner} ${16 + CORNER_Y}V0`} />
      <path d={`M${75 - COURT.rim} 16A${COURT.rim} ${COURT.rim} 0 0 0 ${75 + COURT.rim} 16`} />
      <line x1="66" y1="12" x2="84" y2="12" strokeWidth="1.3" />
      <circle cx="75" cy="16" r="2.3" stroke="#f08a3c" strokeWidth="1" />
    </g>
  );
}

interface PlayEv { k: number; e: number[] }
/** La última acción, dibujada: quién tira y desde dónde, el pase si lo hubo, el defensor y el balón al aro. */
function PlayView({ ev, ink, side, people, snap, shorts }: { ev: PlayEv | null; ink: [string, string]; side: number; people: Map<number, Person>; snap: Snapshot; shorts: [string, string] }) {
  if (!ev) {
    return (
      <svg viewBox="0 0 150 100" className="playview" role="img" aria-label="Jugada">
        <rect width="150" height="100" fill="var(--court)" rx="3" />
        <HalfCourt />
        <text x="75" y="60" textAnchor="middle" className="ptxt">Pulsa «Jugar» para empezar</text>
      </svg>
    );
  }
  const e = ev.e;
  const type = e[0]!;
  const att = e[3]!;
  const color = ink[att]!;
  const dcolor = ink[1 - att]!;
  const num = (id: number) => String(people.get(id)?.number ?? '');
  const isShot = type === EV.MADE || type === EV.MISS;
  const x = isShot ? Math.floor(e[6]! / 1000) - 100 : 0;
  const y = isShot ? e[8] ?? 0 : 0;
  const pts = Math.floor((e[6]! % 100) / 10);
  const blocked = type === EV.MISS && Math.floor(e[6]! / 100) % 10 === 1;
  const sx = HX(x);
  const sy = HY(y);
  const passer = type === EV.MADE && e[5] ? e[5] : 0;
  const pIdx = passer ? Math.max(0, snap.court[att]!.indexOf(passer)) : 0;
  const [px, py] = SLOT_XY[pIdx] ?? SLOT_XY[0]!;
  const defId = isShot ? snap.match?.[att]?.[e[4]!] : undefined;
  const dx = sx + (75 - sx) * 0.12;
  const dy = sy + (16 - sy) * 0.18;
  const label = isShot ? (type === EV.MADE ? `+${pts}` : blocked ? 'TAPÓN' : 'FALLA') : type === EV.FT_MADE ? '+1' : type === EV.FT_MISS ? 'TL fallado' : type === EV.TOV ? 'PÉRDIDA' : type === EV.OREB ? 'REB. OF.' : type === EV.DREB ? 'REBOTE' : type === EV.FOUL ? 'FALTA' : type === EV.TIMEOUT ? 'TIEMPO MUERTO' : '';
  const good = type === EV.MADE || type === EV.FT_MADE;
  const k = ev.k;
  return (
    <svg viewBox="0 0 150 100" className="playview" role="img" aria-label="Última jugada">
      <rect width="150" height="100" fill="var(--court)" rx="3" />
      <HalfCourt />
      <text x="6" y="96" className="ptag" fill={color}>{shorts[att]} ataca</text>
      {isShot && (
        <g key={k}>
          {passer > 0 && (
            <>
              <circle cx={px} cy={py} r="4.2" fill={color} stroke="#000" strokeOpacity="0.4" strokeWidth="0.5" />
              <text x={px} y={py + 1.6} textAnchor="middle" className="pnum">{num(passer)}</text>
              <line x1={px} y1={py} x2={sx} y2={sy} stroke="#fff" strokeWidth="0.7" strokeDasharray="2 1.5" opacity="0.85" />
            </>
          )}
          {defId && (
            <>
              <circle cx={dx} cy={dy} r="4.2" fill={dcolor} stroke="#000" strokeOpacity="0.4" strokeWidth="0.5" />
              <text x={dx} y={dy + 1.6} textAnchor="middle" className="pnum">{num(defId)}</text>
            </>
          )}
          <circle cx={sx} cy={sy} r="5" fill={color} stroke="#fff" strokeWidth="0.8" />
          <text x={sx} y={sy + 1.8} textAnchor="middle" className="pnum">{num(e[4]!)}</text>
          <circle r="1.9" fill="#f08a3c" stroke="#5a2a0a" strokeWidth="0.4">
            <animateMotion dur="0.75s" fill="freeze" begin={passer ? '0.35s' : '0s'} path={`M${sx} ${sy} Q${(sx + 75) / 2} ${Math.min(sy, 16) - 18} ${blocked ? dx : 75} ${blocked ? dy : 16}`} />
          </circle>
        </g>
      )}
      {label && (
        <text key={`t${k}`} x="75" y={isShot && sy < 50 ? 72 : 46} textAnchor="middle" className={`pbig ${good ? 'ok' : ''}`} style={good ? { fill: color } : undefined}>
          {label}
          <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin={isShot ? '0.9s' : '0s'} fill="freeze" />
        </text>
      )}
    </svg>
  );
}

/* ───────────── Estadísticas en directo ───────────── */

interface LB { pts: number; m2: number; a2: number; m3: number; a3: number; ftm: number; fta: number; orb: number; drb: number; ast: number; stl: number; blk: number; tov: number; pf: number; sec: number }
const zero = (): LB => ({ pts: 0, m2: 0, a2: 0, m3: 0, a3: 0, ftm: 0, fta: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, sec: 0 });
function liveBox(sim: Sim, cursor: number): Map<number, LB> {
  const m = new Map<number, LB>();
  const g = (id: number) => m.get(id) ?? m.set(id, zero()).get(id)!;
  for (const e of sim.pbp) {
    if (e[7]! >= cursor) break;
    const t = e[0]!;
    const three = Math.floor((e[6]! % 100) / 10) === 3;
    if (t === EV.MADE) {
      const b = g(e[4]!);
      b.pts += three ? 3 : 2;
      if (three) { b.m3++; b.a3++; } else { b.m2++; b.a2++; }
      if (e[5]) g(e[5]).ast++;
    } else if (t === EV.MISS) {
      const b = g(e[4]!);
      if (three) b.a3++; else b.a2++;
      if (Math.floor(e[6]! / 100) % 10 === 1 && e[5]) g(e[5]).blk++;
    } else if (t === EV.FT_MADE) { const b = g(e[4]!); b.pts++; b.ftm++; b.fta++; }
    else if (t === EV.FT_MISS) g(e[4]!).fta++;
    else if (t === EV.OREB) g(e[4]!).orb++;
    else if (t === EV.DREB) g(e[4]!).drb++;
    else if (t === EV.TOV) { g(e[4]!).tov++; if (e[5]) g(e[5]).stl++; }
    else if (t === EV.FOUL) g(e[4]!).pf++;
  }
  // Minutos: tiempo entre fotos de posesión consecutivas, para quien estaba en pista.
  const tl = sim.timeline;
  for (let i = 1; i < tl.length && tl[i]!.i <= cursor; i++) {
    const a = tl[i - 1]!;
    const b = tl[i]!;
    const dt = a.period === b.period ? a.clock - b.clock : a.clock;
    for (const id of [...a.court[0], ...a.court[1]]) g(id).sec += Math.max(0, dt);
  }
  return m;
}
const val = (b: LB) => b.pts + b.orb + b.drb + b.ast + b.stl + b.blk - (b.a2 - b.m2) - (b.a3 - b.m3) - (b.fta - b.ftm) - b.tov - b.pf;

function LiveBox({ ids, box, people, onCourt, title }: { ids: number[]; box: Map<number, LB>; people: Map<number, Person>; onCourt: number[]; title: string }) {
  const rows = ids.map((id) => ({ id, b: box.get(id) ?? zero() })).sort((x, y) => Number(onCourt.includes(y.id)) - Number(onCourt.includes(x.id)) || y.b.sec - x.b.sec);
  const tot = rows.reduce((a, r) => { for (const k of Object.keys(a) as (keyof LB)[]) a[k] += r.b[k]; return a; }, zero());
  return (
    <section>
      <h3>{title}</h3>
      <div className="tbl">
        <table className="livebox">
          <thead><tr><th className="l">Jugador</th><th>MIN</th><th>PTS</th><th>T2</th><th>T3</th><th>T1</th><th>REB</th><th>AST</th><th>ROB</th><th>TAP</th><th>PÉR</th><th>FC</th><th>VAL</th></tr></thead>
          <tbody>
            {rows.map(({ id, b }) => (
              <tr key={id} className={onCourt.includes(id) ? 'oncourt-row' : ''}>
                <td className="l">{onCourt.includes(id) ? '● ' : ''}{shortName(people.get(id)?.name ?? '')}</td>
                <td>{Math.floor(b.sec / 60)}</td><td><b>{b.pts}</b></td><td>{b.m2}/{b.a2}</td><td>{b.m3}/{b.a3}</td><td>{b.ftm}/{b.fta}</td>
                <td>{b.orb + b.drb}</td><td>{b.ast}</td><td>{b.stl}</td><td>{b.blk}</td><td>{b.tov}</td><td className={b.pf >= 4 ? 'bad' : ''}>{b.pf}</td><td>{val(b)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="l">Total</td><td></td><td>{tot.pts}</td><td>{tot.m2}/{tot.a2}</td><td>{tot.m3}/{tot.a3}</td><td>{tot.ftm}/{tot.fta}</td><td>{tot.orb + tot.drb}</td><td>{tot.ast}</td><td>{tot.stl}</td><td>{tot.blk}</td><td>{tot.tov}</td><td>{tot.pf}</td><td>{val(tot)}</td></tr></tfoot>
        </table>
      </div>
    </section>
  );
}

/* ───────────── Avisos del ayudante ───────────── */

interface Warn { key: string; text: string; act?: { label: string; run: () => void } }

/* ───────────── Pantalla ───────────── */

type LTab = 'jugada' | 'cambios' | 'tactica' | 'stats' | 'tiros' | 'relato' | 'previa';

export function LiveScreen({ nav, onDone }: { nav: Nav; onDone: (gameId: number) => void }) {
  const [gameId, setGameId] = useState<number | undefined>(undefined);
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [ivs, setIvs] = useState<Intervention[]>([]);
  const [sim, setSim] = useState<Sim | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useSticky('live.speed', '600');
  const [keyMode, setKeyMode] = useSticky('live.key', false);
  const [tab, setTab] = useState<LTab>('previa');
  const [pick, setPick] = useState<number | null>(null);
  const [tac, setTac] = useState<Tactics | null>(null);
  const [auto, setAuto] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setInfo(undefined);
    setSim(null);
    setIvs([]);
    setCursor(0);
    setPlaying(false);
    setTab('previa');
    void call<Info | null>('liveStart', { gameId }).then(async (i) => {
      setInfo(i);
      if (i) {
        const clubId = i.userSide === 0 ? i.game.home_id : i.game.away_id;
        const t = await call<Tactics>('tactics', { clubId });
        setTac({ ...DEFAULT_TACTICS, ...t, defense: { ...DEFAULT_DEFENSE, ...t.defense, mark: null, special: null, matchups: {} } });
      }
    }).catch((e: Error) => setErr(e.message));
  }, [gameId]);
  useEffect(() => {
    if (!info) return;
    void call<Sim>('liveSim', { interventions: ivs }).then(setSim).catch((e: Error) => setErr(e.message));
  }, [info, ivs]);
  const last = sim ? sim.timeline.length - 1 : 0;

  // Jugadas clave: final apretado, parciales, faltas de los tuyos, tiempos muertos y comienzos de cuarto.
  const keys = useMemo(() => {
    const out = new Set<number>();
    if (!sim || !info) return out;
    const side = info.userSide;
    let prev: Snapshot | null = null;
    for (const t of sim.timeline) {
      const margin = Math.abs(t.score[0] - t.score[1]);
      if (t.period >= 4 && t.clock <= 150 && margin <= 8) out.add(t.i);
      if (prev && (t.run[0] >= 8 && prev.run[0] < 8 || t.run[1] >= 8 && prev.run[1] < 8)) out.add(t.i);
      if (prev && t.period !== prev.period) out.add(t.i);
      if (prev) for (const id of t.court[side]) if ((t.fouls[id] ?? 0) >= 4 && (prev.fouls[id] ?? 0) < 4) out.add(t.i);
      prev = t;
    }
    for (const e of sim.pbp) if (e[0] === EV.TIMEOUT) out.add(e[7]! + 1);
    return out;
  }, [sim, info]);

  useEffect(() => {
    if (!playing || !sim) return;
    if (cursor >= last) {
      setPlaying(false);
      return;
    }
    const delay = keyMode && !keys.has(cursor + 1) ? 25 : Number(speed);
    const t = setTimeout(() => {
      const nx = Math.min(last, cursor + 1);
      setCursor(nx);
      if (keyMode && keys.has(nx)) setPlaying(false);
    }, delay);
    return () => clearTimeout(t);
  }, [playing, cursor, sim, speed, last, keyMode, keys]);

  const people = useMemo(() => new Map(info?.people.map((p) => [p.id, p]) ?? []), [info]);
  const names = useMemo(() => Object.fromEntries(info?.people.map((p) => [p.id, p.name]) ?? []), [info]);
  const box = useMemo(() => (sim ? liveBox(sim, cursor) : new Map<number, LB>()), [sim, cursor]);
  const shots = useMemo<ShotEv[]>(() => {
    const out: ShotEv[] = [];
    (sim?.pbp ?? []).forEach((e, k) => {
      if (e[7]! >= cursor || (e[0] !== EV.MADE && e[0] !== EV.MISS)) return;
      out.push({ k, side: e[3]!, x: Math.floor(e[6]! / 1000) - 100, y: e[8] ?? 0, made: e[0] === EV.MADE, period: e[1]!, who: e[4]!, pts: Math.floor((e[6]! % 100) / 10) });
    });
    return out;
  }, [sim, cursor]);

  if (info === undefined) return <Loading error={err} />;
  if (info === null) {
    return (
      <div>
        <button className="back" onClick={nav.back}>‹ Volver</button>
        <p className="muted">Tu equipo no juega en el próximo día de partidos.</p>
      </div>
    );
  }
  if (!sim || !tac) return <Loading error={err} />;
  const side = info.userSide;
  const other = (1 - side) as 0 | 1;
  const snap = sim.timeline[Math.min(cursor, last)]!;
  const finished = cursor >= last;
  const club = (i: 0 | 1) => info.clubs.find((c) => c.id === (i === 0 ? info.game.home_id : info.game.away_id))!;
  const ink = teamInk(club(0).colors, club(1).colors);
  const shorts: [string, string] = [club(0).short, club(1).short];
  const add = (iv: Omit<Intervention, 'at' | 'side'>) => {
    setPlaying(false);
    setIvs((xs) => [...xs, { ...(iv as Intervention), at: cursor, side }]);
  };
  const def = tac.defense!;
  const setDefense = (d: Defense) => { setTac({ ...tac, defense: d }); add({ kind: 'defense', defense: d } as Intervention); };
  const court = snap.court[side];
  const opp = snap.court[other];
  const pickSlot = pick !== null ? court.indexOf(pick) : -1;
  // Banquillo: si has elegido a quién cambiar, primero los de su posición (por su media en ese puesto) y luego el resto por media.
  const pickPos = pick !== null ? [people.get(pick)?.pos1, info.meta[pick]?.pos2].filter(Boolean) as string[] : [];
  const samePos = (id: number) => pickPos.includes(people.get(id)?.pos1 ?? '') || pickPos.includes(info.meta[id]?.pos2 ?? '');
  const bench = info.roster[side].filter((id) => !court.includes(id)).sort((a, b) =>
    Number((snap.fouls[a] ?? 0) >= 5) - Number((snap.fouls[b] ?? 0) >= 5) ||
    (pick !== null ? Number(samePos(b)) - Number(samePos(a)) : 0) ||
    (pick !== null && samePos(a) && pickSlot >= 0 ? (info.meta[b]?.atPos[pickSlot] ?? 0) - (info.meta[a]?.atPos[pickSlot] ?? 0) : 0) ||
    (people.get(b)?.ovr ?? 0) - (people.get(a)?.ovr ?? 0));
  const pbpUpTo = sim.pbp.filter((e) => e[7]! < cursor);
  // Puntos por cuarto (y prórrogas) hasta el momento que se está viendo.
  const qPts: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  for (const e of pbpUpTo) {
    const pts = e[0] === EV.MADE ? Math.floor((e[6]! % 100) / 10) : e[0] === EV.FT_MADE ? 1 : 0;
    if (!pts) continue;
    while (qPts.length < e[1]!) qPts.push([0, 0]);
    qPts[e[1]! - 1]![e[3]! as 0 | 1] += pts;
  }
  const lastEvIdx = (() => {
    for (let k = pbpUpTo.length - 1; k >= 0; k--) {
      const t = pbpUpTo[k]![0]!;
      if (t !== EV.START && t !== EV.END && t !== EV.SUB) return k;
    }
    return -1;
  })();
  const lastEv = lastEvIdx >= 0 ? { k: lastEvIdx, e: pbpUpTo[lastEvIdx]! } : null;
  const recent = pbpUpTo.filter((e) => e[0] !== EV.SUB || e[3] === side).slice(-8).reverse();
  const periodLabel = snap.period <= 4 ? `${snap.period}º C` : snap.period === 5 ? 'Prór.' : `${snap.period - 4}ª prór.`;
  const age = (p: Person) => info.season - p.birth_year;
  const myColors = club(side).colors;
  const toPeriodEnd = () => {
    const nxt = sim.timeline.find((t) => t.i > cursor && t.period > snap.period);
    setCursor(nxt ? nxt.i : last);
  };
  const nextKey = () => {
    const nk = [...keys].filter((k) => k > cursor).sort((a, b) => a - b)[0];
    setPlaying(false);
    setCursor(nk ?? last);
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
  const doSub = (inId: number) => {
    if (pick === null) return;
    if (auto) {
      setAuto(false);
      add({ kind: 'auto', on: false } as Intervention);
    }
    add({ kind: 'sub', in: inId, out: pick } as Intervention);
    setPick(null);
  };
  const timeout = () => add({ kind: 'timeout' } as Intervention);
  const setSpecial = (id: number, mode: 'negar' | 'dos' | null) => setDefense({ ...def, special: mode ? { id, mode } : null, mark: null });

  // Avisos del ayudante.
  const sum = (ids: number[], f: (b: LB) => number) => ids.reduce((a, id) => a + f(box.get(id) ?? zero()), 0);
  const warns: Warn[] = [];
  if (!finished && cursor > 0) {
    for (const id of court) {
      const e = snap.energy[id] ?? 1;
      if (e < 0.6) warns.push({ key: `e${id}`, text: `${shortName(people.get(id)!.name)} está fundido (energía ${Math.round(e * 100)} %).`, act: { label: 'Cambiarlo', run: () => { setPick(id); setTab('cambios'); } } });
      const f = snap.fouls[id] ?? 0;
      if (f >= 4 || (f >= 3 && snap.period <= 2)) warns.push({ key: `f${id}`, text: `${shortName(people.get(id)!.name)} tiene ${f} faltas.`, act: { label: 'Sentarlo', run: () => { setPick(id); setTab('cambios'); } } });
    }
    if (snap.run[other] >= 6) warns.push({ key: 'run', text: `Parcial ${snap.run[other]}-0 de ${shorts[other]}.`, act: snap.tLeft[side] > 0 ? { label: `Tiempo muerto (${snap.tLeft[side]})`, run: timeout } : undefined });
    const hot = [...info.roster[other]].sort((a, b) => (box.get(b)?.pts ?? 0) - (box.get(a)?.pts ?? 0))[0];
    const hb = hot !== undefined ? box.get(hot) : undefined;
    if (hot !== undefined && hb && hb.pts >= 12 && def.special?.id !== hot) {
      warns.push({ key: 'hot', text: `${shortName(people.get(hot)!.name)} lleva ${hb.pts} puntos (${hb.m2 + hb.m3}/${hb.a2 + hb.a3}).`, act: { label: hb.pts >= 18 ? 'Dos contra uno' : 'Negarle el balón', run: () => setSpecial(hot, hb.pts >= 18 ? 'dos' : 'negar') } });
    }
    const o3a = sum(info.roster[other], (b) => b.a3);
    const o3m = sum(info.roster[other], (b) => b.m3);
    if (o3a >= 8 && o3m / o3a >= 0.45 && def.focus !== 'perimetro') warns.push({ key: 't3', text: `${shorts[other]} mete ${o3m}/${o3a} de tres.`, act: { label: 'Salir a tiradores', run: () => setDefense({ ...def, focus: 'perimetro' }) } });
    const o2a = sum(info.roster[other], (b) => b.a2);
    const o2m = sum(info.roster[other], (b) => b.m2);
    if (o2a >= 14 && o2m / o2a >= 0.62 && def.focus !== 'pintura') warns.push({ key: 't2', text: `${shorts[other]} anota ${o2m}/${o2a} de dos.`, act: { label: 'Cerrar la pintura', run: () => setDefense({ ...def, focus: 'pintura' }) } });
    const myTov = sum(info.roster[side], (b) => b.tov);
    if (myTov >= 10 && snap.period <= 3) warns.push({ key: 'tov', text: `Llevas ${myTov} pérdidas: el ataque sufre.`, act: tac.pace !== 'lento' ? { label: 'Ritmo lento', run: () => { setTac({ ...tac, pace: 'lento' }); add({ kind: 'offense', offense: tac.offense ?? 'equilibrado', pace: 'lento' } as Intervention); } } : undefined });
  }

  const tabs: [LTab, string][] = [
    ...(cursor === 0 ? [['previa', 'Previa'] as [LTab, string]] : []),
    ['jugada', 'Jugada'], ['cambios', 'Cambios'], ['tactica', 'Táctica'], ['stats', 'Estadísticas'], ['tiros', 'Tiros'], ['relato', 'Relato'],
  ];
  const curTab = tab === 'previa' && cursor > 0 ? 'jugada' : tab;
  const Card = ({ id, size, onClick, sel }: { id: number; size: number; onClick?: () => void; sel?: boolean }) => {
    const p = people.get(id)!;
    const b = box.get(id) ?? zero();
    const out = (snap.fouls[id] ?? 0) >= 5;
    return (
      <div className={`pc ${sel ? 'sel' : ''}`} style={out ? { opacity: 0.4 } : undefined} onClick={onClick} role="button">
        {(snap.fouls[id] ?? 0) > 0 && <span className={`fouls ${(snap.fouls[id] ?? 0) >= 4 ? 'bad' : ''}`}>{snap.fouls[id]}f</span>}
        <PFace p={p} age={age(p)} colors={myColors} size={size} />
        <div className="n" title={p.name}>{shortName(p.name).split(' ').slice(-1)[0]}</div>
        <div className="muted">{p.pos1} · {p.ovr}</div>
        <div className="arch" title={info.meta[id]?.arch}>{info.meta[id]?.arch === 'Jugador de rol' ? 'De rol' : info.meta[id]?.arch ?? ''}</div>
        <div className="st"><b>{b.pts}</b>p {b.orb + b.drb}r {b.ast}a</div>
        <Energy e={snap.energy[id] ?? 1} />
      </div>
    );
  };

  return (
    <div className="live2">
      <div className="livehead">
        <div className="lh-top">
          <button className="back" onClick={() => { if (finished || (ivs.length === 0 && cursor === 0) || confirm('Si sales ahora no se guarda nada: el partido se simulará normal al avanzar. ¿Salir?')) nav.back(); }}>‹</button>
          <div className={`lh-team ${side === 0 ? 'me' : ''}`}><span className="sw" style={{ background: ink[0] }} />{shorts[0]}<span className="tos">{'•'.repeat(snap.tLeft[0])}</span></div>
          <div className="lh-score">{snap.score[0]}<span>-</span>{snap.score[1]}</div>
          <div className={`lh-team r ${side === 1 ? 'me' : ''}`}><span className="tos">{'•'.repeat(snap.tLeft[1])}</span>{shorts[1]}<span className="sw" style={{ background: ink[1] }} /></div>
        </div>
        <div className="lh-sub">
          {finished ? 'Final' : `${periodLabel} · ${clock(snap.clock)}`} · faltas {snap.teamFouls[0]}-{snap.teamFouls[1]}
          {snap.run[0] >= 6 && <b className="runb" style={{ color: ink[0] }}> · parcial {snap.run[0]}-0</b>}
          {snap.run[1] >= 6 && <b className="runb" style={{ color: ink[1] }}> · parcial 0-{snap.run[1]}</b>}
        </div>
        <div className="lh-q" aria-label="Puntos por cuarto">
          <span className="tn"><small>&nbsp;</small><b>{shorts[0]}</b><b>{shorts[1]}</b></span>
          {qPts.map((q, i) => (
            <span key={i} className={i + 1 === snap.period && !finished ? 'cur' : ''}>
              <small>{i < 4 ? `${i + 1}C` : `P${i - 3}`}</small>
              <b>{i + 1 > snap.period ? '–' : q[0]}</b>
              <b>{i + 1 > snap.period ? '–' : q[1]}</b>
            </span>
          ))}
        </div>
        {!finished ? (
          <div className="lh-ctl">
            <button onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
            <button className="sec" onClick={() => { setPlaying(false); setCursor(Math.min(last, cursor + 1)); }}>+1</button>
            <button className="sec" onClick={nextKey} title="Saltar a la siguiente jugada clave">⏭ Clave</button>
            <button className="sec" onClick={() => { setPlaying(false); toPeriodEnd(); }}>Fin cuarto</button>
            <button className="sec" onClick={() => { setPlaying(false); setCursor(last); }}>Final</button>
            <select value={speed} onChange={(e) => setSpeed(e.target.value)} aria-label="Velocidad">
              {SPEEDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="kmode"><input type="checkbox" checked={keyMode} onChange={(e) => setKeyMode(e.target.checked)} /> Solo claves</label>
          </div>
        ) : (
          <div className="lh-ctl">
            <button disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar resultado y ver la hoja'}</button>
          </div>
        )}
        {/* Un aviso cada vez y en un hueco de altura fija: así la pantalla no salta al aparecer o desaparecer. */}
        {!finished && (
          <div className="warns">
            {warns[0] ? (
              <div key={warns[0].key} className="warn-row">
                <span>📋 {warns[0].text}{warns.length > 1 && <span className="muted"> (+{warns.length - 1})</span>}</span>
                {warns[0].act && <button className="sec" onClick={warns[0].act.run}>{warns[0].act.label}</button>}
              </div>
            ) : (
              <div className="warn-row calm"><span className="muted">📋 Sin avisos del ayudante</span></div>
            )}
          </div>
        )}
        <Tabs<LTab> small value={curTab} onChange={setTab} options={tabs} />
      </div>
      {err && <p className="error">{err}</p>}
      {info.options.length > 1 && cursor === 0 && ivs.length === 0 && (
        <div className="gamepick">
          <span className="muted small">Hoy juegas {info.options.length} partidos. Elige cuál ver en directo (el otro se simula):</span>
          {info.options.map((id, n) => <button key={id} className={id === info.game.id ? '' : 'sec'} onClick={() => setGameId(id)}>{id === info.game.id ? '✓ ' : ''}Partido {n + 1}</button>)}
        </div>
      )}

      {curTab === 'previa' && <PreviewView gameId={info.game.id} nav={nav} onApplied={(t) => { setTac(t); if (t.defense) add({ kind: 'defense', defense: t.defense } as Intervention); }} />}

      {curTab === 'jugada' && (
        <>
          <section className="hero playbox">
            <PlayView ev={lastEv} ink={ink} side={side} people={people} snap={snap} shorts={shorts} />
            <p className="lastplay">{lastEv ? <><span className="muted">{clock(lastEv.e[2]!)} · {shorts[lastEv.e[3]!]}</span> {pbpText(lastEv.e, names)}</> : <span className="muted">Aún no ha empezado.</span>}</p>
          </section>
          <section>
            <ul className="pbp mini">
              {recent.map((e, i) => (
                <li key={i} className={`${e[3] === 0 ? 'h' : 'a'} ${e[0] === EV.MADE || e[0] === EV.FT_MADE ? 'sc' : ''}`}>
                  <span className="t">{e[0] === EV.START || e[0] === EV.END ? '' : clock(e[2]!)}</span>
                  <span className="who" style={{ color: e[0] === EV.START || e[0] === EV.END ? undefined : ink[e[3]!] }}>{e[0] === EV.START || e[0] === EV.END ? '' : shorts[e[3]!]}</span>
                  <span className="tx">{e[0] === EV.START ? `Empieza el ${e[1]! <= 4 ? `${e[1]}º cuarto` : 'tiempo extra'}` : e[0] === EV.END ? 'Final del periodo' : pbpText(e, names)}{e[0] === EV.TIMEOUT && e[6] ? ' (automático)' : ''}</span>
                  <span className="s" />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <GameFlow timeline={sim.timeline} cursor={cursor} total={last} ink={ink} shorts={shorts} />
          </section>
        </>
      )}

      {curTab === 'cambios' && (
        <section>
          <h3>En pista · {shorts[side]} {!finished && <span className="muted small">— toca a uno para cambiarlo</span>}</h3>
          <div className="oncourt">{court.map((id) => <Card key={id} id={id} size={40} sel={pick === id} onClick={() => !finished && setPick(pick === id ? null : id)} />)}</div>
          {pick !== null && !finished && (
            <div className="card">
              <p className="small">Entra por <b>{people.get(pick)?.name}</b>: primero los de su posición (por su media en ese puesto), luego el resto por media.</p>
              <div className="bench oncourt">
                {bench.map((id) => <Card key={id} id={id} size={34} onClick={() => (snap.fouls[id] ?? 0) < 5 && doSub(id)} />)}
              </div>
              <p className="muted small">Al hacer un cambio manual se desactivan los cambios automáticos.</p>
            </div>
          )}
          {pick === null && !finished && (
            <>
              <h3>Banquillo</h3>
              <div className="bench oncourt">{bench.map((id) => <Card key={id} id={id} size={30} />)}</div>
            </>
          )}
          {!finished && (
            <div className="row">
              <button className="sec" disabled={snap.tLeft[side] <= 0} onClick={timeout}>Tiempo muerto ({snap.tLeft[side]})</button>
              <label className="row tight"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); add({ kind: 'auto', on: e.target.checked } as Intervention); }} /> Cambios automáticos</label>
            </div>
          )}
        </section>
      )}

      {curTab === 'tactica' && (
        <>
          <LivePresets clubId={info.userSide === 0 ? info.game.home_id : info.game.away_id} disabled={finished} onApply={(t) => {
            const d: Defense = { ...def, ...t.defense, matchups: def.matchups ?? {}, special: def.special ?? null };
            const nt: Tactics = { ...tac, ...t, defense: d };
            setTac(nt);
            add({ kind: 'offense', offense: nt.offense ?? 'equilibrado', pace: nt.pace ?? 'normal' } as Intervention);
            add({ kind: 'plan', shot: nt.shot } as Intervention);
            add({ kind: 'defense', defense: d } as Intervention);
            if (nt.autoTimeout) add({ kind: 'autoTimeout', ...nt.autoTimeout } as Intervention);
          }} />
          <section>
            <h3>Emparejamientos</h3>
            <p className="muted small">Quién defiende a quién (por defecto, tu mejor defensor sobre su mayor peligro). Negar el balón: recibe menos y tu defensor se cansa más. Dos contra uno: casi no tira, pero sus compañeros quedan liberados. En cada defensor ves su defensa exterior (E) e interior (I).</p>
            <div className="mlist">
              {opp.map((aid) => {
                const cur = snap.match?.[other]?.[aid];
                const sp = def.special?.id === aid ? def.special.mode : null;
                return (
                  <div key={aid} className={'mrow' + (sp ? ' sp' : '')}>
                    <div className="mtop">
                      <b>{shortName(people.get(aid)?.name ?? '')}</b> <span className="muted small">{people.get(aid)?.pos1} · {info.meta[aid]?.arch} · {box.get(aid)?.pts ?? 0} pts</span>
                    </div>
                    <div className="mbot">
                      <select value={cur ?? ''} disabled={finished} onChange={(e) => {
                        const d = Number(e.target.value);
                        const m = { ...(def.matchups ?? {}) };
                        for (const [a, x] of Object.entries(m)) if (x === d) delete m[Number(a)];
                        m[aid] = d;
                        setDefense({ ...def, matchups: m });
                      }}>
                        {court.map((did) => <option key={did} value={did}>{shortName(people.get(did)?.name ?? '')} · E{info.meta[did]?.perd ?? '—'} I{info.meta[did]?.intd ?? '—'}</option>)}
                      </select>
                      <span className="segs">
                        <button className={sp === 'negar' ? 'on' : ''} disabled={finished} onClick={() => setSpecial(aid, sp === 'negar' ? null : 'negar')}>Negar</button>
                        <button className={sp === 'dos' ? 'on' : ''} disabled={finished} onClick={() => setSpecial(aid, sp === 'dos' ? null : 'dos')}>2x1</button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="row"><button className="sec" disabled={finished} onClick={() => setDefense({ ...def, matchups: {}, special: null })}>Todo automático</button></div>
          </section>
          <section>
            <h3>Defensa</h3>
            <div className="slot"><span className="sl">Intensidad</span><Tabs<Level> small value={def.pressure} onChange={(v) => setDefense({ ...def, pressure: v })} options={PRESSURE} /></div>
            <div className="slot"><span className="sl">Prioridad</span><Tabs<DefFocus> small value={def.focus} onChange={(v) => setDefense({ ...def, focus: v })} options={FOCUS} /></div>
            <h4 className="aw">Sistema defensivo</h4>
            <SystemPicker<DefSystem> value={def.system ?? 'individual'} onChange={(v) => setDefense({ ...def, system: v })} table={DEF_SYS} />
            <p className="muted small">{DEF_HELP}</p>
          </section>
          <section>
            <h3>Ataque</h3>
            <div className="slot"><span className="sl">Ritmo</span><Tabs<Pace> small value={tac.pace ?? 'normal'} onChange={(v) => { setTac({ ...tac, pace: v }); add({ kind: 'offense', offense: tac.offense ?? 'equilibrado', pace: v } as Intervention); }} options={PACES} /></div>
            <SystemPicker<OffSystem> value={tac.offense ?? 'equilibrado'} onChange={(v) => { setTac({ ...tac, offense: v }); add({ kind: 'offense', offense: v, pace: tac.pace ?? 'normal' } as Intervention); }} table={OFF_SYS} />
            <h4 className="aw">Plan de tiro</h4>
            {KIND.map(([k, label]) => (
              <div key={k} className="slot">
                <span className="sl">{label}</span>
                <Tabs<Level> small value={tac.shot[k]} onChange={(v) => { const p2 = { ...tac.shot, [k]: v }; setTac({ ...tac, shot: p2 }); add({ kind: 'plan', shot: p2 } as Intervention); }} options={[['menos', 'Menos'], ['normal', 'Normal'], ['mas', 'Más']]} />
              </div>
            ))}
          </section>
          <section>
            <h3>Tiempos muertos automáticos</h3>
            <label className="row tight"><input type="checkbox" checked={tac.autoTimeout?.on ?? true} onChange={(e) => { const a = { on: e.target.checked, run: tac.autoTimeout?.run ?? 8 }; setTac({ ...tac, autoTimeout: a }); add({ kind: 'autoTimeout', ...a } as Intervention); }} /> Que el ayudante los pida</label>
            <div className="slot"><span className="sl">Con un parcial de</span><Tabs<string> small value={String(tac.autoTimeout?.run ?? 8)} onChange={(v) => { const a = { on: tac.autoTimeout?.on ?? true, run: Number(v) }; setTac({ ...tac, autoTimeout: a }); add({ kind: 'autoTimeout', ...a } as Intervention); }} options={[['6', '6-0'], ['8', '8-0'], ['10', '10-0'], ['12', '12-0']]} /></div>
          </section>
        </>
      )}

      {curTab === 'stats' && (
        <>
          <section>
            <h3>Equipos</h3>
            {(() => {
              const t = (ids: number[]) => ({
                fg: `${sum(ids, (b) => b.m2 + b.m3)}/${sum(ids, (b) => b.a2 + b.a3)}`,
                t3: `${sum(ids, (b) => b.m3)}/${sum(ids, (b) => b.a3)}`,
                ft: `${sum(ids, (b) => b.ftm)}/${sum(ids, (b) => b.fta)}`,
                reb: sum(ids, (b) => b.orb + b.drb), orb: sum(ids, (b) => b.orb), ast: sum(ids, (b) => b.ast), tov: sum(ids, (b) => b.tov), stl: sum(ids, (b) => b.stl), blk: sum(ids, (b) => b.blk),
              });
              const a = t(info.roster[0]);
              const b = t(info.roster[1]);
              const rows: [string, string | number, string | number][] = [['Tiros de campo', a.fg, b.fg], ['Triples', a.t3, b.t3], ['Tiros libres', a.ft, b.ft], ['Rebotes (of.)', `${a.reb} (${a.orb})`, `${b.reb} (${b.orb})`], ['Asistencias', a.ast, b.ast], ['Pérdidas', a.tov, b.tov], ['Robos', a.stl, b.stl], ['Tapones', a.blk, b.blk]];
              return (
                <div className="tbl">
                  <table>
                    <thead><tr><th className="l"></th><th>{shorts[0]}</th><th>{shorts[1]}</th></tr></thead>
                    <tbody>{rows.map(([l, x, y]) => <tr key={l}><td className="l">{l}</td><td>{x}</td><td>{y}</td></tr>)}</tbody>
                  </table>
                </div>
              );
            })()}
          </section>
          <LiveBox ids={info.roster[side]} box={box} people={people} onCourt={court} title={club(side).name} />
          <LiveBox ids={info.roster[other]} box={box} people={people} onCourt={opp} title={club(other).name} />
        </>
      )}

      {curTab === 'tiros' && (
        <section>
          <LiveCourt shots={shots} ink={ink} period={snap.period} shorts={shorts} names={names} />
        </section>
      )}

      {curTab === 'relato' && (
        <section>
          <ul className="pbp">
            {[...pbpUpTo].reverse().filter((e) => e[0] !== EV.SUB || e[3] === side).map((e, i) => (
              <li key={i} className={`${e[3] === 0 ? 'h' : 'a'} ${e[0] === EV.MADE || e[0] === EV.FT_MADE ? 'sc' : ''}`}>
                <span className="t">{e[0] === EV.START || e[0] === EV.END ? '' : clock(e[2]!)}</span>
                <span className="who">{e[0] === EV.START || e[0] === EV.END ? '' : shorts[e[3]!]}</span>
                <span className="tx">{e[0] === EV.START ? `Empieza el ${e[1]! <= 4 ? `${e[1]}º cuarto` : 'tiempo extra'}` : e[0] === EV.END ? 'Final del periodo' : pbpText(e, names)}{e[0] === EV.TIMEOUT && e[6] ? ' (automático)' : ''}</span>
                <span className="s" />
              </li>
            ))}
          </ul>
          {pbpUpTo.length === 0 && <p className="muted">Pulsa «▶» para empezar.</p>}
        </section>
      )}
    </div>
  );
}
void f1;

/** Planes guardados en directo: un toque cambia ataque, ritmo, plan de tiro y defensa (los emparejamientos se mantienen). */
function LivePresets({ clubId, disabled, onApply }: { clubId: number; disabled: boolean; onApply: (t: Tactics) => void }) {
  const { data } = useData<{ slot: number; name: string; tactics: Tactics }[]>('presets', { clubId }, [clubId]);
  const [cur, setCur] = useState<number | null>(null);
  if (!data || !data.length) return null;
  return (
    <section>
      <h3>Planes</h3>
      <div className="segs wrap">
        {data.map((p) => <button key={p.slot} className={cur === p.slot ? 'on' : ''} disabled={disabled} onClick={() => { setCur(p.slot); onApply(p.tactics); }}>{p.name}</button>)}
      </div>
    </section>
  );
}
