/**
 * Mapas de tiro en SVG. Las zonas se dibujan con la misma función que clasifica los tiros
 * (zoneOf), así que lo que se ve coincide exactamente con lo que se cuenta.
 */
import { useMemo, useState } from 'react';
import { COURT, CORNER_Y, ZONES, zoneOf } from '../core/court';
import { f0, pc } from './kit';

const X0 = -COURT.halfWidth;
const Y0 = COURT.baseline;
const W = COURT.halfWidth * 2;
const H = 112; // hasta 9,6 m del aro: cubre todos los triples razonables

/**
 * Geometría de las zonas, con las mismas fronteras que zoneOf (court.ts), dibujada por capas:
 * primero los triples, encima lo que queda dentro de la línea de 3, luego la zona y el aro.
 * Coordenadas del dibujo: x + 75, y + 16 (línea de fondo arriba, el aro a 1,6 m de ella).
 */
const T8 = Math.tan(Math.PI / 8);
const X = (x: number) => x - X0;
const Y = (y: number) => y - Y0;
const rect = (x1: number, y1: number, x2: number, y2: number) => `M${X(x1)} ${Y(y1)}H${X(x2)}V${Y(y2)}H${X(x1)}Z`;
const YMAX = H + Y0; // fondo del dibujo en coordenadas de pista
const INSIDE3 = `M${X(-COURT.corner)} ${Y(COURT.baseline)}V${Y(CORNER_Y)}A${COURT.three} ${COURT.three} 0 0 0 ${X(COURT.corner)} ${Y(CORNER_Y)}V${Y(COURT.baseline)}Z`;
const ZONE_SHAPES: { zone: number; d: string; clip?: boolean; circle?: boolean }[] = [
  { zone: 11, d: rect(-COURT.halfWidth, CORNER_Y, 0, YMAX) },
  { zone: 12, d: rect(0, CORNER_Y, COURT.halfWidth, YMAX) },
  { zone: 13, d: `M${X(0)} ${Y(0)}L${X(-T8 * YMAX)} ${Y(YMAX)}L${X(T8 * YMAX)} ${Y(YMAX)}Z` },
  { zone: 9, d: rect(-COURT.halfWidth, COURT.baseline, -COURT.corner, CORNER_Y) },
  { zone: 10, d: rect(COURT.corner, COURT.baseline, COURT.halfWidth, CORNER_Y) },
  { zone: 4, d: rect(-COURT.corner, COURT.baseline, -COURT.laneHalf, CORNER_Y) },
  { zone: 5, d: rect(COURT.laneHalf, COURT.baseline, COURT.corner, CORNER_Y) },
  { zone: 6, d: rect(-COURT.halfWidth, CORNER_Y, -COURT.laneHalf, YMAX), clip: true },
  { zone: 7, d: rect(COURT.laneHalf, CORNER_Y, COURT.halfWidth, YMAX), clip: true },
  { zone: 8, d: rect(-COURT.laneHalf, COURT.ftLineY, COURT.laneHalf, YMAX), clip: true },
  { zone: 1, d: rect(-COURT.laneHalf, COURT.baseline, -8, COURT.ftLineY) },
  { zone: 2, d: rect(-8, COURT.baseline, 8, COURT.ftLineY) },
  { zone: 3, d: rect(8, COURT.baseline, COURT.laneHalf, COURT.ftLineY) },
  { zone: 0, d: '', circle: true },
];
/** Dónde va la etiqueta de cada zona (coordenadas de pista). */
const LABEL_AT: Record<number, [number, number]> = {
  0: [0, 2], 1: [-16.5, 28], 2: [0, 30], 3: [16.5, 28], 4: [-45, -1], 5: [45, -1], 6: [-46, 34], 7: [46, 34], 8: [0, 54],
  9: [-66, 22], 10: [66, 22], 11: [-50, 76], 12: [50, 76], 13: [0, 84],
};

function CourtLines() {
  const hx = -X0;
  const hy = -Y0;
  const r3 = COURT.three;
  const a = Math.atan2(CORNER_Y, COURT.corner);
  return (
    <g fill="none" stroke="var(--line-strong)" strokeWidth="0.6">
      <rect x="0" y="0" width={W} height={H} />
      <rect x={hx - COURT.laneHalf} y="0" width={COURT.laneHalf * 2} height={COURT.ftLineY - Y0} />
      <circle cx={hx} cy={COURT.ftLineY + hy} r="18" />
      <path d={`M${hx - COURT.corner} 0V${hy + CORNER_Y}A${r3} ${r3} 0 0 0 ${hx + COURT.corner} ${hy + CORNER_Y}V0`} />
      <path d={`M${hx - COURT.rim} ${hy}A${COURT.rim} ${COURT.rim} 0 0 0 ${hx + COURT.rim} ${hy}`} />
      <line x1={hx - 9} y1={hy - 4} x2={hx + 9} y2={hy - 4} strokeWidth="1" />
      <circle cx={hx} cy={hy} r="2.3" />
      <title>{`Pista FIBA; ángulo de esquina ${Math.round((a * 180) / Math.PI)}°`}</title>
    </g>
  );
}

/** Color por diferencia con la media de la liga: rojo peor, amarillo parecido, verde mejor. Gris sin muestra. */
function heat(diff: number | null): string {
  if (diff === null) return 'var(--zone-empty)';
  if (diff <= -0.06) return 'var(--z-bad2)';
  if (diff <= -0.025) return 'var(--z-bad)';
  if (diff < 0.025) return 'var(--z-avg)';
  if (diff < 0.06) return 'var(--z-good)';
  return 'var(--z-good2)';
}

export interface ZoneStat { zone: number; fga: number; fgm: number }

