/** Mercado: jugadores de toda la liga, contrato y operaciones de un jugador, finanzas del club y noticias. */
import { useMemo, useState } from 'react';
import type * as Q from '../core/queries';
import { fga, fgm, reb } from '../core/stats';
import { call } from '../db/client';
import { cupoOf } from '../core/names';
import { type Col, CupoTag, Loading, type Nav, Table, Tabs, f1, f2, mins, pc, pcRaw, seasonLabel, signed, useData } from './kit';

export const eur = (x: number | null | undefined) =>
  x === null || x === undefined ? '—' : Math.abs(x) >= 1e6 ? `${(x / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 2 })} M€` : `${Math.round(x / 1000).toLocaleString('es-ES')} mil €`;
const untilLabel = (y: number | null) => (y === null ? '—' : seasonLabel(y));

/* ───────────────────────────── Jugadores de la liga ───────────────────────────── */

type PRow = ReturnType<typeof Q.allPlayers>[number];
type Grp = 'basic' | 'shoot' | 'adv' | 'market';

export function PlayersScreen({ nav, myClub }: { nav: Nav; myClub: number }) {
  const { data, error } = useData<PRow[]>('allPlayers', null, []);
  const [scope, setScope] = useState<'acb' | 'feb' | 'europa' | 'libres' | 'todos'>('acb');
  const [cupo, setCupo] = useState('');
  const [pos, setPos] = useState('');
  const [maxAge, setMaxAge] = useState(40);
  const [minGp, setMinGp] = useState(0);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Grp>('basic');
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.filter((r) =>
      (scope === 'todos' || (scope === 'libres' ? r.club_id === null : scope === 'europa' ? r.club_id !== null && r.country !== 'ES' : scope === 'acb' ? r.comp === 1 : r.comp === 2)) &&
      (!cupo || cupoOf(r.nationality) === cupo) &&
      (!pos || r.pos1 === pos || r.pos2 === pos) && r.age <= maxAge && (r.line?.gp ?? 0) >= minGp &&
      (!needle || r.name.toLowerCase().includes(needle)));
  }, [data, scope, pos, maxAge, minGp, q, cupo]);
  if (!data) return <Loading error={error} />;
  const L = (r: PRow) => r.line;
  const pg = (r: PRow, v: (l: NonNullable<PRow['line']>) => number) => (L(r) && L(r)!.gp ? v(L(r)!) / L(r)!.gp : null);
  const base: Col<PRow>[] = [
    { key: 'name', label: 'Jugador', left: true, value: (r) => r.name, render: (r) => <><CupoTag nationality={r.nationality} /> {r.name}</> },
    { key: 'club', label: 'Club', left: true, value: (r) => r.club ?? 'Libre', render: (r) => (r.club_id === null ? <span className="good">Libre</span> : r.club_id === myClub ? <b>{r.club}</b> : r.club) },
    { key: 'pos', label: 'Pos.', value: (r) => r.pos1, render: (r) => `${r.pos1}${r.pos2 ? `/${r.pos2}` : ''}` },
  ];
  const groups: Record<Grp, Col<PRow>[]> = {
    basic: [
      { key: 'gp', label: 'PJ', value: (r) => L(r)?.gp ?? 0 },
      { key: 'min', label: 'MIN', value: (r) => pg(r, (l) => l.sec / 60), render: (r) => (L(r) ? mins(L(r)!.sec, L(r)!.gp) : '—') },
      { key: 'pts', label: 'PTS', value: (r) => pg(r, (l) => l.pts), render: (r) => f1(pg(r, (l) => l.pts)) },
      { key: 'reb', label: 'REB', value: (r) => pg(r, reb), render: (r) => f1(pg(r, reb)) },
      { key: 'ast', label: 'AST', value: (r) => pg(r, (l) => l.ast), render: (r) => f1(pg(r, (l) => l.ast)) },
      { key: 'stl', label: 'ROB', value: (r) => pg(r, (l) => l.stl), render: (r) => f1(pg(r, (l) => l.stl)) },
      { key: 'blk', label: 'TAP', value: (r) => pg(r, (l) => l.blk), render: (r) => f1(pg(r, (l) => l.blk)) },
      { key: 'pir', label: 'VAL', value: (r) => pg(r, (l) => l.pir), render: (r) => f1(pg(r, (l) => l.pir)) },
    ],
    shoot: [
      { key: 'fg', label: 'TC%', value: (r) => (L(r) && fga(L(r)!) ? fgm(L(r)!) / fga(L(r)!) : null), render: (r) => pc(L(r) && fga(L(r)!) ? fgm(L(r)!) / fga(L(r)!) : null) },
      { key: 't2p', label: 'T2%', value: (r) => (L(r)?.fga2 ? L(r)!.fgm2 / L(r)!.fga2 : null), render: (r) => pc(L(r)?.fga2 ? L(r)!.fgm2 / L(r)!.fga2 : null) },
      { key: 't3a', label: 'T3/p', title: 'Triples intentados por partido', value: (r) => pg(r, (l) => l.fga3), render: (r) => f1(pg(r, (l) => l.fga3)) },
      { key: 't3p', label: 'T3%', value: (r) => (L(r)?.fga3 ? L(r)!.fgm3 / L(r)!.fga3 : null), render: (r) => pc(L(r)?.fga3 ? L(r)!.fgm3 / L(r)!.fga3 : null) },
      { key: 't1p', label: 'T1%', value: (r) => (L(r)?.fta ? L(r)!.ftm / L(r)!.fta : null), render: (r) => pc(L(r)?.fta ? L(r)!.ftm / L(r)!.fta : null) },
      { key: 'efg', label: 'eFG%', value: (r) => L(r)?.efg ?? null, render: (r) => pc(L(r)?.efg) },
      { key: 'ts', label: 'TS%', value: (r) => L(r)?.ts ?? null, render: (r) => pc(L(r)?.ts) },
    ],
    adv: [
      { key: 'usg', label: 'USG%', value: (r) => L(r)?.usg ?? null, render: (r) => pcRaw(L(r)?.usg) },
      { key: 'astp', label: 'AST%', value: (r) => L(r)?.astPct ?? null, render: (r) => pcRaw(L(r)?.astPct) },
      { key: 'rebp', label: 'REB%', value: (r) => L(r)?.rebPct ?? null, render: (r) => pcRaw(L(r)?.rebPct) },
      { key: 'ws', label: 'WS', value: (r) => L(r)?.ws ?? null, render: (r) => f1(L(r)?.ws) },
      { key: 'ws40', label: 'WS/40', value: (r) => L(r)?.ws40 ?? null, render: (r) => (L(r) ? f2(L(r)!.ws40) : '—') },
      { key: 'va', label: 'VA', value: (r) => L(r)?.va ?? null, render: (r) => f1(L(r)?.va) },
      { key: 'pm', label: '+/-', value: (r) => L(r)?.pm ?? null, render: (r) => (L(r) ? signed(L(r)!.pm) : '—') },
    ],
    market: [
      { key: 'age', label: 'Edad', value: (r) => r.age },
      { key: 'ovr', label: 'Media', value: (r) => r.ovr },
      { key: 'pot', label: 'Pot.', value: (r) => r.potential_est },
      { key: 'value', label: 'Valor', value: (r) => (r.club_id === null ? 0 : r.value), render: (r) => (r.club_id === null ? 'libre' : eur(r.value)) },
      { key: 'salary', label: 'Sueldo', value: (r) => r.salary ?? r.ask, render: (r) => (r.salary ? eur(r.salary) : <span className="muted">pide {eur(r.ask)}</span>) },
      { key: 'until', label: 'Hasta', value: (r) => r.until ?? 0, render: (r) => untilLabel(r.until) },
      { key: 'inj', label: 'Estado', value: (r) => r.injury_games, render: (r) => (r.injury_games ? <span className="bad">✚ {r.injury_games}</span> : '') },
    ],
  };
  return (
    <div>
      <h2>Jugadores</h2>
      <Tabs<typeof scope> value={scope} onChange={setScope} options={[['acb', 'Liga ACB'], ['feb', 'Primera FEB'], ['europa', 'Europa'], ['libres', 'Agentes libres'], ['todos', 'Todos']]} />
      <div className="filters">
        <input type="text" placeholder="Buscar por nombre" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <select value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Posición">
          <option value="">Todas las posiciones</option>
          {['PG', 'SG', 'SF', 'PF', 'C'].map((p) => (<option key={p} value={p}>{p}</option>))}
        </select>
        <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} aria-label="Edad máxima">
          {[40, 30, 27, 24, 21].map((a) => (<option key={a} value={a}>{a === 40 ? 'Cualquier edad' : `Hasta ${a} años`}</option>))}
        </select>
        <select value={cupo} onChange={(e) => setCupo(e.target.value)} aria-label="Cupo">
          <option value="">Cualquier cupo</option>
          <option value="NAC">Nacionales (NAC)</option>
          <option value="COM">Comunitarios (COM)</option>
          <option value="EXT">Extracomunitarios (EXT)</option>
        </select>
        <select value={minGp} onChange={(e) => setMinGp(Number(e.target.value))} aria-label="Partidos mínimos">
          {[0, 5, 10, 20].map((g) => (<option key={g} value={g}>{g ? `${g}+ partidos` : 'Con o sin partidos'}</option>))}
        </select>
      </div>
      <Tabs<Grp> small value={group} onChange={setGroup} options={[['basic', 'Básicas'], ['shoot', 'Tiro'], ['adv', 'Avanzadas'], ['market', 'Mercado']]} />
      <Table cols={[...base, ...groups[group]]} rows={rows} rowKey={(r) => r.id} onRow={(r) => nav.player(r.id)} highlight={(r) => r.club_id === myClub}
        defaultSort={group === 'market' ? { key: 'ovr', desc: true } : group === 'adv' ? { key: 'va', desc: true } : group === 'shoot' ? { key: 'ts', desc: true } : { key: 'pir', desc: true }} />
      <p className="muted small">{rows.length} jugadores · por partido, fase regular (en Europa, toda la competición) · NAC nacional, COM comunitario, EXT extracomunitario (máx. 2 por plantilla, mín. 4 nacionales) · toca la cabecera para ordenar y un jugador para ver su ficha y negociar.</p>
    </div>
  );
}

