/** Mercado: jugadores de toda la liga, contrato y operaciones de un jugador, finanzas del club y noticias. */
import { useMemo, useState } from 'react';
import type * as Q from '../core/queries';
import { fga, fgm, reb } from '../core/stats';
import { call } from '../db/client';
import { cupoOf } from '../core/names';
import { ATTRS, type AttrKey } from '../core/attributes';
import { ARCHETYPES, type ArchetypeKey } from '../core/archetype';
import { YouthReport } from './history';
import { ovrClass } from './screens';
import { type Col, CupoTag, Loading, type Nav, notifyChange, posSort, shortName, useChangeTick, useSticky, Table, Tabs, f1, f2, mins, pc, pcRaw, seasonLabel, signed, useData } from './kit';

export const eur = (x: number | null | undefined) =>
  x === null || x === undefined ? '—' : Math.abs(x) >= 1e6 ? `${(x / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 2 })} M€` : `${Math.round(x / 1000).toLocaleString('es-ES')} mil €`;
const untilLabel = (y: number | null) => (y === null ? '—' : seasonLabel(y));

type LoanOpt = { club_id: number; name: string; comp: number; rank: number; role: string; minutes: number; share: number };
/** Ceder a un jugador: clubes españoles que lo quieren y el papel que tendría allí. */
function LoanOutPanel({ id, onDone, onCancel }: { id: number; onDone: (r: Result) => void; onCancel: () => void }) {
  const { data, error } = useData<LoanOpt[]>('loanOptions', { id }, [id]);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading error={error} />;
  return (
    <div className="card">
      <p className="small">Cesión hasta final de temporada a un club español donde juegue. Los menores de 24 que juegan 20 minutos o más mejoran algo más cada verano; los que no juegan, se estancan. Lo puedes recuperar con el mercado abierto.</p>
      {data.length === 0 && <p className="muted">Ningún club lo quiere ahora mismo (o no le cabe en el cupo o la plantilla).</p>}
      <ul className="plain">
        {data.map((o) => (
          <li key={o.club_id} className="row tight" style={{ justifyContent: 'space-between' }}>
            <span><b>{o.name}</b> <span className="muted small">{o.comp === 1 ? 'ACB' : 'FEB'} · sería su {o.rank}º · {o.role} (~{o.minutes} min) · paga el {Math.round(o.share * 100)} %</span></span>
            <button className="sec" disabled={busy} onClick={async () => { setBusy(true); onDone(await call<Result>('loanOut', { id, clubId: o.club_id })); setBusy(false); }}>Ceder</button>
          </li>
        ))}
      </ul>
      <button className="sec" onClick={onCancel}>Cancelar</button>
    </div>
  );
}

/** Dinero disponible siempre a la vista: caja para traspasos y margen salarial. Se puede pasar caja a salarios. */
export function MoneyBar({ clubId }: { clubId: number }) {
  const tick = useChangeTick();
  const { data } = useData<{ cash: number; budget: number; payroll: number; extra: number }>('money', { clubId }, [clubId, tick]);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(500_000);
  const [msg, setMsg] = useState<Result | null>(null);
  if (!data) return null;
  const room = data.budget - data.payroll;
  const move = async (x: number) => {
    const r = await call<Result>('moveCash', { clubId, amount: x });
    setMsg(r);
    if (r.ok) notifyChange();
  };
  return (
    <>
      <div className="moneybar" role="status">
        <span><small>Caja</small><b className={data.cash < 0 ? 'bad' : ''}>{eur(data.cash)}</b></span>
        <span><small>Margen salarial</small><b className={room < 0 ? 'bad' : room < 100_000 ? 'warn' : 'good'}>{eur(room)}</b></span>
        <span><small>Masa / presupuesto</small><b>{eur(data.payroll)} / {eur(data.budget)}</b></span>
        <button className="sec mbtn" aria-expanded={open} onClick={() => setOpen(!open)} title="Pasar dinero de la caja a salarios">⇄</button>
      </div>
      {open && (
        <div className="card movecash">
          <p className="small">La caja (lo que ingresas por ventas y premios) también puede pagar sueldos: pasa la cantidad que quieras al presupuesto salarial <b>de esta temporada</b>. Lo que no gastes vuelve a la caja al acabar; la temporada siguiente el presupuesto parte otra vez del de la directiva.{data.extra > 0 && <> Ya has pasado <b>{eur(data.extra)}</b> esta temporada.</>}</p>
          <MoneyInput label="Cantidad" value={amount} onChange={setAmount} step={100_000} />
          <div className="row">
            <button onClick={() => void move(amount)} disabled={amount <= 0 || amount > data.cash}>Pasar a salarios</button>
            {data.extra > 0 && <button className="sec" onClick={() => void move(-Math.min(amount, data.extra))}>Devolver a la caja</button>}
          </div>
          {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.message}</p>}
        </div>
      )}
    </>
  );
}

