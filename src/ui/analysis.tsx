/** Ficha del jugador: análisis ofensivo y defensivo, y evolución temporada a temporada. */
import type * as Q from '../core/queries';
import { reb } from '../core/stats';
import { Loading, f1, f2, mins, pc, seasonLabel, useData } from './kit';

type An = ReturnType<typeof Q.playerAnalysis>;
const AREA_LABEL: Record<string, string> = { aro: 'Cerca del aro', pintura: 'Pintura', media: 'Media distancia', triple: 'Triples' };

function Compare({ label, v, lg, fmt, better = 'high' }: { label: string; v: number | null; lg: number | null; fmt: (x: number | null) => string; better?: 'high' | 'low' }) {
  const diff = v !== null && lg !== null ? v - lg : null;
  const good = diff === null ? null : better === 'high' ? diff > 0 : diff < 0;
  return (
    <div className="cmprow">
      <span>{label}</span>
      <b className={good === null ? '' : good ? 'good' : 'bad'}>{fmt(v)}</b>
      <span className="muted small">liga {fmt(lg)}</span>
    </div>
  );
}

export function AnalysisView({ id, season }: { id: number; season: number }) {
  const { data, error } = useData<An>('analysis', { id, season }, [id, season]);
  if (!data) return <Loading error={error} />;
  if (!data.gp) return <section><p className="muted">Todavía no ha jugado esta temporada.</p></section>;
  const o = data.offense;
  const d = data.defense;
  const total = Object.values(o.area).reduce((a, x) => a + x.fga, 0);
  return (
    <>
      <section>
        <h3>Ataque · {seasonLabel(season)}</h3>
        <p className="muted small">{data.gp} partidos, {f1(data.min / data.gp)} minutos por partido. Todas las competiciones.</p>
        <div className="tbl">
          <table>
            <thead><tr><th className="l">Desde</th><th>Reparto</th><th>Acierto</th><th>Liga</th></tr></thead>
            <tbody>
              {Object.entries(o.area).map(([k, a]) => {
                const p = a.fga ? a.fgm / a.fga : null;
                const l = a.lga ? a.lgm / a.lga : null;
                return (
                  <tr key={k}>
                    <td className="l">{AREA_LABEL[k]}</td>
                    <td><span className="minibar"><i style={{ width: `${total ? (a.fga / total) * 100 : 0}%` }} /></span> {pc(total ? a.fga / total : null)}</td>
                    <td className={p !== null && l !== null && a.fga >= 5 ? (p >= l ? 'good' : 'bad') : ''}>{pc(p)}</td>
                    <td className="muted">{pc(l)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Compare label="Puntos por tiro de campo" v={o.ptsPerShot} lg={o.lgPtsPerShot} fmt={f2} />
        <div className="cmprow"><span>Canastas asistidas</span><b>{pc(o.assistedShare)}</b><span className="muted small">{o.assistedShare !== null && o.assistedShare < 0.45 ? 'se crea su tiro' : 'vive del pase'}</span></div>
        <div className="cmprow"><span>Tiros libres por tiro de campo</span><b>{f2(o.ftRate)}</b><span className="muted small">{o.ftRate !== null && o.ftRate > 0.35 ? 'provoca muchas faltas' : ''}</span></div>
        <div className="cmprow"><span>Por 36 minutos</span><b>{f1(o.ptsPer36)} pts · {f1(o.astPer36)} ast · {f1(o.tovPer36)} pér</b><span className="muted small">AST/PÉR {f2(o.astTov)}</span></div>
      </section>
      <section>
        <h3>Defensa</h3>
        <Compare label="Acierto del rival cuando le defiende" v={d.oppPct} lg={d.lgOppPct} fmt={pc} better="low" />
        <p className="muted small">{d.dfga} tiros defendidos como defensor asignado ({d.dfgm} anotados). Depende también de a quién le toca defender.</p>
        <Compare label="Robos por 36 min" v={d.stlPer36} lg={d.lgStl36} fmt={f1} />
        <Compare label="Tapones por 36 min" v={d.blkPer36} lg={d.lgBlk36} fmt={f1} />
        <Compare label="Rebotes defensivos por 36 min" v={d.drbPer36} lg={d.lgDrb36} fmt={f1} />
        <div className="cmprow"><span>Faltas por 36 min</span><b>{f1(d.pfPer36)}</b><span /></div>
      </section>
    </>
  );
}

type Evo = ReturnType<typeof Q.playerEvolution>;
export function EvolutionView({ id }: { id: number }) {
  const { data, error } = useData<Evo>('evolution', { id }, [id]);
  if (!data) return <Loading error={error} />;
  const A = data.attrs;
  const W = 300;
  const H = 120;
  const lo = Math.max(0, Math.min(...A.map((a) => Math.min(a.ovr, a.off, a.def, a.fis))) - 5);
  const hi = Math.min(99, Math.max(...A.map((a) => Math.max(a.ovr, a.off, a.def, a.fis))) + 5);
  const X = (i: number) => (A.length === 1 ? W / 2 : 16 + (i * (W - 32)) / (A.length - 1));
  const Y = (v: number) => H - 14 - ((v - lo) / Math.max(1, hi - lo)) * (H - 28);
  const line = (k: 'ovr' | 'off' | 'def' | 'fis') => A.map((a, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(a[k]).toFixed(1)}`).join('');
  const SERIES: ['ovr' | 'off' | 'def' | 'fis', string, string][] = [['ovr', 'Media', 'var(--accent)'], ['off', 'Ataque', '#3aa0d8'], ['def', 'Defensa', '#3fbf7f'], ['fis', 'Físico', '#b07ad8']];
  return (
    <>
      <section>
        <h3>Media y atributos por temporada</h3>
        <svg viewBox={`0 0 ${W} ${H}`} className="evo" role="img" aria-label="Evolución de la media">
          {SERIES.map(([k, , c]) => <path key={k} d={line(k)} fill="none" stroke={c} strokeWidth={k === 'ovr' ? 2.4 : 1.4} />)}
          {A.map((a, i) => (
            <g key={a.season}>
              <circle cx={X(i)} cy={Y(a.ovr)} r="2.6" fill="var(--accent)" />
              <text x={X(i)} y={Y(a.ovr) - 5} textAnchor="middle" fontSize="8" fill="var(--ink)">{a.ovr}</text>
              <text x={X(i)} y={H - 2} textAnchor="middle" fontSize="7" fill="var(--muted)">{seasonLabel(a.season)}</text>
            </g>
          ))}
        </svg>
        <div className="legend">{SERIES.map(([k, l, c]) => <span key={k}><span className="sw" style={{ background: c }} /> {l}</span>)}</div>
      </section>
      <section>
        <h3>Estadísticas por temporada</h3>
        <div className="tbl">
          <table>
            <thead><tr><th className="l">Temp.</th><th className="l">Club</th><th>PJ</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>T2%</th><th>T3%</th><th>T1%</th></tr></thead>
            <tbody>
              {data.stats.map((s) => {
                const l = s.line;
                const g = l.gp || 1;
                return (
                  <tr key={s.season}>
                    <td className="l">{seasonLabel(s.season)}</td>
                    <td className="l">{s.clubs}</td>
                    <td>{l.gp}</td><td>{mins(l.sec, l.gp)}</td><td>{f1(l.pts / g)}</td><td>{f1(reb(l) / g)}</td><td>{f1(l.ast / g)}</td>
                    <td>{pc(l.fga2 ? l.fgm2 / l.fga2 : null)}</td><td>{pc(l.fga3 ? l.fgm3 / l.fga3 : null)}</td><td>{pc(l.fta ? l.ftm / l.fta : null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.stats.length === 0 && <p className="muted">Sin partidos todavía.</p>}
        <p className="muted small">Por partido; suma todas las competiciones de la temporada.</p>
      </section>
    </>
  );
}