/* ───────────────────────────── Contrato y operaciones ───────────────────────────── */

type Market = { club_id: number | null; salary: number | null; until: number | null; ask: number; value: number; yearsLeft: number; releaseCost: number; morale: number; injury_games: number; canRenew: boolean; marketOpen: boolean; phase: string };
type Result = { ok: boolean; message: string };

function moraleLabel(m: number) {
  return m >= 80 ? ['Muy contento', 'good'] : m >= 60 ? ['Contento', 'good'] : m >= 40 ? ['Normal', ''] : m >= 25 ? ['Descontento', 'warn'] : ['Muy descontento', 'bad'];
}

export function ContractCard({ id, myClub, injury, onChanged }: { id: number; myClub: number; injury: string | null; onChanged: () => void }) {
  const { data, error, reload } = useData<Market>('market', { id }, [id]);
  const [mode, setMode] = useState<null | 'sign' | 'buy' | 'renew' | 'sell' | 'release'>(null);
  const [fee, setFee] = useState(0);
  const [salary, setSalary] = useState(0);
  const [years, setYears] = useState(2);
  const [offers, setOffers] = useState<{ club_id: number; club: string; fee: number }[] | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading error={error} />;
  const mine = data.club_id === myClub;
  const free = data.club_id === null;
  const [ml, mc] = moraleLabel(data.morale);
  const open = (m: typeof mode) => {
    setRes(null);
    setMode(m);
    setSalary(data.ask);
    setFee(data.value);
    setYears(2);
    if (m === 'sell') void call<typeof offers>('offers', { id }).then(setOffers);
  };
  const run = async (op: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await call<Result>(op, { id, ...args });
      setRes(r);
      if (r.ok) {
        setMode(null);
        reload();
        onChanged();
      }
    } catch (e) {
      setRes({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const money = (label: string, v: number, set: (x: number) => void, step: number) => (
    <label className="money">
      {label}
      <span className="row tight">
        <button className="sec" onClick={() => set(Math.max(0, v - step))} aria-label={`Bajar ${label}`}>−</button>
        <b>{eur(v)}</b>
        <button className="sec" onClick={() => set(v + step)} aria-label={`Subir ${label}`}>+</button>
      </span>
    </label>
  );
  const yearsSel = (
    <label className="money">
      Años de contrato
      <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
        {[1, 2, 3, 4].map((y) => (<option key={y} value={y}>{y}</option>))}
      </select>
    </label>
  );
  return (
    <div>
      <h3>Contrato y mercado</h3>
      <dl>
        <dt>Situación</dt>
        <dd>{free ? <span className="good">Agente libre</span> : `${eur(data.salary)} por temporada, hasta ${untilLabel(data.until)}`}</dd>
        {!free && (<><dt>Valor de mercado</dt><dd>{eur(data.value)}</dd></>)}
        <dt>Pediría</dt><dd>{eur(data.ask)} por temporada</dd>
        <dt>Moral</dt><dd className={mc}>{ml} ({data.morale})</dd>
        {data.injury_games > 0 && (<><dt>Lesión</dt><dd className="bad">✚ {injury ?? 'Lesionado'} · {data.injury_games} {data.injury_games === 1 ? 'partido' : 'partidos'} de baja</dd></>)}
      </dl>
      {!data.marketOpen && <p className="muted small">El mercado está cerrado durante los playoffs.</p>}
      {res && <p className={res.ok ? 'ok' : 'error'}>{res.message}</p>}
      {data.marketOpen && !mode && (
        <div className="row">
          {free && <button onClick={() => open('sign')}>Fichar</button>}
          {!free && !mine && <button onClick={() => open('buy')}>Hacer oferta</button>}
          {mine && data.canRenew && <button onClick={() => open('renew')}>Renovar</button>}
          {mine && <button className="sec" onClick={() => open('sell')}>Buscar comprador</button>}
          {mine && <button className="dangerBtn" onClick={() => open('release')}>Rescindir</button>}
        </div>
      )}
      {mode === 'sign' && (
        <div className="card">
          {money('Sueldo por temporada', salary, setSalary, 10_000)}
          {yearsSel}
          <div className="row"><button disabled={busy} onClick={() => run('sign', { clubId: myClub, salary, years })}>Ofrecer contrato</button><button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
      {mode === 'buy' && (
        <div className="card">
          {money('Traspaso al club', fee, setFee, 50_000)}
          {money('Sueldo por temporada', salary, setSalary, 10_000)}
          {yearsSel}
          <p className="muted small">Se paga de tu caja; el sueldo cuenta para tu presupuesto salarial. Si es de los mejores de su club, pedirán más.</p>
          <div className="row"><button disabled={busy} onClick={() => run('buy', { clubId: myClub, fee, salary, years })}>Enviar oferta</button><button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
      {mode === 'renew' && (
        <div className="card">
          {money('Sueldo por temporada', salary, setSalary, 10_000)}
          {yearsSel}
          <p className="muted small">Los años se suman al contrato actual. Si está descontento pedirá más.</p>
          <div className="row"><button disabled={busy} onClick={() => run('renew', { salary, years })}>Ofrecer renovación</button><button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
      {mode === 'sell' && (
        <div className="card">
          {!offers ? <p className="muted">Consultando a los clubes…</p> : offers.length === 0 ? <p className="muted">Ningún club puede o quiere pagar por él ahora mismo.</p> : (
            <ul className="plain">
              {offers.map((o) => (
                <li key={o.club_id} className="clubs-offer">
                  <span>{o.club}: <b>{eur(o.fee)}</b></span>
                  <button disabled={busy} onClick={() => run('sell', { toClub: o.club_id })}>Aceptar</button>
                </li>
              ))}
            </ul>
          )}
          <div className="row"><button className="sec" onClick={() => setMode(null)}>Cerrar</button></div>
        </div>
      )}
      {mode === 'release' && (
        <div className="card danger">
          <p>Rescindir cuesta <b>{eur(data.releaseCost)}</b> (la mitad de lo que le queda de contrato) y el jugador queda libre.</p>
          <div className="row"><button className="dangerBtn" disabled={busy} onClick={() => run('release', {})}>Rescindir contrato</button><button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Finanzas ───────────────────────────── */

type Fin = ReturnType<typeof import('../core/market').finances>;

export function FinanceScreen({ clubId, nav }: { clubId: number; nav: Nav }) {
  const { data, error } = useData<Fin>('finances', { clubId }, [clubId]);
  if (!data) return <Loading error={error} />;
  const room = data.club.budget - data.payroll;
  const expiring = data.contracts.filter((c) => c.until <= data.season);
  return (
    <div>
      <section>
        <h3>Cuentas de la temporada {seasonLabel(data.season)}</h3>
        <div className="kpis">
          <div><div className="kv">{eur(data.club.budget)}</div><div className="kk">Presupuesto salarial</div></div>
          <div><div className="kv">{eur(data.payroll)}</div><div className="kk">Masa salarial</div></div>
          <div><div className={`kv ${room < 0 ? 'bad' : 'good'}`}>{eur(room)}</div><div className="kk">Margen</div></div>
          <div><div className={`kv ${data.club.cash < 0 ? 'bad' : ''}`}>{eur(data.club.cash)}</div><div className="kk">Caja para traspasos</div></div>
        </div>
        <p className="muted small">El margen salarial que no gastes pasa a la caja al acabar la temporada. Los premios (playoffs, final, título) también. Con deudas, el presupuesto del año siguiente baja.</p>
      </section>
      {expiring.length > 0 && (
        <section>
          <h3>Contratos que terminan esta temporada</h3>
          <ul className="plain">
            {expiring.map((c) => (
              <li key={c.id} className="tap" onClick={() => nav.player(c.id)}>
                {c.name} <span className="muted">· media {c.ovr} · {c.age} años · pediría {eur(c.ask)}</span> ›
              </li>
            ))}
          </ul>
          <p className="muted small">Si no los renuevas antes de empezar la temporada siguiente, se van libres.</p>
        </section>
      )}
      <section>
        <h3>Contratos</h3>
        <Table
          cols={[
            { key: 'n', label: 'Jugador', left: true, value: (r) => r.name },
            { key: 'ovr', label: 'Media', value: (r) => r.ovr },
            { key: 'age', label: 'Edad', value: (r) => r.age },
            { key: 's', label: 'Sueldo', value: (r) => r.salary, render: (r) => eur(r.salary) },
            { key: 'u', label: 'Hasta', value: (r) => r.until, render: (r) => <span className={r.until <= data.season ? 'warn' : ''}>{seasonLabel(r.until)}</span> },
            { key: 'v', label: 'Valor', value: (r) => r.value, render: (r) => eur(r.value) },
          ]}
          rows={data.contracts}
          rowKey={(r) => r.id}
          onRow={(r) => nav.player(r.id)}
        />
      </section>
      {data.transfers.length > 0 && (
        <section>
          <h3>Movimientos</h3>
          <ul className="plain">
            {data.transfers.map((t, i) => (
              <li key={i}>
                <span className="muted">{seasonLabel(t.season)} · </span>
                {t.name}: {t.kind === 'renovacion' ? 'renueva' : t.kind === 'rescision' ? `rescisión (${eur(t.fee)})` : t.kind === 'libre' ? `llega libre a ${t.to_club}` : `${t.from_club} → ${t.to_club} por ${eur(t.fee)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {(data.history as unknown[]).length > 0 && (
        <section>
          <h3>Temporadas anteriores</h3>
          <Table
            cols={[
              { key: 's', label: 'Temp.', left: true, value: (r: Record<string, number>) => r.season!, render: (r) => seasonLabel(r.season!) },
              { key: 'b', label: 'Presupuesto', value: (r) => r.budget!, render: (r) => eur(r.budget) },
              { key: 'w', label: 'Sueldos', value: (r) => r.wages!, render: (r) => eur(r.wages) },
              { key: 'p', label: 'Premios', value: (r) => r.prizes!, render: (r) => eur(r.prizes) },
              { key: 'c', label: 'Caja final', value: (r) => r.cash_end!, render: (r) => eur(r.cash_end) },
            ]}
            rows={data.history as Record<string, number>[]}
            rowKey={(r) => r.season!}
          />
        </section>
      )}
    </div>
  );
}

/* ───────────────────────────── Noticias ───────────────────────────── */

type NewsRow = ReturnType<typeof Q.news>[number];
const ICON: Record<string, string> = { lesion: '✚', alta: '✓', fichaje: '⇄', venta: '⇄', renovacion: '✎', rescision: '✕' };

export function NewsList({ clubId, nav, limit = 12 }: { clubId: number; nav: Nav; limit?: number }) {
  const { data } = useData<NewsRow[]>('news', { clubId, limit }, [clubId, limit]);
  if (!data || data.length === 0) return null;
  return (
    <section>
      <h3>Noticias</h3>
      <ul className="plain news">
        {data.map((n) => (
          <li key={n.id} className={n.player_id ? 'tap' : ''} onClick={n.player_id ? () => nav.player(n.player_id!) : undefined}>
            <span className={`ni ${n.kind}`}>{ICON[n.kind] ?? '•'}</span>
            <span>{n.text} <span className="muted small">· {n.day ? `día ${n.day}` : 'pretemporada'}{n.club_id === clubId ? '' : ''}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
