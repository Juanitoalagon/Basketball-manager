/** Quintetos (v0.9): qué cinco jugadores funcionan mejor juntos, con su +/- y su +/- por cada 40 minutos. */
import { useState } from 'react';
import type * as SC from '../core/scouting';
import { Loading, type Nav, POS_ORDER, Tabs, f1, shortName, signed, useData } from './kit';

type Unit = ReturnType<typeof SC.lineupUnits>[number];
type Sort = 'min' | 'best' | 'worst';

export function UnitsView({ clubId, nav }: { clubId: number; nav: Nav }) {
  const { data, error } = useData<Unit[]>('units', { clubId }, [clubId]);
  const [sort, setSort] = useState<Sort>('min');
  if (!data) return <Loading error={error} />;
  // Para «mejores» y «peores», solo los que llevan al menos 10 minutos juntos (con menos, el +/- es ruido).
  const pool = sort === 'min' ? data : data.filter((u) => u.sec >= 600);
  const rows = [...pool].sort((a, b) => (sort === 'min' ? b.sec - a.sec : sort === 'best' ? b.net40 - a.net40 : a.net40 - b.net40)).slice(0, 15);
  return (
    <section>
      <h3>Quintetos</h3>
      <p className="muted small">Cada combinación de cinco jugadores que ha estado en pista esta temporada (solo en tus partidos completos): minutos juntos, +/- (puntos a favor menos en contra) y +/- por cada 40 minutos.</p>
      <Tabs<Sort> small value={sort} onChange={setSort} options={[['min', 'Más usados'], ['best', 'Mejores'], ['worst', 'Peores']]} />
      {rows.length === 0 && <p className="muted">Todavía no hay datos: juega algún partido.</p>}
      <ul className="plain units">
        {rows.map((u) => (
          <li key={u.five}>
            <div className="five">
              {[...u.players].sort((a, b) => (POS_ORDER[a.pos1] ?? 9) - (POS_ORDER[b.pos1] ?? 9)).map((p) => <span key={p.id} className="tap" onClick={() => nav.player(p.id)}><small>{p.pos1}</small> {shortName(p.name)}</span>)}
            </div>
            <div className="nums">
              <span><b>{f1(u.sec / 60)}</b><small>min</small></span>
              <span><b className={u.pf - u.pa > 0 ? 'good' : u.pf - u.pa < 0 ? 'bad' : ''}>{signed(u.pf - u.pa)}</b><small>+/-</small></span>
              <span><b className={u.net40 > 0 ? 'good' : u.net40 < 0 ? 'bad' : ''}>{signed(Math.round(u.net40))}</b><small>por 40</small></span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
