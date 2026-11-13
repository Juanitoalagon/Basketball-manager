/** Premios, récords, historia de los clubes e informe de jóvenes. */
import { useState } from 'react';
import type * as AW from '../core/awards';
import { COMP_INFO } from '../core/names';
import { call } from '../db/client';
import { Face } from './Face';
import { CupoTag, Loading, type Nav, Tabs, f1, seasonLabel, shortName, useData, useSticky } from './kit';
import { eur } from './market';

const AWARD_LABEL: Record<string, string> = {
  mvp: 'MVP de la temporada', joven: 'Mejor joven (≤ 22)', defensor: 'Mejor defensor', sexto: 'Mejor sexto hombre',
  mejorado: 'Más mejorado', quinteto: 'Quinteto ideal', mvp_final: 'MVP de la final',
};
const AWARD_ORDER = ['mvp', 'quinteto', 'joven', 'defensor', 'sexto', 'mejorado'];
const VALUE_LABEL: Record<string, string> = { mvp: 'puntuación', joven: 'VA', defensor: 'puntuación', sexto: 'VA', mejorado: 'media', quinteto: '', mvp_final: 'VAL' };

type Awards = { seasons: number[]; season: number; rows: ReturnType<typeof AW.awardsView> };

export function AwardsView({ nav, myClub }: { nav: Nav; myClub: number }) {
  const [season, setSeason] = useState<number | undefined>(undefined);
  const { data, error } = useData<Awards>('awards', { season }, [season]);
  if (!data) return <Loading error={error} />;
  if (!data.seasons.length) return <section><p className="muted">Los premios se entregan al terminar cada temporada (con la final de la ACB).</p></section>;
  const row = (r: Awards['rows'][number], big = false) => (
    <li key={`${r.award}-${r.rank}-${r.player_id}`} className={`tap award ${r.club_id === myClub ? 'me' : ''}`} onClick={() => nav.player(r.player_id)}>
      {big && <Face id={r.player_id} nationality={r.nationality} age={data.season - r.birth_year} size={30} />}
      <span>{r.award !== 'quinteto' && r.award !== 'mvp_final' ? <b className="muted">{r.rank}. </b> : <span className="muted">{r.pos1} </span>}{r.name} <span className="muted">{r.club ?? ''}</span></span>
      {VALUE_LABEL[r.award] ? <b className="small">{r.award === 'mejorado' ? `+${Math.round(r.value)}` : f1(r.value)}</b> : <span />}
    </li>
  );
  return (
    <div>
      <div className="row">
        <select value={data.season} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Temporada">
          {data.seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
        </select>
      </div>
      {[1, 2].map((comp) => {
        const rows = data.rows.filter((r) => r.competition_id === comp);
        if (!rows.length) return null;
        return (
          <section key={comp}>
            <h3>{COMP_INFO[comp]!.name}</h3>
            {AWARD_ORDER.map((a) => {
              const xs = rows.filter((r) => r.award === a);
              if (!xs.length) return null;
              return (
                <div key={a}>
                  <h4 className="aw">{AWARD_LABEL[a]}</h4>
                  <ul className="plain awards">{xs.map((r) => row(r, a === 'mvp' && r.rank === 1))}</ul>
                </div>
              );
            })}
          </section>
        );
      })}
      {data.rows.some((r) => r.award === 'mvp_final') && (
        <section>
          <h3>MVP de las finales</h3>
          <ul className="plain awards">
            {data.rows.filter((r) => r.award === 'mvp_final').map((r) => (
              <li key={r.competition_id} className={`tap award ${r.club_id === myClub ? 'me' : ''}`} onClick={() => nav.player(r.player_id)}>
                <span><span className="muted">{COMP_INFO[r.competition_id]?.short} </span>{r.name} <span className="muted">{r.club}</span></span>
                <b className="small">{Math.round(r.value)} VAL</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small">MVP: victorias añadidas + 0,12 × valoración por partido + 0,05 × victorias del equipo. Hace falta jugar la mitad de los partidos. Detalles en Datos › Fórmulas.</p>
    </div>
  );
}

type Rec = ReturnType<typeof AW.records>;
const GAME_CATS: [keyof Rec['game'], string][] = [['pts', 'Puntos'], ['reb', 'Rebotes'], ['ast', 'Asistencias'], ['val', 'Valoración'], ['t3', 'Triples'], ['stl', 'Robos'], ['blk', 'Tapones']];
const SEASON_CATS: [keyof Rec['season'], string][] = [['pts', 'Puntos por partido'], ['reb', 'Rebotes por partido'], ['ast', 'Asistencias por partido'], ['val', 'Valoración por partido']];
const CAREER_CATS: [keyof Rec['career'], string][] = [['pts', 'Puntos'], ['reb', 'Rebotes'], ['ast', 'Asistencias'], ['t3', 'Triples'], ['gp', 'Partidos']];

export function RecordsView({ nav }: { nav: Nav }) {
  const [scope, setScope] = useSticky<'game' | 'season' | 'career'>('rec.scope', 'game');
  const [cat, setCat] = useSticky('rec.cat', 'pts');
  const { data, error } = useData<Rec>('records', null, []);
  if (!data) return <Loading error={error} />;
  const cats = scope === 'game' ? GAME_CATS : scope === 'season' ? SEASON_CATS : CAREER_CATS;
  const key = cats.some(([k]) => k === cat) ? cat : cats[0]![0];
  const rows = (data[scope] as Record<string, { v: number; player_id: number; name: string; club?: string; season?: number; game_id?: number; rival?: string; gp?: number; seasons?: number; retired?: number }[]>)[key] ?? [];
  return (
    <section>
      <Tabs<'game' | 'season' | 'career'> small value={scope} onChange={setScope} options={[['game', 'En un partido'], ['season', 'En una temporada'], ['career', 'En su carrera']]} />
      <div className="row">
        <select value={key} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          {cats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <ol className="leaders">
        {rows.map((r, i) => (
          <li key={i} className="tap" onClick={() => (scope === 'game' && r.game_id ? nav.game(r.game_id) : nav.player(r.player_id))}>
            <span>
              {r.name}{' '}
              <span className="muted">
                {scope === 'game' ? `${r.club} vs ${r.rival} · ${seasonLabel(r.season!)}` : scope === 'season' ? `${r.club} · ${seasonLabel(r.season!)} · ${r.gp} PJ` : `${r.gp} PJ · ${r.seasons} temp.${r.retired ? ' · retirado' : ''}`}
              </span>
            </span>
            <b>{scope === 'season' ? f1(r.v) : Math.round(r.v).toLocaleString('es-ES')}</b>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="muted">Todavía no hay datos.</p>}
      <p className="muted small">Todas las competiciones simuladas. Por temporada: liga regular con al menos 20 partidos.</p>
    </section>
  );
}

type Hist = ReturnType<typeof AW.clubHistory>;
export function ClubHistory({ clubId, nav }: { clubId: number; nav: Nav }) {
  const { data, error } = useData<Hist>('clubHistory', { clubId }, [clubId]);
  if (!data) return <Loading error={error} />;
  const won = data.titles.filter((t) => t.kind === 'campeón');
  return (
    <div>
      <section>
        <h3>Palmarés</h3>
        {won.length === 0 ? <p className="muted">Aún sin títulos en esta partida.</p> : (
          <ul className="plain">
            {won.map((t, i) => <li key={i}>🏆 {COMP_INFO[t.competition_id]?.name ?? ''} {seasonLabel(t.season)}</li>)}
          </ul>
        )}
        {data.titles.some((t) => t.kind === 'finalista') && (
          <p className="muted small">Finalista: {data.titles.filter((t) => t.kind === 'finalista').map((t) => `${COMP_INFO[t.competition_id]?.short ?? ''} ${seasonLabel(t.season)}`).join(' · ')}</p>
        )}
      </section>
      <section>
        <h3>Temporada a temporada</h3>
        {data.seasons.length === 0 ? <p className="muted">Sin partidos jugados todavía.</p> : (
          <div className="tbl">
            <table>
              <thead><tr><th className="l">Temp.</th><th className="l">Liga</th><th>Pos.</th><th>G</th><th>P</th><th>Dif.</th></tr></thead>
              <tbody>
                {data.seasons.map((s) => (
                  <tr key={`${s.season}-${s.competition_id}`}>
                    <td className="l">{seasonLabel(s.season)}</td>
                    <td className="l">{COMP_INFO[s.competition_id]?.short}</td>
                    <td>{s.pos ?? '—'}</td><td>{s.w}</td><td>{s.l}</td>
                    <td>{s.pf - s.pa > 0 ? '+' : ''}{s.pf - s.pa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {data.best.length > 0 && (
        <section>
          <h3>Máximos anotadores del club</h3>
          <ol className="leaders">
            {data.best.map((b) => (
              <li key={b.player_id} className="tap" onClick={() => nav.player(b.player_id)}>
                <span>{b.name} <span className="muted">{b.gp} PJ</span></span><b>{b.pts.toLocaleString('es-ES')}</b>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

type Youth = ReturnType<typeof AW.youthReport>;
type Msg = { ok: boolean; message: string } | null;
export function YouthReport({ nav, myClub }: { nav: Nav; myClub: number }) {
  const [maxAge, setMaxAge] = useSticky('yr.age', 21);
  const [where, setWhere] = useSticky<'todos' | 'clubes' | 'canteras' | 'libres'>('yr.where', 'todos');
  const { data, error, reload } = useData<Youth>('youthReport', { maxAge }, [maxAge]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading error={error} />;
  const act = async (op: string, args: unknown) => {
    setBusy(true);
    setMsg(await call<Msg>(op, args));
    setBusy(false);
    reload();
  };
  const rows = data.rows.filter((r) => where === 'todos' || (where === 'clubes' ? r.club_id !== null : where === 'canteras' ? r.youth > 0 : r.club_id === null && !r.youth));
  return (
    <div>
      <section>
        <h3>Informe de jóvenes</h3>
        <p className="muted small">
          Los mejores jóvenes de España y Europa ordenados por el potencial que estiman tus ojeadores. «Ojear» ({eur(data.scoutCost)}) afina mucho la estimación y lo añade a tu seguimiento.
          A los juveniles de otras canteras te los puedes llevar en verano pagando la compensación por formación.
        </p>
        <div className="row">
          <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} aria-label="Edad máxima">
            {[19, 21, 23].map((a) => <option key={a} value={a}>Hasta {a} años</option>)}
          </select>
          <select value={where} onChange={(e) => setWhere(e.target.value as typeof where)} aria-label="Dónde">
            <option value="todos">Todos</option><option value="clubes">En clubes</option><option value="canteras">En canteras</option><option value="libres">Libres</option>
          </select>
        </div>
      </section>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.message}</p>}
      <section>
        {rows.map((r) => (
          <div key={r.id} className="youth">
            <span className="tap" onClick={() => nav.player(r.id)}>
              {r.origin !== 'real' ? <Face id={r.id} nationality={r.nationality} age={r.age} size={38} /> : <span className="face" style={{ width: 38, height: 57 }} />}
            </span>
            <div className="info tap" onClick={() => nav.player(r.id)}>
              <b>{r.watched ? '★ ' : ''}{shortName(r.name)}</b> <CupoTag nationality={r.nationality} />
              <div className="muted small">{r.pos1}{r.pos2 ? `/${r.pos2}` : ''} · {r.age} años · {r.club ?? (r.youth_club ? `cantera ${r.youth_club}` : 'libre')}</div>
              <div className="small">
                Media <b>{r.ovr}</b> · Potencial <b className={r.potential_est >= 75 ? 'good' : ''}>{r.potential_est}</b>{r.scouted ? <span className="good"> ✓ ojeado</span> : <span className="muted"> (estimado)</span>}
                {r.line && r.line.gp > 0 && <span className="muted"> · {f1(r.line.pts / r.line.gp)} pts</span>}
              </div>
            </div>
            <div className="acts">
              {!r.scouted && r.club_id !== myClub && r.youth !== myClub && <button className="sec" disabled={busy} onClick={() => act('scout', { id: r.id, clubId: myClub })}>Ojear</button>}
              {r.signFee !== null && <button disabled={busy} onClick={() => { if (confirm(`Compensación por formación: ${eur(r.signFee)}. ¿Llevarlo a tu cantera?`)) void act('signYouth', { id: r.id, clubId: myClub }); }}>A mi cantera</button>}
              {!r.watched && r.club_id !== myClub && <button className="sec" disabled={busy} onClick={async () => { await call('watch', { id: r.id, on: true }); reload(); }}>☆ Seguir</button>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="muted">Nadie con estos filtros.</p>}
      </section>
    </div>
  );
}

/* ───────────── Comparar jugadores ───────────── */

import { ATTRS, GROUP_LABEL, type AttrGroup } from '../core/attributes';
import type * as Q from '../core/queries';

type PD = ReturnType<typeof Q.playerDetail>;
type SquadRow = { id: number; name: string; pos1: string; ovr: number };

/** Compara a un jugador con uno de tu plantilla: media, atributos por grupos y estadísticas por partido. */
export function PlayerCompare({ a, myClub, nav }: { a: PD; myClub: number; nav: Nav }) {
  const squad = useData<{ players: SquadRow[] }>('squad', { clubId: myClub }, [myClub]);
  const others = (squad.data?.players ?? []).filter((p) => p.id !== Number(a.player.id));
  const samePos = others.filter((p) => p.pos1 === a.player.pos1).sort((x, y) => y.ovr - x.ovr);
  const [bId, setBId] = useState<number | null>(null);
  const pick = bId ?? samePos[0]?.id ?? others[0]?.id ?? null;
  const b = useData<PD>('player', { id: pick }, [pick]);
  if (!squad.data) return <Loading error={squad.error} />;
  if (pick === null) return <p className="muted">No hay nadie en tu plantilla con quien comparar.</p>;
  if (!b.data || Number(b.data.player.id) !== pick) return <Loading error={b.error} />;
  const B = b.data;
  const cur = (d: PD) => d.career.filter((c) => c.season === d.season && c.stage === 'regular')[0]?.line ?? null;
  const la = cur(a);
  const lb = cur(B);
  const per = (l: ReturnType<typeof cur>, f: (l: NonNullable<ReturnType<typeof cur>>) => number) => (l && l.gp ? f(l) / l.gp : null);
  const groupAvg = (d: PD, g: AttrGroup) => {
    const ks = ATTRS.filter((x) => x.group === g);
    return ks.reduce((s, k) => s + d.attrs[k.key], 0) / ks.length;
  };
  const rows: [string, number | null, number | null, (x: number | null) => string][] = [
    ['Media', a.ovr, B.ovr, (x) => (x === null ? '—' : String(Math.round(x)))],
    ['Potencial estimado', Number(a.player.potential_est), Number(B.player.potential_est), (x) => (x === null ? '—' : String(Math.round(x)))],
    ['Edad', a.age, B.age, (x) => (x === null ? '—' : String(x))],
    ...(['off', 'def', 'fis', 'men'] as AttrGroup[]).map((g) => [`${GROUP_LABEL[g]} (media)`, groupAvg(a, g), groupAvg(B, g), (x: number | null) => (x === null ? '—' : String(Math.round(x)))] as [string, number, number, (x: number | null) => string]),
    ['Puntos', per(la, (l) => l.pts), per(lb, (l) => l.pts), f1],
    ['Rebotes', per(la, (l) => l.orb + l.drb), per(lb, (l) => l.orb + l.drb), f1],
    ['Asistencias', per(la, (l) => l.ast), per(lb, (l) => l.ast), f1],
    ['Valoración', per(la, (l) => l.pir), per(lb, (l) => l.pir), f1],
    ['Minutos', per(la, (l) => l.sec / 60), per(lb, (l) => l.sec / 60), f1],
    ['TS%', la?.ts ?? null, lb?.ts ?? null, (x) => (x === null ? '—' : `${(x * 100).toFixed(1).replace('.', ',')}`)],
    ['Victorias añadidas', la?.va ?? null, lb?.va ?? null, f1],
  ];
  const lower = new Set(['Edad']);
  return (
    <section>
      <div className="row">
        <span className="muted small">Comparar con</span>
        <select value={pick} onChange={(e) => setBId(Number(e.target.value))} aria-label="Jugador de tu plantilla">
          {[...samePos, ...others.filter((p) => p.pos1 !== a.player.pos1)].map((p) => <option key={p.id} value={p.id}>{p.name} · {p.pos1} · {p.ovr}</option>)}
        </select>
      </div>
      <div className="tbl">
        <table className="cmp">
          <thead><tr><th className="l"> </th><th>{shortName(String(a.player.name))}</th><th className="tap" onClick={() => nav.player(pick)}>{shortName(String(B.player.name))} ›</th></tr></thead>
          <tbody>
            {rows.map(([label, x, y, fmt]) => {
              const better = x === null || y === null || Math.abs(x - y) < 1e-9 ? 0 : (x > y) !== lower.has(label) ? 1 : 2;
              return (
                <tr key={label}>
                  <td className="l">{label}</td>
                  <td className={better === 1 ? 'good b' : ''}>{fmt(x)}</td>
                  <td className={better === 2 ? 'good b' : ''}>{fmt(y)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>Atributos</h3>
      {ATTRS.map((k) => {
        const x = a.attrs[k.key];
        const y = B.attrs[k.key];
        return (
          <div key={k.key} className="cmpbar">
            <span className={x > y ? 'good b' : ''}>{x}</span>
            <div className="bars"><i style={{ width: `${x}%` }} className="l" /><i style={{ width: `${y}%` }} className="r" /></div>
            <span className={y > x ? 'good b' : ''}>{y}</span>
            <small>{k.label}</small>
          </div>
        );
      })}
      <p className="muted small">Arriba de cada barra, este jugador (naranja); abajo, el tuyo (azul). Estadísticas: liga regular de esta temporada.</p>
    </section>
  );
}
