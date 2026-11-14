/** Resumen de fin de temporada (v0.9): una sola pantalla con todo lo importante del año. */
import type * as S from '../core/summary';
import { eur } from './market';
import { Loading, type Nav, f1, seasonLabel, shortName, useData } from './kit';

type Summary = ReturnType<typeof S.seasonSummary>;

export function SeasonSummary({ nav, season }: { nav: Nav; season?: number }) {
  const { data, error } = useData<Summary>('seasonSummary', { season }, [season]);
  if (!data) return <Loading error={error} />;
  const m = data.money;
  const net = m.gate + m.sponsor + m.prizes - m.costs;
  return (
    <section className="summary">
      <h3>Resumen de la temporada {seasonLabel(data.season)}</h3>
      <div className="sumhead">
        <div><small>{data.league}</small><b>{data.pos}º de {data.teams}</b><span className="muted">{data.w}-{data.l}</span></div>
        <div><small>Títulos</small><b>{data.titles.length ? `🏆 ${data.titles.length}` : '—'}</b><span className="muted">{data.titles.join(', ') || 'ninguno'}</span></div>
      </div>
      {data.promoted && <p className="good"><b>⬆️ ¡Ascenso a la Liga ACB!</b></p>}
      {data.relegated && <p className="bad"><b>⬇️ Descenso a la Primera FEB.</b></p>}
      {data.runs.length > 0 && (
        <ul className="plain sumlist">
          {data.runs.map((r) => <li key={r.comp}><span>{r.comp}</span><b>{r.result}</b>{r.champion && !r.result.startsWith('🏆') && <small className="muted">campeón: {r.champion}</small>}</li>)}
        </ul>
      )}

      {data.objective && (
        <>
          <h4 className="aw">Directiva</h4>
          <p className="small">Objetivo: <b>{data.objective.label}</b> · {data.objective.result ? <b className={data.objective.result === 'fallado' ? 'bad' : 'good'}>{data.objective.result}</b> : <span className="muted">sin evaluar</span>}{data.objective.delta !== null && <> · presupuesto {data.objective.delta > 0 ? '+' : ''}{Math.round((data.objective.delta ?? 0) * 100)} %</>} · confianza {Math.round(data.confidence)}</p>
        </>
      )}

      <h4 className="aw">Dinero {m.closed ? '' : '(previsión al cerrar la temporada)'}</h4>
      <div className="kv small">
        <span>Taquilla</span><b className="good">{eur(m.gate)}</b>
        <span>Patrocinio</span><b className="good">{eur(m.sponsor)}</b>
        <span>Premios</span><b className="good">{eur(m.prizes)}</b>
        <span>Gastos fijos</span><b className="bad">−{eur(m.costs)}</b>
        <span>Balance</span><b className={net >= 0 ? 'good' : 'bad'}>{net >= 0 ? '+' : '−'}{eur(Math.abs(net))}</b>
        <span>Sueldos</span><b>{eur(m.wages)} de {eur(m.budget)}</b>
        <span>Caja al cerrar</span><b>{eur(m.cashEnd)}</b>
        <span>Presupuesto {m.closed ? 'actual' : 'previsto'}</span><b>{eur(m.nextBudget)}</b>
      </div>
      {!m.closed && <p className="muted small">El presupuesto previsto no incluye todavía el ajuste por ascenso o descenso.</p>}

      {data.awards.length > 0 && (
        <>
          <h4 className="aw">Premios</h4>
          <ul className="plain sumlist">
            {data.awards.map((a, i) => <li key={i} className="tap" onClick={() => nav.player(a.player_id)}><span>{a.label}{a.award === 'quinteto' ? '' : ''}</span><b className={a.mine ? 'good' : ''}>{shortName(a.name)}</b></li>)}
          </ul>
        </>
      )}

      <h4 className="aw">Los mejores del equipo</h4>
      <ul className="plain sumlist">
        {data.leaders.pts && <li className="tap" onClick={() => nav.player(data.leaders.pts!.id)}><span>Puntos</span><b>{shortName(data.leaders.pts.name)} · {f1(data.leaders.pts.value)}</b></li>}
        {data.leaders.reb && <li className="tap" onClick={() => nav.player(data.leaders.reb!.id)}><span>Rebotes</span><b>{shortName(data.leaders.reb.name)} · {f1(data.leaders.reb.value)}</b></li>}
        {data.leaders.ast && <li className="tap" onClick={() => nav.player(data.leaders.ast!.id)}><span>Asistencias</span><b>{shortName(data.leaders.ast.name)} · {f1(data.leaders.ast.value)}</b></li>}
      </ul>

      {data.expiring.length > 0 && (
        <>
          <h4 className="aw">Terminan contrato ({data.expiring.length})</h4>
          <ul className="plain sumlist">
            {data.expiring.map((p) => (
              <li key={p.id} className="tap" onClick={() => nav.player(p.id)}>
                <span>{shortName(p.name)} <small className="muted">{p.pos1} · {p.ovr} · {p.age} años</small></span>
                <b>pide ~{eur(p.ask)} ›</b>
              </li>
            ))}
          </ul>
          <p className="muted small">Toca a uno para renovarlo. Si no renuevas, se marcha al empezar la temporada siguiente.</p>
        </>
      )}

      {(data.youth.length > 0 || data.college.length > 0) && (
        <>
          <h4 className="aw">Jóvenes</h4>
          {data.youth.length > 0 && <p className="small muted">Tu cantera</p>}
          <ul className="plain sumlist">
            {data.youth.map((p) => <li key={p.id} className="tap" onClick={() => nav.player(p.id)}><span>{shortName(p.name)} <small className="muted">{p.pos1} · {p.age} años</small></span><b>{p.ovr} · pot. {p.potential_est}</b></li>)}
          </ul>
          {data.college.length > 0 && <p className="small muted">Universitarios que pueden salir al mercado este verano</p>}
          <ul className="plain sumlist">
            {data.college.map((p) => <li key={p.id} className="tap" onClick={() => nav.player(p.id)}><span>{shortName(p.name)} <small className="muted">{p.pos1} · {p.age} años · {p.club}</small></span><b>{p.ovr} · pot. {p.potential_est}</b></li>)}
          </ul>
        </>
      )}
    </section>
  );
}
