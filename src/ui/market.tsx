/** Mercado: jugadores de toda la liga, contrato y operaciones de un jugador, finanzas del club y noticias. */
import { useMemo, useState } from 'react';
import type * as Q from '../core/queries';
import { fga, fgm, reb } from '../core/stats';
import { call } from '../db/client';
import { cupoOf } from '../core/names';
import { YouthReport } from './history';
import { type Col, CupoTag, Loading, type Nav, posSort, shortName, useSticky, Table, Tabs, f1, f2, mins, pc, pcRaw, seasonLabel, signed, useData } from './kit';

export const eur = (x: number | null | undefined) =>
  x === null || x === undefined ? '—' : Math.abs(x) >= 1e6 ? `${(x / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 2 })} M€` : `${Math.round(x / 1000).toLocaleString('es-ES')} mil €`;
const untilLabel = (y: number | null) => (y === null ? '—' : seasonLabel(y));

/* ───────────────────────────── Jugadores de la liga ───────────────────────────── */

type PRow = ReturnType<typeof Q.allPlayers>[number];
type Grp = 'basic' | 'shoot' | 'adv' | 'market';

export function PlayersScreen({ nav, myClub }: { nav: Nav; myClub: number }) {
  const { data, error } = useData<PRow[]>('allPlayers', null, []);
  const [scope, setScope] = useSticky<'acb' | 'feb' | 'europa' | 'libres' | 'seguidos' | 'jovenes' | 'todos'>('pl.scope', 'acb');
  const [cupo, setCupo] = useSticky('pl.cupo', '');
  const [pos, setPos] = useSticky('pl.pos', '');
  const [maxAge, setMaxAge] = useSticky('pl.age', 40);
  const [minGp, setMinGp] = useSticky('pl.gp', 0);
  const [q, setQ] = useSticky('pl.q', '');
  const [group, setGroup] = useSticky<Grp>('pl.group', 'basic');
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.filter((r) =>
      (scope === 'todos' || (scope === 'seguidos' ? r.watched : scope === 'libres' ? r.club_id === null : scope === 'europa' ? r.club_id !== null && r.country !== 'ES' : scope === 'acb' ? r.comp === 1 : r.comp === 2)) &&
      (!cupo || cupoOf(r.nationality) === cupo) &&
      (!pos || r.pos1 === pos || r.pos2 === pos) && r.age <= maxAge && (r.line?.gp ?? 0) >= minGp &&
      (!needle || r.name.toLowerCase().includes(needle)));
  }, [data, scope, pos, maxAge, minGp, q, cupo]);
  if (!data) return <Loading error={error} />;
  const L = (r: PRow) => r.line;
  const pg = (r: PRow, v: (l: NonNullable<PRow['line']>) => number) => (L(r) && L(r)!.gp ? v(L(r)!) / L(r)!.gp : null);
  const base: Col<PRow>[] = [
    { key: 'name', label: 'Jugador', left: true, value: (r) => r.name, render: (r) => <>{r.watched && <span className="warn">★ </span>}<CupoTag nationality={r.nationality} /> {shortName(r.name)}</> },
    { key: 'club', label: 'Club', left: true, value: (r) => r.club ?? 'Libre', render: (r) => (r.club_id === null ? <span className="good">Libre</span> : r.club_id === myClub ? <b>{r.club}</b> : r.club) },
    { key: 'pos', label: 'Pos.', value: (r) => posSort(r.pos1, r.pos2), render: (r) => `${r.pos1}${r.pos2 ? `/${r.pos2}` : ''}` },
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
      { key: 'arch', label: 'Perfil', left: true, value: (r) => r.archetype },
      { key: 'pot', label: 'Pot.', value: (r) => r.potential_est },
      { key: 'value', label: 'Valor', value: (r) => (r.club_id === null ? 0 : r.value), render: (r) => (r.club_id === null ? 'libre' : eur(r.value)) },
      { key: 'salary', label: 'Sueldo', value: (r) => r.salary ?? r.ask, render: (r) => (r.salary ? eur(r.salary) : <span className="muted">pide {eur(r.ask)}</span>) },
      { key: 'until', label: 'Hasta', value: (r) => r.until ?? 0, render: (r) => untilLabel(r.until) },
      { key: 'clause', label: 'Cláusula', value: (r) => r.clause ?? 0, render: (r) => (r.clause ? eur(r.clause) : '—') },
      { key: 'inj', label: 'Estado', value: (r) => r.injury_games, render: (r) => (r.injury_games ? <span className="bad">✚ {r.injury_games}</span> : '') },
    ],
  };
  return (
    <div>
      <h2>Jugadores</h2>
      <MarketBanner nav={nav} />
      <Tabs<typeof scope> value={scope} onChange={setScope} options={[['acb', 'Liga ACB'], ['feb', 'Primera FEB'], ['europa', 'Europa'], ['libres', 'Agentes libres'], ['seguidos', '★ Seguidos'], ['jovenes', 'Jóvenes'], ['todos', 'Todos']]} />
      {scope === 'jovenes' ? <YouthReport nav={nav} myClub={myClub} /> : <>
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
      <Table id={`players-${group}`} cols={[...base, ...groups[group]]} rows={rows} rowKey={(r) => r.id} onRow={(r) => nav.player(r.id)} highlight={(r) => r.club_id === myClub}
        defaultSort={group === 'market' ? { key: 'ovr', desc: true } : group === 'adv' ? { key: 'va', desc: true } : group === 'shoot' ? { key: 'ts', desc: true } : { key: 'pir', desc: true }} />
      <p className="muted small">{rows.length} jugadores · por partido, fase regular (en Europa, toda la competición) · NAC nacional, COM comunitario, EXT extracomunitario (máx. 2 por plantilla, mín. 4 nacionales) · toca la cabecera para ordenar y un jugador para ver su ficha y negociar.</p>
      </>}
    </div>
  );
}