export function ZoneMap({ mine, league, minShots = 3 }: { mine: ZoneStat[]; league: ZoneStat[]; minShots?: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const by = new Map(mine.map((z) => [z.zone, z]));
  const lg = new Map(league.map((z) => [z.zone, z]));
  const total = mine.reduce((a, z) => a + z.fga, 0);
  const rows = ZONES.map((z) => {
    const m = by.get(z.id);
    const l = lg.get(z.id);
    const p = m && m.fga ? m.fgm / m.fga : null;
    const lp = l && l.fga ? l.fgm / l.fga : null;
    return { ...z, fga: m?.fga ?? 0, fgm: m?.fgm ?? 0, p, lp, diff: p !== null && lp !== null && (m?.fga ?? 0) >= minShots ? p - lp : null, share: total ? (m?.fga ?? 0) / total : 0, ppt: p !== null ? p * z.pts : null };
  });
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="court zones" role="img" aria-label="Mapa de tiro por zonas">
        <defs>
          <clipPath id="inside3"><path d={INSIDE3} /></clipPath>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="var(--zone-empty)" />
        {ZONE_SHAPES.map((z) => {
          const r = rows[z.zone]!;
          const common = { fill: heat(r.diff), stroke: 'var(--zone-edge)', strokeWidth: 0.4, opacity: sel === null || sel === z.zone ? 1 : 0.4, onClick: () => setSel(sel === z.zone ? null : z.zone), className: 'tap' };
          return z.circle
            ? <circle key={z.zone} cx={X(0)} cy={Y(0)} r={COURT.rim} {...common}><title>{ZONES[z.zone]!.name}</title></circle>
            : <path key={z.zone} d={z.d} clipPath={z.clip ? 'url(#inside3)' : undefined} {...common}><title>{ZONES[z.zone]!.name}</title></path>;
        })}
        <CourtLines />
        {rows.map((r, i) => {
          if (r.fga === 0) return null;
          const [lx, ly] = LABEL_AT[i]!;
          const bw = 17;
          const bh = 12.6;
          const cx = Math.max(bw / 2 + 0.5, Math.min(W - bw / 2 - 0.5, X(lx)));
          const cy = Y(ly);
          return (
            <g key={i} pointerEvents="none">
              <rect x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh} rx="1.2" className="zbox" />
              <text x={cx} y={cy - 2.6} textAnchor="middle" className="zl1">{`${r.fgm}/${r.fga}`}</text>
              <text x={cx} y={cy + 1.3} textAnchor="middle" className="zl2">{r.p !== null ? `${(r.p * 100).toFixed(1).replace('.', ',')}%` : ''}</text>
              <text x={cx} y={cy + 4.9} textAnchor="middle" className="zl3">{r.lp !== null ? `Liga ${Math.round(r.lp * 100)}% · ${Math.round(r.share * 100)}%` : ''}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span className="sw" style={{ background: heat(-0.1) }} /> mucho peor
        <span className="sw" style={{ background: heat(-0.04) }} /> peor
        <span className="sw" style={{ background: heat(0) }} /> como la liga
        <span className="sw" style={{ background: heat(0.04) }} /> mejor
        <span className="sw" style={{ background: heat(0.1) }} /> mucho mejor
        <span className="sw" style={{ background: 'var(--zone-empty)' }} /> menos de {minShots} tiros
      </div>
      <p className="muted small" style={{ textAlign: 'center' }}>Cada caja: anotados/intentados, acierto, media de la liga en esa zona y qué parte de sus tiros hace desde ahí. Toca una zona para resaltarla.</p>
      <div className="tbl">
        <table>
          <thead>
            <tr><th className="l">Zona</th><th>Anot.</th><th>Int.</th><th>%</th><th>Liga %</th><th>Dif.</th><th>Pts/tiro</th><th>Cuota</th></tr>
          </thead>
          <tbody>
            {rows.filter((r) => r.fga > 0 || sel === r.id).map((r) => (
              <tr key={r.id} className={sel === r.id ? 'me' : ''} onClick={() => setSel(sel === r.id ? null : r.id)}>
                <td className="l">{r.name}</td>
                <td>{r.fgm}</td>
                <td>{r.fga}</td>
                <td>{pc(r.p)}</td>
                <td>{pc(r.lp)}</td>
                <td className={r.diff === null ? '' : r.diff >= 0 ? 'good' : 'bad'}>{r.diff === null ? '—' : `${r.diff >= 0 ? '+' : ''}${pc(r.diff)}`}</td>
                <td>{r.ppt === null ? '—' : r.ppt.toFixed(2).replace('.', ',')}</td>
                <td>{pc(r.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total === 0 && <p className="muted">Sin tiros en este filtro.</p>}
      <p className="muted">Total: {f0(total)} tiros de campo.</p>
    </div>
  );
}

export interface DotShot { x: number; y: number; made: boolean; label?: string }
/** Mapa de puntos: cada tiro, relleno si entró y hueco si no. */
export function DotMap({ shots, color = 'var(--accent)' }: { shots: DotShot[]; color?: string }) {
  const visible = useMemo(() => shots.filter((s) => s.y - Y0 < H), [shots]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="court" role="img" aria-label="Mapa de tiros">
      <rect x="0" y="0" width={W} height={H} fill="var(--zone-empty)" />
      <CourtLines />
      {visible.map((s, i) => (
        <circle key={i} cx={s.x - X0} cy={s.y - Y0} r="1.6" fill={s.made ? color : 'none'} stroke={s.made ? 'none' : 'var(--miss)'} strokeWidth="0.6">
          {s.label && <title>{s.label}</title>}
        </circle>
      ))}
    </svg>
  );
}
