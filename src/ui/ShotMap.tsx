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
const STEP = 1.5;

/** Contorno de cada zona como un único path hecho de celdas. Se calcula una vez. */
let zonePaths: { d: string; cx: number; cy: number }[] | null = null;
function getZonePaths() {
  if (zonePaths) return zonePaths;
  const parts: string[][] = ZONES.map(() => []);
  const sum = ZONES.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let gy = 0; gy < H; gy += STEP) {
    for (let gx = 0; gx < W; gx += STEP) {
      const x = X0 + gx + STEP / 2;
      const y = Y0 + gy + STEP / 2;
      const z = zoneOf(x, y);
      parts[z]!.push(`M${gx} ${gy}h${STEP}v${STEP}h-${STEP}z`);
      sum[z]!.x += gx;
      sum[z]!.y += gy;
      sum[z]!.n += 1;
    }
  }
  const centre: Record<number, [number, number]> = { 9: [5, 12], 10: [W - 5, 12], 0: [W / 2, 22] };
  zonePaths = parts.map((p, i) => ({
    d: p.join(''),
    cx: centre[i]?.[0] ?? sum[i]!.x / Math.max(1, sum[i]!.n) + STEP / 2,
    cy: centre[i]?.[1] ?? sum[i]!.y / Math.max(1, sum[i]!.n) + STEP / 2,
  }));
  return zonePaths;
}

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

/** Color por diferencia con la media de la liga: azul frío, gris igual, rojo caliente. */
function heat(diff: number | null): string {
  if (diff === null) return 'var(--zone-empty)';
  const t = Math.max(-1, Math.min(1, diff / 0.12));
  if (t >= 0) return `color-mix(in oklab, var(--hot) ${Math.round(t * 85 + 10)}%, var(--zone-mid))`;
  return `color-mix(in oklab, var(--cold) ${Math.round(-t * 85 + 10)}%, var(--zone-mid))`;
}

export interface ZoneStat { zone: number; fga: number; fgm: number }

export function ZoneMap({ mine, league, minShots = 3 }: { mine: ZoneStat[]; league: ZoneStat[]; minShots?: number }) {
  const paths = getZonePaths();
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
      <svg viewBox={`0 0 ${W} ${H}`} className="court" role="img" aria-label="Mapa de tiro por zonas">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={heat(rows[i]!.diff)} stroke="none" shapeRendering="crispEdges" opacity={sel === null || sel === i ? 1 : 0.45} onClick={() => setSel(sel === i ? null : i)}>
            <title>{`${ZONES[i]!.name}: ${rows[i]!.fgm}/${rows[i]!.fga}`}</title>
          </path>
        ))}
        <CourtLines />
        {rows.map((r, i) =>
          r.fga > 0 ? (
            <g key={i} pointerEvents="none">
              <text x={paths[i]!.cx} y={paths[i]!.cy} textAnchor="middle" className="zl1">{r.p !== null ? `${Math.round(r.p * 100)}%` : ''}</text>
              <text x={paths[i]!.cx} y={paths[i]!.cy + 4.6} textAnchor="middle" className="zl2">{`${r.fgm}/${r.fga}`}</text>
            </g>
          ) : null,
        )}
      </svg>
      <div className="legend">
        <span className="sw" style={{ background: heat(-0.12) }} /> peor que la liga
        <span className="sw" style={{ background: heat(0) }} /> igual
        <span className="sw" style={{ background: heat(0.12) }} /> mejor
        <span className="sw" style={{ background: 'var(--zone-empty)' }} /> menos de {minShots} tiros
      </div>
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