/* ───────────────────────────── Jugadores de la liga ───────────────────────────── */

type PRow = ReturnType<typeof Q.allPlayers>[number];
type Grp = 'basic' | 'shoot' | 'adv' | 'market';

export function PlayersScreen({ nav, myClub }: { nav: Nav; myClub: number }) {
  const { data, error } = useData<PRow[]>('allPlayers', null, []);
  const [scope, setScope] = useSticky<'acb' | 'feb' | 'europa' | 'nba' | 'ncaa' | 'libres' | 'seguidos' | 'jovenes' | 'todos'>('pl.scope', 'acb');
  const [cupo, setCupo] = useSticky('pl.cupo', '');
  const [poss, setPoss] = useSticky<string[]>('pl.poss', []);
  const [minAge, setMinAge] = useSticky('pl.agemin', 16);
  const [maxAge, setMaxAge] = useSticky('pl.age', 40);
  const [minGp, setMinGp] = useSticky('pl.gp', 0);
  const [minOvr, setMinOvr] = useSticky('pl.ovr', 0);
  const [arch, setArch] = useSticky('pl.arch', '');
  const [conds, setConds] = useSticky<[AttrKey, number][]>('pl.conds', []);
  const [maxFee, setMaxFee] = useSticky('pl.fee', 0);
  const [maxSal, setMaxSal] = useSticky('pl.sal', 0);
  const [more, setMore] = useSticky('pl.more', false);
  const [q, setQ] = useSticky('pl.q', '');
  const [group, setGroup] = useSticky<Grp>('pl.group', 'basic');
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.filter((r) =>
      (scope === 'todos' || (scope === 'seguidos' ? r.watched : scope === 'libres' ? r.club_id === null : scope === 'europa' ? r.club_id !== null && r.country !== 'ES' && r.comp !== 12 && r.comp !== 13 : scope === 'nba' ? r.comp === 12 : scope === 'ncaa' ? r.comp === 13 : scope === 'acb' ? r.comp === 1 : r.comp === 2)) &&
      (!cupo || cupoOf(r.nationality) === cupo) &&
      (!poss.length || poss.includes(r.pos1) || (r.pos2 !== null && poss.includes(r.pos2))) &&
      r.age >= minAge && r.age <= maxAge && (r.line?.gp ?? 0) >= minGp && r.ovr >= minOvr &&
      (!arch || r.archs.includes(arch as ArchetypeKey)) &&
      conds.every(([k, v]) => r.attrs[k] >= v) &&
      (!maxFee || r.club_id === null || r.value <= maxFee) &&
      (!maxSal || (r.salary ?? r.ask) <= maxSal) &&
      (!needle || r.name.toLowerCase().includes(needle)));
  }, [data, scope, poss, minAge, maxAge, minGp, minOvr, arch, conds, maxFee, maxSal, q, cupo]);
  const active = Number(poss.length > 0) + Number(minAge > 16 || maxAge < 40) + Number(minGp > 0) + Number(minOvr > 0) + Number(!!arch) + conds.length + Number(maxFee > 0) + Number(maxSal > 0) + Number(!!cupo);
  const clearAll = () => { setPoss([]); setMinAge(16); setMaxAge(40); setMinGp(0); setMinOvr(0); setArch(''); setConds([]); setMaxFee(0); setMaxSal(0); setCupo(''); };
  const AGES = Array.from({ length: 25 }, (_, i) => 16 + i);
  if (!data) return <Loading error={error} />;
  const L = (r: PRow) => r.line;
  const pg = (r: PRow, v: (l: NonNullable<PRow['line']>) => number) => (L(r) && L(r)!.gp ? v(L(r)!) / L(r)!.gp : null);
  const base: Col<PRow>[] = [
    { key: 'name', label: 'Jugador', left: true, value: (r) => r.name, render: (r) => <>{r.watched && <span className="warn">★ </span>}<CupoTag nationality={r.nationality} /> {shortName(r.name)}</> },
    { key: 'club', label: 'Club', left: true, value: (r) => r.club ?? 'Libre', render: (r) => (r.club_id === null ? <span className="good">Libre</span> : r.club_id === myClub ? <b>{r.club}</b> : r.club) },
    { key: 'pos', label: 'Pos.', value: (r) => posSort(r.pos1, r.pos2), render: (r) => `${r.pos1}${r.pos2 ? `/${r.pos2}` : ''}` },
    { key: 'ovr', label: 'Media', value: (r) => r.ovr, render: (r) => <b className={`ovr ${ovrClass(r.ovr)}`}>{r.ovr}</b> },
    { key: 'age', label: 'Edad', value: (r) => r.age },
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
      { key: 'va', label: 'VA', value: (r) => L(r)?.va ?? null, render: (r) => f1(L(r)?.va) },
      { key: 'pm', label: '+/-', value: (r) => L(r)?.pm ?? null, render: (r) => (L(r) ? signed(L(r)!.pm) : '—') },
    ],
    market: [
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
      <MoneyBar clubId={myClub} />
      <MarketBanner nav={nav} />
      <Tabs<typeof scope> value={scope} onChange={setScope} options={[['acb', 'Liga ACB'], ['feb', 'Primera FEB'], ['europa', 'Europa'], ['nba', 'NBA'], ['ncaa', 'NCAA'], ['libres', 'Agentes libres'], ['seguidos', '★ Seguidos'], ['jovenes', 'Jóvenes'], ['todos', 'Todos']]} />
      {scope === 'jovenes' ? <YouthReport nav={nav} myClub={myClub} /> : <>
      <div className="filters">
        <input type="text" placeholder="Buscar por nombre" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <div className="poschips" role="group" aria-label="Posiciones">
          {['PG', 'SG', 'SF', 'PF', 'C'].map((p) => (
            <button key={p} className={poss.includes(p) ? 'on' : ''} aria-pressed={poss.includes(p)} onClick={() => setPoss(poss.includes(p) ? poss.filter((x) => x !== p) : [...poss, p])}>{p}</button>
          ))}
        </div>
        <label className="fl"><small>Edad (de – a)</small>
          <span className="row tight">
            <select value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} aria-label="Edad mínima">{AGES.map((a) => <option key={a} value={a}>{a}</option>)}</select>
            <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} aria-label="Edad máxima">{AGES.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </span>
        </label>
        <label className="fl"><small>Media mínima</small>
          <select value={minOvr} onChange={(e) => setMinOvr(Number(e.target.value))} aria-label="Media mínima">
            {[0, 50, 55, 60, 65, 70, 75, 80].map((v) => <option key={v} value={v}>{v ? `${v} o más` : 'Cualquiera'}</option>)}
          </select>
        </label>
        <button className="sec morebtn" onClick={() => setMore(!more)} aria-expanded={more}>{more ? '▾' : '▸'} Más filtros{active ? ` · ${active}` : ''}</button>
        {active > 0 && <button className="sec morebtn" onClick={clearAll}>Quitar filtros</button>}
      </div>
      {more && (
        <div className="filters more">
          <label className="fl"><small>Arquetipo</small>
            <select value={arch} onChange={(e) => setArch(e.target.value)} aria-label="Arquetipo">
              <option value="">Cualquiera</option>
              {ARCHETYPES.filter((a) => a.key !== 'rol').map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
          <label className="fl"><small>Cupo</small>
            <select value={cupo} onChange={(e) => setCupo(e.target.value)} aria-label="Cupo">
              <option value="">Cualquiera</option>
              <option value="NAC">Nacionales (NAC)</option>
              <option value="COM">Comunitarios (COM)</option>
              <option value="EXT">Extracomunitarios (EXT)</option>
            </select>
          </label>
          <label className="fl"><small>Traspaso hasta</small>
            <select value={maxFee} onChange={(e) => setMaxFee(Number(e.target.value))} aria-label="Precio máximo">
              {[0, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 4_000_000].map((v) => <option key={v} value={v}>{v ? eur(v) : 'Sin límite'}</option>)}
            </select>
          </label>
          <label className="fl"><small>Sueldo hasta</small>
            <select value={maxSal} onChange={(e) => setMaxSal(Number(e.target.value))} aria-label="Sueldo máximo">
              {[0, 50_000, 100_000, 200_000, 350_000, 500_000, 800_000].map((v) => <option key={v} value={v}>{v ? `${eur(v)}/año` : 'Sin límite'}</option>)}
            </select>
          </label>
          <label className="fl"><small>Partidos jugados</small>
            <select value={minGp} onChange={(e) => setMinGp(Number(e.target.value))} aria-label="Partidos mínimos">
              {[0, 5, 10, 20].map((g) => (<option key={g} value={g}>{g ? `${g} o más` : 'Cualquiera'}</option>))}
            </select>
          </label>
          <div className="fl full"><small>Atributos (mínimo)</small>
            {conds.map(([k, v], i) => (
              <span key={i} className="row tight cond">
                <select value={k} onChange={(e) => setConds(conds.map((c, j) => (j === i ? [e.target.value as AttrKey, c[1]] : c)))} aria-label="Atributo">
                  {ATTRS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                <select value={v} onChange={(e) => setConds(conds.map((c, j) => (j === i ? [c[0], Number(e.target.value)] : c)))} aria-label="Valor mínimo">
                  {[50, 55, 60, 65, 70, 75, 80, 85, 90].map((x) => <option key={x} value={x}>≥ {x}</option>)}
                </select>
                <button className="sec" onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label="Quitar atributo">✕</button>
              </span>
            ))}
            {conds.length < 4 && <button className="sec" onClick={() => setConds([...conds, ['sht3', 70]])}>+ Añadir atributo</button>}
          </div>
        </div>
      )}
      <Tabs<Grp> small value={group} onChange={setGroup} options={[['basic', 'Básicas'], ['shoot', 'Tiro'], ['adv', 'Avanzadas'], ['market', 'Mercado']]} />
      <Table id={`players-${group}`} page={150} cols={[...base, ...groups[group]]} rows={rows} rowKey={(r) => r.id} onRow={(r) => nav.player(r.id)} highlight={(r) => r.club_id === myClub}
        defaultSort={group === 'market' ? { key: 'ovr', desc: true } : group === 'adv' ? { key: 'va', desc: true } : group === 'shoot' ? { key: 'ts', desc: true } : { key: 'pir', desc: true }} />
      {scope === 'ncaa' && <p className="muted small">Universitarios: no se pueden fichar hasta que acaban (normalmente con 22 o 23 años). Entonces los mejores van a la NBA y el resto sale al mercado.</p>}
      <p className="muted small">{rows.length} jugadores · por partido, fase regular (en Europa, toda la competición; ligas extranjeras, NBA y NCAA en simulación rápida) · NAC nacional, COM comunitario, EXT extracomunitario (máx. 2 por plantilla, mín. 4 nacionales) · toca la cabecera para ordenar y un jugador para ver su ficha y negociar.</p>
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
  loan: { owner_id: number; club_id: number; owner: string; club: string; share: number } | null;
  patience: number; clubPatience: number; need: number; sellerWants: number | null; trusts?: boolean; offers: { id: number; club: string; fee: number; expires_day: number }[];
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
  const [mode, setMode] = useState<null | 'sign' | 'buy' | 'renew' | 'sell' | 'release' | 'trade' | 'loan' | 'loanin'>(null);
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
  const [promise, setPromise] = useState<string>('');
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
        notifyChange();
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
  const prom = promise ? (promise.startsWith('min') ? { kind: 'minutos' as const, minutes: Number(promise.slice(4)) } : { kind: promise as 'titular' | 'rotacion', minutes: 0 }) : null;
  const promMin = prom ? (prom.kind === 'titular' ? 25 : prom.kind === 'rotacion' ? 17 : prom.minutes) : 0;
  const promDisc = !prom ? 0 : data.trusts === false ? 0 : promMin >= 25 ? 10 : promMin >= 17 ? 5 : promMin >= 10 ? 2 : 0;
  const promiseSel = (
    <div className="promsel">
      <label className="money">
        <span>Promesa de papel <small className="muted">· pide menos si le prometes minutos</small></span>
        <select value={promise} onChange={(e) => setPromise(e.target.value)} aria-label="Promesa">
          <option value="">Sin promesa</option>
          <option value="titular">Titular (unos 25 min) · −10 %</option>
          <option value="rotacion">Rotación (unos 17 min) · −5 %</option>
          <option value="min:30">30 minutos · −10 %</option>
          <option value="min:20">20 minutos · −5 %</option>
          <option value="min:12">12 minutos · −2 %</option>
        </select>
      </label>
      {prom && (data.trusts === false
        ? <p className="small bad">Ya le rompiste una promesa: no se la cree y no rebaja nada.</p>
        : <p className="muted small">Con la promesa firmaría por unos {eur(Math.round((data.need * (1 - promDisc / 100)) / 5000) * 5000)}. Si durante la temporada juega bastante menos de {promMin} minutos, se enfadará y acabará pidiendo salir.</p>)}
    </div>
  );
  const counterBtn = (set: (x: number) => void) =>
    res && !res.ok && res.counter ? <button className="sec" onClick={() => { set(res.counter!); setRes(null); }}>Usar {eur(res.counter)}</button> : null;
  return (
    <div>
      <h3>Contrato y mercado</h3>
      {!mine && <MoneyBar clubId={myClub} />}
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
      {data.loan && (
        <div className="card">
          <p className="small">Cedido por <b>{data.loan.owner}</b> a <b>{data.loan.club}</b> hasta final de temporada ({Math.round(data.loan.share * 100)} % del sueldo lo paga {data.loan.club}).</p>
          {(data.loan.owner_id === myClub || data.loan.club_id === myClub) && <button className="sec" disabled={busy || !data.window.open} onClick={() => run('recallLoan', {})}>{data.loan.owner_id === myClub ? 'Recuperarlo' : 'Devolverlo'}</button>}
        </div>
      )}
      {res && <p className={res.ok ? 'ok' : 'error'}>{res.message}</p>}
      {data.marketOpen && !mode && !data.loan && (
        <div className="row">
          {free && <button onClick={() => open('sign')}>Fichar</button>}
          {!free && !mine && <button onClick={() => open('buy')} disabled={!data.window.open}>Hacer oferta</button>}
          {!free && !mine && <button className="sec" onClick={() => open('trade')} disabled={!data.window.open}>Proponer cambio</button>}
          {mine && data.canRenew && <button onClick={() => open('renew')}>Renovar</button>}
          {mine && <button className="sec" onClick={() => open('sell')} disabled={!data.window.open}>Buscar comprador</button>}
          {mine && <button className="sec" onClick={() => open('loan')} disabled={!data.window.open}>Ceder</button>}
          {!free && !mine && <button className="sec" onClick={() => open('loanin')} disabled={!data.window.open}>Pedir cedido</button>}
          {mine && <button className="dangerBtn" onClick={() => open('release')}>Rescindir</button>}
        </div>
      )}
      {mode === 'loan' && <LoanOutPanel id={id} onDone={(r) => { setRes(r); setMode(null); if (r.ok) { onChanged(); notifyChange(); } reload(); }} onCancel={() => setMode(null)} />}
      {mode === 'loanin' && (
        <div className="card">
          <p className="small">Su club solo lo cede si no está entre sus 8 mejores. Tú eliges qué parte del sueldo pagas (mínimo la mitad); se queda hasta final de temporada y lo puedes devolver con el mercado abierto.</p>
          <div className="row">
            {[0.5, 0.75, 1].map((sh) => <button key={sh} className="sec" disabled={busy} onClick={() => run('loanIn', { share: sh })}>Pagar el {sh * 100} % ({eur((data.salary ?? 0) * sh)})</button>)}
            <button className="sec" onClick={() => setMode(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {mode === 'sign' && (
        <div className="card">
          <MoneyInput label="Sueldo por temporada" value={salary} onChange={setSalary} step={10_000} hint={`pide ${eur(data.need)}`} />
          {yearsSel}
          {promiseSel}
          {clauseSel}
          <div className="row"><button disabled={busy} onClick={() => run('sign', { clubId: myClub, salary, years, clause, promise: prom })}>Ofrecer contrato</button>{counterBtn(setSalary)}<button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
      {mode === 'buy' && (
        <div className="card">
          <MoneyInput label="Traspaso al club" value={fee} onChange={setFee} step={25_000} hint={data.sellerWants ? `quieren ~${eur(data.sellerWants)}` : undefined} />
          {data.clause !== null && <button className="sec" onClick={() => setFee(data.clause!)}>Pagar la cláusula ({eur(data.clause)})</button>}
          <MoneyInput label="Sueldo por temporada" value={salary} onChange={setSalary} step={10_000} hint={`pide ${eur(data.need)}`} />
          {yearsSel}
          {promiseSel}
          {clauseSel}
          <p className="muted small">El traspaso sale de tu caja; el sueldo cuenta para tu presupuesto salarial. Primero decide el club y después el jugador. Cada oferta rechazada les gasta paciencia; si se agota, no negocian más esta ventana.</p>
          <div className="row"><button disabled={busy} onClick={() => run('buy', { clubId: myClub, fee, salary, years, clause, promise: prom })}>Enviar oferta</button>{res?.message.includes('club') ? counterBtn(setFee) : counterBtn(setSalary)}<button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
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
          {promiseSel}
          {clauseSel}
          <p className="muted small">Los años se suman al contrato actual. Contento, pide algo menos; descontento, más.</p>
          <div className="row"><button disabled={busy} onClick={() => run('renew', { salary, years, clause, promise: prom })}>Ofrecer renovación</button>{counterBtn(setSalary)}<button className="sec" onClick={() => setMode(null)}>Cancelar</button></div>
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
      <section>
        <h3>Ingresos y gastos</h3>
        <div className="kpis">
          <div><div className="kv good">{eur(data.income.gate)}</div><div className="kk">Taquilla hasta hoy</div></div>
          <div><div className="kv">{eur(data.income.sponsor)}</div><div className="kk">Patrocinio previsto ({Math.round(data.income.winPct * 100)} % de victorias)</div></div>
          <div><div className="kv bad">−{eur(data.income.costs)}</div><div className="kk">Gastos fijos</div></div>
          <div><div className={`kv ${data.income.gate + data.income.sponsor - data.income.costs < 0 ? 'bad' : 'good'}`}>{eur(data.income.gate + data.income.sponsor - data.income.costs)}</div><div className="kk">Balance (sin premios)</div></div>
        </div>
        <p className="muted small">Cada partido en casa deja taquilla: más con buena racha, rivales grandes y en playoffs. El patrocinio se cobra al final según las victorias y los gastos fijos son una cuarta parte del presupuesto. Lo que ganes así sube el presupuesto de la temporada siguiente; si pierdes dinero, baja.</p>
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
              { key: 'g', label: 'Taquilla', value: (r) => r.gate ?? 0, render: (r) => eur(r.gate ?? 0) },
              { key: 'sp', label: 'Patrocinio', value: (r) => r.sponsor ?? 0, render: (r) => eur(r.sponsor ?? 0) },
              { key: 'p', label: 'Premios', value: (r) => r.prizes!, render: (r) => eur(r.prizes) },
              { key: 'co', label: 'Gastos', value: (r) => r.costs ?? 0, render: (r) => eur(r.costs ?? 0) },
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