type Overview = { window: { open: boolean; label: string }; offers: { id: number; player_id: number; player: string; club: string; fee: number; value: number; expires_day: number }[] };
/** Estado del mercado y ofertas recibidas por tus jugadores. */
export function MarketBanner({ nav }: { nav: Nav }) {
  const { data } = useData<Overview>('marketOverview', null, []);
  if (!data) return null;
  return (
    <section className={data.window.open ? 'mk open' : 'mk'}>
      <div className="small">{data.window.open ? '🟢 ' : '🔴 '}{data.window.label}{!data.window.open && '. Los agentes libres sí se pueden fichar.'}</div>
      {data.offers.length > 0 && (
        <ul className="plain">
          {data.offers.map((o) => (
            <li key={o.id} className="tap" onClick={() => nav.player(o.player_id)}>
              📩 <b>{o.club}</b> ofrece <b>{eur(o.fee)}</b> por {shortName(o.player)} <span className="muted small">(valor {eur(o.value)}, hasta el día {o.expires_day})</span> ›
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────────────────────────── Contrato y operaciones ───────────────────────────── */

type Market = {
  club_id: number | null; salary: number | null; until: number | null; ask: number; value: number; yearsLeft: number; releaseCost: number; morale: number; injury_games: number;
  canRenew: boolean; marketOpen: boolean; phase: string; window: { open: boolean; label: string }; clause: number | null; age: number; preferredYears: number;
  patience: number; clubPatience: number; need: number; sellerWants: number | null; offers: { id: number; club: string; fee: number; expires_day: number }[];
};
type Result = { ok: boolean; message: string; counter?: number; patience?: number };

function moraleLabel(m: number) {
  return m >= 80 ? ['Muy contento', 'good'] : m >= 60 ? ['Contento', 'good'] : m >= 40 ? ['Normal', ''] : m >= 25 ? ['Descontento', 'warn'] : ['Muy descontento', 'bad'];
}

/** Cantidad de dinero editable: se escribe en miles de euros y se ajusta con − / +. */
export function MoneyInput({ label, value, onChange, step, hint }: { label: string; value: number; onChange: (v: number) => void; step: number; hint?: string }) {
  return (
    <label className="money">
      <span>{label}{hint && <small className="muted"> · {hint}</small>}</span>
      <span className="row tight">
        <button type="button" className="sec" onClick={() => onChange(Math.max(0, value - step))} aria-label={`Bajar ${label}`}>−</button>
        <span className="kinput">
          <input type="number" inputMode="numeric" min={0} step={5} value={Math.round(value / 1000)} onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)) * 1000)} aria-label={`${label} en miles de euros`} />
          <span className="muted">mil €</span>
        </span>
        <button type="button" className="sec" onClick={() => onChange(value + step)} aria-label={`Subir ${label}`}>+</button>
      </span>
    </label>
  );
}

function Patience({ label, v }: { label: string; v: number }) {
  return (
    <div className="pat">
      <span className="muted small">{label}</span>
      <div className="fat"><i style={{ width: `${v}%` }} className={v < 35 ? 'low' : v < 70 ? 'mid' : ''} /></div>
    </div>
  );
}

type SquadLite = { players: { id: number; name: string; pos1: string; ovr: number; age: number; nationality: string; salary: number | null }[] };

export function ContractCard({ id, myClub, injury, onChanged }: { id: number; myClub: number; injury: string | null; onChanged: () => void }) {
  const { data, error, reload } = useData<Market>('market', { id }, [id]);
  const [mode, setMode] = useState<null | 'sign' | 'buy' | 'renew' | 'sell' | 'release' | 'trade'>(null);
  const [fee, setFee] = useState(0);
  const [salary, setSalary] = useState(0);
  const [years, setYears] = useState(2);
  const [clause, setClause] = useState<number | null>(null);
  const [offers, setOffers] = useState<{ club_id: number; club: string; fee: number }[] | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [give, setGive] = useState<number[]>([]);
  const [cash, setCash] = useState(0);
  const [squad, setSquad] = useState<SquadLite | null>(null);
  const [tv, setTv] = useState<{ offered: number; wanted: number } | null>(null);
  const [askMore, setAskMore] = useState<Record<number, number>>({});
  if (!data) return <Loading error={error} />;
  const mine = data.club_id === myClub;
  const free = data.club_id === null;
  const [ml, mc] = moraleLabel(data.morale);
  const open = (m: typeof mode) => {
    setRes(null);
    setMode(m);
    setSalary(Math.max(data.need, data.ask));
    setFee(data.sellerWants ?? data.value);
    setYears(data.preferredYears);
    setClause(Math.round((Math.max(data.value, 150_000) * 3) / 10_000) * 10_000);
    if (m === 'sell') void call<typeof offers>('offers', { id }).then(setOffers);
    if (m === 'trade') {
      setGive([]);
      setCash(0);
      setTv(null);
      void call<SquadLite>('squad', { clubId: myClub }).then(setSquad);
    }
  };
  const run = async (op: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await call<Result>(op, { id, ...args });
      setRes(r);
      if (r.ok) {
        setMode(null);
        onChanged();
      }
      reload();
    } catch (e) {
      setRes({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const evalTrade = async (g: number[], c: number) => {
    setGive(g);
    setCash(c);
    if (!g.length && c <= 0) return setTv(null);
    setTv(await call<{ offered: number; wanted: number }>('tradeValue', { give: g, get: id, cash: c }));
  };
  const yearsSel = (
    <label className="money">
      <span>Años de contrato <small className="muted">· prefiere {data.preferredYears}</small></span>
      <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
        {[1, 2, 3, 4].map((y) => (<option key={y} value={y}>{y}</option>))}
      </select>
    </label>
  );
  const clauseSel = (
    <div>
      <label className="row tight"><input type="checkbox" checked={clause !== null} onChange={(e) => setClause(e.target.checked ? Math.round((Math.max(data.value, 150_000) * 3) / 10_000) * 10_000 : null)} /> Cláusula de rescisión</label>
      {clause !== null && <MoneyInput label="Cláusula" value={clause} onChange={setClause} step={100_000} hint={`valor ${eur(data.value)}`} />}
      <p className="muted small">Una cláusula baja le gusta al jugador (pide algo menos) pero cualquier club puede pagarla y llevárselo. Muy alta (más de 4 veces su valor), pide más. Sin cláusula, nadie puede llevárselo sin tu permiso.</p>
    </div>
  );
  const counterBtn = (set: (x: number) => void) =>
    res && !res.ok && res.counter ? <button className="sec" onClick={() => { set(res.counter!); setRes(null); }}>Usar {eur(res.counter)}</button> : null;
  return (
    <div>
      <h3>Contrato y mercado</h3>
      <dl>
        <dt>Situación</dt>
        <dd>{free ? <span className="good">Agente libre</span> : `${eur(data.salary)} por temporada, hasta ${untilLabel(data.until)}`}</dd>
        {!free && (<><dt>Valor de mercado</dt><dd>{eur(data.value)}</dd></>)}
        {!free && (<><dt>Cláusula de rescisión</dt><dd>{data.clause ? eur(data.clause) : 'Sin cláusula'}</dd></>)}
        <dt>{mine ? 'Para renovar pediría' : 'Para firmar contigo pediría'}</dt><dd>{eur(data.need)} por temporada ({data.preferredYears} {data.preferredYears === 1 ? 'año' : 'años'})</dd>
        {!free && !mine && data.sellerWants !== null && (<><dt>Su club lo vendería por</dt><dd>unos {eur(data.sellerWants)}</dd></>)}
        <dt>Moral</dt><dd className={mc}>{ml} ({data.morale})</dd>
        {data.injury_games > 0 && (<><dt>Lesión</dt><dd className="bad">✚ {injury ?? 'Lesionado'} · {data.injury_games} {data.injury_games === 1 ? 'partido' : 'partidos'} de baja</dd></>)}
      </dl>
      {!mine && <Patience label={`Paciencia del jugador (${data.patience} %)`} v={data.patience} />}
      {!mine && !free && <Patience label={`Paciencia de su club (${data.clubPatience} %)`} v={data.clubPatience} />}
      <p className={`small ${data.window.open ? 'good' : 'muted'}`}>{data.window.label}{!data.window.open && '. Los agentes libres sí se pueden fichar.'}</p>
      {data.offers.length > 0 && mine && (
        <div className="card">
          <b>Ofertas recibidas</b>
          {data.offers.map((o) => (
            <div key={o.id} className="offer">
              <div>{o.club}: <b>{eur(o.fee)}</b> <span className="muted small">· caduca el día {o.expires_day}</span></div>
              <div className="row tight">
                <button disabled={busy} onClick={() => run('respondOffer', { id: o.id, action: 'aceptar' })}>Aceptar</button>
                <button className="sec" disabled={busy} onClick={() => run('respondOffer', { id: o.id, action: 'rechazar' })}>Rechazar</button>
              </div>
              <MoneyInput label="Pedir más" value={askMore[o.id] ?? Math.round(o.fee * 1.15 / 5000) * 5000} onChange={(v) => setAskMore({ ...askMore, [o.id]: v })} step={25_000} />
              <button className="sec" disabled={busy} onClick={() => run('respondOffer', { id: o.id, action: 'subir', ask: askMore[o.id] ?? Math.round(o.fee * 1.15 / 5000) * 5000 })}>Pedir esa cantidad</button>
            </div>
          ))}
          <p className="muted small">Si pides más de lo que pueden pagar, se retiran.</p>
        </div>
      )}
      {res && <p className={res.ok ? 'ok' : 'error'}>{res.message}</p>}
      {data.marketOpen && !mode && (
        <div className="row">
          {free && <button onClick={() => open('sign')}>Fichar</button>}
          {!free && !mine && <button onClick={() => open('buy')} disabled={!data.window.open}>Hacer oferta</button>}
          {!free && !mine && <button className="sec" onClick={() => open('trade')} disabled={!data.window.open}>Proponer cambio</button>}
          {mine && data.canRenew && <button onClick={() => open('renew')}>Renovar</button>}
          {mine && <button className="sec" onClick={() => open('sell')} disabled={!data.window.open}>Buscar comprador</button>}
          {mine && <button className="dangerBtn" onClick={() => open('release')}>Rescindir</button>}
        </div>
      )}
      {mode === 'sign' && (
        <div className="card">
          <MoneyInput label="Sueldo por temporada" value={salary} onChange={setSalary} step={10_000} hint={`pide ${eur(data.need)}`} />
          {yearsSel}
          {clauseSel}
          <div className="row"><button disabled={busy} onClick={() => run('sign', { clubId: myClub, salary, years, clause })}>Ofrecer contrato</button>{counterBtn(setSalary)}<button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
      {mode === 'buy' && (
        <div className="card">
          <MoneyInput label="Traspaso al club" value={fee} onChange={setFee} step={25_000} hint={data.sellerWants ? `quieren ~${eur(data.sellerWants)}` : undefined} />
          {data.clause !== null && <button className="sec" onClick={() => setFee(data.clause!)}>Pagar la cláusula ({eur(data.clause)})</button>}
          <MoneyInput label="Sueldo por temporada" value={salary} onChange={setSalary} step={10_000} hint={`pide ${eur(data.need)}`} />
          {yearsSel}
          {clauseSel}
          <p className="muted small">El traspaso sale de tu caja; el sueldo cuenta para tu presupuesto salarial. Primero decide el club y después el jugador. Cada oferta rechazada les gasta paciencia; si se agota, no negocian más esta ventana.</p>
          <div className="row"><button disabled={busy} onClick={() => run('buy', { clubId: myClub, fee, salary, years, clause })}>Enviar oferta</button>{res?.message.includes('club') ? counterBtn(setFee) : counterBtn(setSalary)}<button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
      {mode === 'trade' && (
        <div className="card">
          <p className="small">Elige qué jugadores tuyos ofreces (y dinero si hace falta). Su club valora entero a quien entraría en su rotación; al resto, algo menos. Los contratos se mantienen.</p>
          {!squad ? <p className="muted">Cargando tu plantilla…</p> : (
            <ul className="plain pick">
              {squad.players.map((p) => (
                <li key={p.id}>
                  <label className="row tight">
                    <input type="checkbox" checked={give.includes(p.id)} onChange={(e) => void evalTrade(e.target.checked ? [...give, p.id] : give.filter((x) => x !== p.id), cash)} />
                    <CupoTag nationality={p.nationality} /> {shortName(p.name)} <span className="muted small">{p.pos1} · {p.ovr} · {p.age} años · {eur(p.salary)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <MoneyInput label="Dinero" value={cash} onChange={(v) => void evalTrade(give, v)} step={50_000} />
          {tv && <p className={tv.offered >= tv.wanted ? 'good' : 'warn'}>Valoran tu oferta en {eur(tv.offered)}; quieren {eur(tv.wanted)}.</p>}
          <div className="row"><button disabled={busy || (!give.length && cash <= 0)} onClick={() => run('proposeTrade', { give, get: id, cash })}>Proponer cambio</button><button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
      {mode === 'renew' && (
        <div className="card">
          <MoneyInput label="Sueldo por temporada" value={salary} onChange={setSalary} step={10_000} hint={`pide ${eur(data.need)}`} />
          {yearsSel}
          {clauseSel}
          <p className="muted small">Los años se suman al contrato actual. Contento, pide algo menos; descontento, más.</p>
          <div className="row"><button disabled={busy} onClick={() => run('renew', { salary, years, clause })}>Ofrecer renovación</button>{counterBtn(setSalary)}<button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
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
