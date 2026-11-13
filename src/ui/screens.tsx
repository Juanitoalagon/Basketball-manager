/** Pantallas del juego: inicio, plantilla, ficha de jugador, partidos, hoja de partido y liga. */
import { useEffect, useMemo, useState } from 'react';
import { ATTRS, GROUP_LABEL, POS_LABEL, type AttrGroup, type Pos } from '../core/attributes';
import { ZONES } from '../core/court';
import { EV } from '../core/engine';
import { COUNTRY_LABEL } from '../core/names';
import type * as Q from '../core/queries';
import type { DayReport } from '../core/season';
import { fga, fgm, pir, reb } from '../core/stats';
import type { Line } from '../core/stats';
import { call, cancelLoad, setProgressListener } from '../db/client';
import type { AdvanceResult, LoadProgress } from '../db/protocol';
import { DotMap, ZoneMap } from './ShotMap';
import { Back, type Col, Loading, type Nav, Table, Tabs, Tag, clock, f0, f1, f2, mins, pc, pcRaw, seasonLabel, signed, useData } from './kit';

type HomeData = NonNullable<ReturnType<typeof Q.home>> & { club: NonNullable<ReturnType<typeof Q.home>>['club'] };
type GameRow = Q.GameListRow;

const per = (l: Line, k: keyof Line) => (l.gp ? (l[k] as number) / l.gp : null);
const stageLabel = (s: string) => (s === 'playoffs' ? 'Playoffs' : 'Liga regular');

function Result({ g, clubId }: { g: GameRow; clubId?: number | null }) {
  const played = g.status === 'jugado';
  const home = g.home_id === clubId;
  const mine = clubId ? (home ? g.home_pts! : g.away_pts!) : 0;
  const theirs = clubId ? (home ? g.away_pts! : g.home_pts!) : 0;
  const wl = played && clubId && (g.home_id === clubId || g.away_id === clubId) ? (mine > theirs ? 'G' : 'P') : null;
  return (
    <span className="res">
      {wl && <b className={wl === 'G' ? 'good' : 'bad'}>{wl} </b>}
      <span className={g.home_pts !== null && g.home_pts > (g.away_pts ?? 0) ? 'win' : ''}>{g.home_short}</span>{' '}
      {played ? `${g.home_pts}-${g.away_pts}` : 'vs'}{' '}
      <span className={g.away_pts !== null && g.away_pts > (g.home_pts ?? 0) ? 'win' : ''}>{g.away_short}</span>
      {g.ot ? ` (${g.ot === 1 ? 'pr.' : `${g.ot} pr.`})` : ''}
    </span>
  );
}

/* ───────────────────────────── Inicio ───────────────────────────── */

export function HomeScreen({ nav, onChanged, log, setLog }: { nav: Nav; onChanged: () => void; log: DayReport[] | null; setLog: (l: DayReport[]) => void }) {
  const { data, error, reload } = useData<HomeData>('home', null, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setProgressListener(setProgress);
    return () => setProgressListener(null);
  }, []);

  const go = async (mode: 'day' | 'week' | 'regular' | 'season') => {
    setBusy(mode);
    setErr(null);
    setProgress(null);
    try {
      const r = await call<AdvanceResult>('advance', { mode });
      setLog(r.reports);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
      reload();
      onChanged();
    }
  };
  const newSeason = async () => {
    setBusy('season');
    setErr(null);
    try {
      const r = await call<{ events: string[]; season: number }>('newSeason');
      setLog([{ season: r.season, day: 0, stage: 'regular', games: 0, userGame: null, events: r.events, seasonOver: false }]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
      reload();
      onChanged();
    }
  };

  if (!data || !data.club) return <Loading error={error} />;
  const u = data.universe;
  const me = data.table.find((r) => r.club_id === data.club!.id);
  const userGames = log?.filter((r) => r.userGame).map((r) => r.userGame!) ?? [];
  const events = log?.flatMap((r) => r.events) ?? [];
  const playing = u.phase === 'regular' || u.phase === 'playoffs';
  const top = data.table.slice(0, 8);
  const meIdx = data.table.findIndex((r) => r.club_id === data.club!.id);
  const mini = meIdx >= 8 ? [...top, data.table[meIdx]!] : top;

  return (
    <div>
      <section className="hero">
        <div className="muted">{data.club.comp} · Temporada {seasonLabel(u.game_season)} · {u.phase === 'playoffs' ? 'Playoffs' : u.phase === 'fin' ? 'Temporada terminada' : u.game_day === 0 ? 'Pretemporada' : `Jornada ${u.game_day} de 34`}</div>
        <h2 className="tap" onClick={() => nav.club(data.club!.id)}>{data.club.name}</h2>
        <div className="big">
          {me ? `${me.w}-${me.l}` : '0-0'} <span className="muted">· {data.position}º</span>
        </div>
      </section>

      {err && <p className="error">{err}</p>}

      <section>
        <h3>Próximo partido</h3>
        {data.next ? (
          <p className="tap" onClick={() => nav.club(data.next!.home_id === data.club!.id ? data.next!.away_id : data.next!.home_id)}>
            {stageLabel(data.next.stage)} · día {data.next.day} · {data.next.home_id === data.club.id ? `contra ${data.next.away} (en casa)` : `en la pista de ${data.next.home}`}
          </p>
        ) : (
          <p className="muted">{u.phase === 'fin' ? 'La temporada ha terminado.' : u.phase === 'playoffs' ? 'Tu equipo no juega estos playoffs. Puedes seguir simulando.' : 'Sin partidos pendientes.'}</p>
        )}
        {playing && (
          <div className="row">
            <button disabled={!!busy || data.nextDay === null && u.phase !== 'regular'} onClick={() => go('day')}>Jugar siguiente jornada</button>
            <button className="sec" disabled={!!busy} onClick={() => go('week')}>5 jornadas</button>
            {u.phase === 'regular' && <button className="sec" disabled={!!busy} onClick={() => go('regular')}>Hasta los playoffs</button>}
            <button className="sec" disabled={!!busy} onClick={() => go('season')}>Hasta el final</button>
          </div>
        )}
        {u.phase === 'fin' && (
          <div className="row">
            <button disabled={!!busy} onClick={newSeason}>Empezar temporada {seasonLabel(u.game_season + 1)}</button>
          </div>
        )}
        {busy && (
          <div className="row">
            <span className="muted">Simulando… {progress ? `día ${progress.day}` : ''}</span>
            <button className="sec" onClick={cancelLoad}>Detener</button>
          </div>
        )}
        {data.result.length > 0 && (
          <ul className="plain">
            {data.result.map((r) => (
              <li key={r.competition_id}>{r.competition_id === 1 ? 'Liga ACB' : 'Primera FEB'}: {r.champion ? <b>campeón {r.champion}</b> : <>líder de la fase regular {r.first}</>}</li>
            ))}
          </ul>
        )}
      </section>

      {log && (userGames.length > 0 || events.length > 0) && (
        <section>
          <h3>Lo último</h3>
          <ul className="plain">
            {userGames.slice(-6).reverse().map((g) => (
              <li key={g.id} className="tap" onClick={() => nav.game(g.id)}>
                {g.home} <b>{g.homePts}-{g.awayPts}</b> {g.away} ›
              </li>
            ))}
            {events.map((e, i) => (
              <li key={`e${i}`}>{e}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Últimos resultados</h3>
        {data.last.length === 0 ? <p className="muted">Aún no se ha jugado ningún partido.</p> : (
          <ul className="plain">
            {data.last.map((g) => (
              <li key={g.id} className="tap" onClick={() => nav.game(g.id)}>
                <span className="muted">{g.stage === 'playoffs' ? 'PO' : `J${g.day}`}</span> <Result g={g} clubId={data.club!.id} /> ›
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Clasificación</h3>
        <Table
          cols={[
            { key: 'pos', label: '#', left: true, value: (r) => data.table.indexOf(r) + 1 },
            { key: 'club', label: 'Club', left: true, value: (r) => r.short },
            { key: 'w', label: 'G', value: (r) => r.w },
            { key: 'l', label: 'P', value: (r) => r.l },
            { key: 'd', label: 'Dif.', value: (r) => r.pf - r.pa, render: (r) => signed(r.pf - r.pa) },
          ]}
          rows={mini}
          rowKey={(r) => r.club_id}
          highlight={(r) => r.club_id === data.club!.id}
          onRow={(r) => nav.club(r.club_id)}
        />
      </section>
    </div>
  );
}

/* ───────────────────────────── Plantilla ───────────────────────────── */

type SquadData = ReturnType<typeof Q.squad>;
type SquadRow = SquadData['players'][number];
type Group = 'basic' | 'shoot' | 'adv' | 'bio';

export function SquadScreen({ clubId, nav, isMine, onBack }: { clubId: number; nav: Nav; isMine: boolean; onBack?: () => void }) {
  const { data, error } = useData<SquadData>('squad', { clubId }, [clubId]);
  const [group, setGroup] = useState<Group>('basic');
  if (!data) return <Loading error={error} />;
  const L = (r: SquadRow) => r.line;
  const pg = (k: keyof Line) => (r: SquadRow) => (L(r) ? per(L(r)!, k) : null);
  const base: Col<SquadRow>[] = [{ key: 'name', label: 'Jugador', left: true, value: (r) => r.name, render: (r) => <><span className="num">{r.number ?? ''}</span> {r.name}</> }];
  const groups: Record<Group, Col<SquadRow>[]> = {
    basic: [
      { key: 'gp', label: 'PJ', value: (r) => L(r)?.gp ?? 0 },
      { key: 'min', label: 'MIN', value: (r) => (L(r) ? L(r)!.sec / 60 / L(r)!.gp : null), render: (r) => (L(r) ? mins(L(r)!.sec, L(r)!.gp) : '—') },
      { key: 'pts', label: 'PTS', value: pg('pts'), render: (r) => f1(pg('pts')(r)) },
      { key: 'reb', label: 'REB', value: (r) => (L(r) ? reb(L(r)!) / L(r)!.gp : null), render: (r) => (L(r) ? f1(reb(L(r)!) / L(r)!.gp) : '—') },
      { key: 'ast', label: 'AST', value: pg('ast'), render: (r) => f1(pg('ast')(r)) },
      { key: 'stl', label: 'ROB', value: pg('stl'), render: (r) => f1(pg('stl')(r)) },
      { key: 'blk', label: 'TAP', value: pg('blk'), render: (r) => f1(pg('blk')(r)) },
      { key: 'tov', label: 'PÉR', value: pg('tov'), render: (r) => f1(pg('tov')(r)) },
      { key: 'pir', label: 'VAL', title: 'Valoración (PIR) por partido', value: (r) => (L(r) ? L(r)!.pir / L(r)!.gp : null), render: (r) => (L(r) ? f1(L(r)!.pir / L(r)!.gp) : '—') },
    ],
    shoot: [
      { key: 'fg', label: 'TC%', value: (r) => (L(r) && fga(L(r)!) ? fgm(L(r)!) / fga(L(r)!) : null), render: (r) => (L(r) ? pc(fga(L(r)!) ? fgm(L(r)!) / fga(L(r)!) : null) : '—') },
      { key: 't2', label: 'T2', value: (r) => L(r)?.fga2 ?? 0, render: (r) => (L(r) ? `${L(r)!.fgm2}/${L(r)!.fga2}` : '—') },
      { key: 't3', label: 'T3', value: (r) => L(r)?.fga3 ?? 0, render: (r) => (L(r) ? `${L(r)!.fgm3}/${L(r)!.fga3}` : '—') },
      { key: 't3p', label: 'T3%', value: (r) => (L(r)?.fga3 ? L(r)!.fgm3 / L(r)!.fga3 : null), render: (r) => pc(L(r)?.fga3 ? L(r)!.fgm3 / L(r)!.fga3 : null) },
      { key: 'ftp', label: 'TL%', value: (r) => (L(r)?.fta ? L(r)!.ftm / L(r)!.fta : null), render: (r) => pc(L(r)?.fta ? L(r)!.ftm / L(r)!.fta : null) },
      { key: 'efg', label: 'eFG%', value: (r) => L(r)?.efg ?? null, render: (r) => pc(L(r)?.efg) },
      { key: 'ts', label: 'TS%', value: (r) => L(r)?.ts ?? null, render: (r) => pc(L(r)?.ts) },
    ],
    adv: [
      { key: 'usg', label: 'USG%', value: (r) => L(r)?.usg ?? null, render: (r) => pcRaw(L(r)?.usg) },
      { key: 'astp', label: 'AST%', value: (r) => L(r)?.astPct ?? null, render: (r) => pcRaw(L(r)?.astPct) },
      { key: 'rebp', label: 'REB%', value: (r) => L(r)?.rebPct ?? null, render: (r) => pcRaw(L(r)?.rebPct) },
      { key: 'tovp', label: 'PÉR%', value: (r) => L(r)?.tovPct ?? null, render: (r) => pcRaw(L(r)?.tovPct) },
      { key: 'ows', label: 'OWS', value: (r) => L(r)?.ows ?? null, render: (r) => f1(L(r)?.ows) },
      { key: 'dws', label: 'DWS', value: (r) => L(r)?.dws ?? null, render: (r) => f1(L(r)?.dws) },
      { key: 'ws', label: 'WS', value: (r) => L(r)?.ws ?? null, render: (r) => f1(L(r)?.ws) },
      { key: 'ws40', label: 'WS/40', value: (r) => L(r)?.ws40 ?? null, render: (r) => (L(r) ? f2(L(r)!.ws40) : '—') },
      { key: 'pm', label: '+/-', value: (r) => L(r)?.pm ?? null, render: (r) => (L(r) ? signed(L(r)!.pm) : '—') },
    ],
    bio: [
      { key: 'pos', label: 'Pos.', value: (r) => r.pos1, render: (r) => `${r.pos1}${r.pos2 ? `/${r.pos2}` : ''}` },
      { key: 'age', label: 'Edad', value: (r) => r.age },
      { key: 'h', label: 'Altura', value: (r) => r.height_cm, render: (r) => `${(r.height_cm / 100).toFixed(2).replace('.', ',')}` },
      { key: 'ovr', label: 'Media', value: (r) => r.ovr },
      { key: 'pot', label: 'Pot.', title: 'Potencial estimado por tus ojeadores', value: (r) => r.potential_est },
      { key: 'nat', label: 'Nac.', value: (r) => r.nationality },
    ],
  };
  return (
    <div>
      {onBack && <Back onBack={onBack} />}
      <section className="hero">
        <div className="muted">{data.club.comp} · {seasonLabel(data.season)}</div>
        <h2>{data.club.name}</h2>
      </section>
      <Tabs<Group> small value={group} onChange={setGroup} options={[['basic', 'Básicas'], ['shoot', 'Tiro'], ['adv', 'Avanzadas'], ['bio', 'Ficha']]} />
      <Table cols={[...base, ...groups[group]]} rows={data.players} rowKey={(r) => r.id} onRow={(r) => nav.player(r.id)} defaultSort={group === 'bio' ? { key: 'ovr', desc: true } : null} />
      <p className="muted">Por partido, fase regular. <Tag kind="sim" /> {isMine ? 'Toca un jugador para ver su ficha.' : ''}</p>
    </div>
  );
}

/* ───────────────────────────── Ficha de jugador ───────────────────────────── */

type PlayerData = ReturnType<typeof Q.playerDetail>;
type PTab = 'res' | 'attr' | 'stats' | 'log' | 'map';

function attrClass(v: number) {
  return v >= 80 ? 'a4' : v >= 65 ? 'a3' : v >= 50 ? 'a2' : v >= 35 ? 'a1' : 'a0';
}

export function PlayerScreen({ id, nav }: { id: number; nav: Nav }) {
  const { data, error } = useData<PlayerData>('player', { id }, [id]);
  const [tab, setTab] = useState<PTab>('res');
  if (!data) return <Loading error={error} />;
  const p = data.player as Record<string, string | number | null>;
  const cur = data.career.filter((c) => c.season === data.season);
  const reg = cur.find((c) => c.stage === 'regular')?.line;
  return (
    <div>
      <Back onBack={nav.back} />
      <section className="hero">
        <div className="muted tap" onClick={() => p.club_id && nav.club(Number(p.club_id))}>
          {p.number !== null ? `#${p.number} · ` : ''}{p.club ?? 'Sin club'} · {POS_LABEL[p.pos1 as Pos]}{p.pos2 ? ` / ${POS_LABEL[p.pos2 as Pos]}` : ''}
        </div>
        <h2>{p.name}</h2>
        <div className="chips">
          <span>{data.age} años</span>
          <span>{(Number(p.height_cm) / 100).toFixed(2).replace('.', ',')} m</span>
          <span>{p.weight_kg} kg</span>
          <span>Env. {(Number(p.wingspan_cm) / 100).toFixed(2).replace('.', ',')} m</span>
          <span>{COUNTRY_LABEL[String(p.nationality)] ?? p.nationality}</span>
          <span>{p.hand === 'L' ? 'Zurdo' : 'Diestro'}</span>
        </div>
        <div className="big">
          {data.ovr} <span className="muted small">media{data.prevOvr !== null ? ` (${signed(data.ovr - data.prevOvr)})` : ''} · potencial estimado {p.potential_est}</span>
        </div>
        <p className="muted small">Jugador generado <Tag kind="est" /> · estadísticas <Tag kind="sim" /></p>
      </section>
      <Tabs<PTab> small value={tab} onChange={setTab} options={[['res', 'Resumen'], ['attr', 'Atributos'], ['stats', 'Estadísticas'], ['log', 'Partidos'], ['map', 'Mapa de tiro']]} />

      {tab === 'res' && (
        <section>
          <h3>Temporada {seasonLabel(data.season)}</h3>
          {reg ? (
            <div className="kpis">
              {[
                ['PTS', f1(reg.pts / reg.gp)], ['REB', f1(reb(reg) / reg.gp)], ['AST', f1(reg.ast / reg.gp)], ['MIN', mins(reg.sec, reg.gp)],
                ['TS%', pc(reg.ts)], ['USG%', pcRaw(reg.usg)], ['VAL', f1(reg.pir / reg.gp)], ['WS', f1(reg.ws)],
              ].map(([k, v]) => (
                <div key={k}><div className="kv">{v}</div><div className="kk">{k}</div></div>
              ))}
            </div>
          ) : <p className="muted">Todavía no ha jugado esta temporada.</p>}
          <h3>Media en cada posición</h3>
          <div className="chips">
            {data.posOvr.map((x) => (
              <span key={x.pos} className={x.pos === p.pos1 ? 'on' : ''}>{x.pos} {x.ovr}</span>
            ))}
          </div>
          <p className="muted small">La media resume al jugador para su posición; los partidos los deciden los atributos concretos.</p>
        </section>
      )}

      {tab === 'attr' && (
        <section>
          {(['off', 'def', 'fis', 'men'] as AttrGroup[]).map((g) => (
            <div key={g}>
              <h3>{GROUP_LABEL[g]}</h3>
              {ATTRS.filter((a) => a.group === g).map((a) => {
                const v = data.attrs[a.key];
                const d = data.prevAttrs ? v - data.prevAttrs[a.key] : 0;
                return (
                  <div key={a.key} className="attr">
                    <span className="an">{a.label}</span>
                    <span className="ab"><span className={attrClass(v)} style={{ width: `${v}%` }} /></span>
                    <span className="av">{v}{d ? <small className={d > 0 ? 'good' : 'bad'}> {d > 0 ? '+' : ''}{d}</small> : null}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <p className="muted small">Altura, peso y envergadura están en la cabecera. Escala 1-99; las flechas comparan con la temporada anterior.</p>
        </section>
      )}

      {tab === 'stats' && (
        <section>
          <Table
            cols={[
              { key: 's', label: 'Temp.', left: true, value: (r) => r.season * 10 + (r.stage === 'playoffs' ? 1 : 0), render: (r) => `${seasonLabel(r.season)} ${r.comp}${r.stage === 'playoffs' ? ' PO' : ''}` },
              { key: 'gp', label: 'PJ', value: (r) => r.line.gp },
              { key: 'min', label: 'MIN', value: (r) => r.line.sec / r.line.gp, render: (r) => mins(r.line.sec, r.line.gp) },
              { key: 'pts', label: 'PTS', value: (r) => r.line.pts / r.line.gp, render: (r) => f1(r.line.pts / r.line.gp) },
              { key: 'reb', label: 'REB', value: (r) => reb(r.line) / r.line.gp, render: (r) => f1(reb(r.line) / r.line.gp) },
              { key: 'ast', label: 'AST', value: (r) => r.line.ast / r.line.gp, render: (r) => f1(r.line.ast / r.line.gp) },
              { key: 't3', label: 'T3%', value: (r) => (r.line.fga3 ? r.line.fgm3 / r.line.fga3 : null), render: (r) => pc(r.line.fga3 ? r.line.fgm3 / r.line.fga3 : null) },
              { key: 'ts', label: 'TS%', value: (r) => r.line.ts, render: (r) => pc(r.line.ts) },
              { key: 'usg', label: 'USG%', value: (r) => r.line.usg, render: (r) => pcRaw(r.line.usg) },
              { key: 'pir', label: 'VAL', value: (r) => r.line.pir / r.line.gp, render: (r) => f1(r.line.pir / r.line.gp) },
              { key: 'ws', label: 'WS', value: (r) => r.line.ws, render: (r) => f1(r.line.ws) },
              { key: 'ws40', label: 'WS/40', value: (r) => r.line.ws40, render: (r) => f2(r.line.ws40) },
              { key: 'src', label: 'Origen', value: () => 'sim', render: () => <Tag kind="sim" /> },
            ]}
            rows={data.career}
            rowKey={(r) => `${r.season}-${r.comp}-${r.stage}`}
          />
          {data.career.length === 0 && <p className="muted">Sin estadísticas todavía.</p>}
          <p className="muted small">Promedios por partido. Las estadísticas reales importadas aparecerán aquí con su propia etiqueta, separadas de las simuladas.</p>
        </section>
      )}

      {tab === 'log' && (
        <section>
          <Table
            cols={[
              { key: 'd', label: 'Día', left: true, value: (r) => Number(r.day), render: (r) => (r.stage === 'playoffs' ? `PO ${r.day}` : `J${r.day}`) },
              { key: 'rival', label: 'Partido', left: true, value: (r) => `${r.home_short}-${r.away_short}`, render: (r) => `${r.home_short} ${r.home_pts}-${r.away_pts} ${r.away_short}` },
              { key: 'min', label: 'MIN', value: (r) => r.line.sec, render: (r) => mins(r.line.sec) },
              { key: 'pts', label: 'PTS', value: (r) => r.line.pts },
              { key: 'reb', label: 'REB', value: (r) => reb(r.line) },
              { key: 'ast', label: 'AST', value: (r) => r.line.ast },
              { key: 't2', label: 'T2', value: (r) => r.line.fga2, render: (r) => `${r.line.fgm2}/${r.line.fga2}` },
              { key: 't3', label: 'T3', value: (r) => r.line.fga3, render: (r) => `${r.line.fgm3}/${r.line.fga3}` },
              { key: 'tl', label: 'TL', value: (r) => r.line.fta, render: (r) => `${r.line.ftm}/${r.line.fta}` },
              { key: 'pir', label: 'VAL', value: (r) => pir(r.line) },
              { key: 'pm', label: '+/-', value: (r) => r.line.pm, render: (r) => signed(r.line.pm) },
            ]}
            rows={data.gameLog as (Record<string, unknown> & { line: Line; day: number; stage: string; home_short: string; away_short: string; home_pts: number; away_pts: number; game_id: number })[]}
            rowKey={(r) => r.game_id}
            onRow={(r) => nav.game(r.game_id)}
          />
          {data.gameLog.length === 0 && <p className="muted">No ha jugado ningún partido esta temporada.</p>}
        </section>
      )}

      {tab === 'map' && <PlayerShotMap id={id} seasons={data.shotSeasons.length ? data.shotSeasons : [data.season]} />}
    </div>
  );
}

function PlayerShotMap({ id, seasons }: { id: number; seasons: number[] }) {
  const [season, setSeason] = useState(seasons[0]!);
  const [last, setLast] = useState<'all' | '5' | '10'>('all');
  const { data, error } = useData<ReturnType<typeof Q.shotZones>>('shotZones', { id, season, last: last === 'all' ? undefined : Number(last) }, [id, season, last]);
  return (
    <section>
      <div className="row">
        <label>
          Temporada{' '}
          <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
            {seasons.map((s) => (<option key={s} value={s}>{seasonLabel(s)}</option>))}
          </select>
        </label>
      </div>
      <Tabs<'all' | '5' | '10'> small value={last} onChange={setLast} options={[['all', 'Toda la temporada'], ['10', 'Últimos 10'], ['5', 'Últimos 5']]} />
      {data ? <ZoneMap mine={data.mine} league={data.league} /> : <Loading error={error} />}
      <p className="muted small">Comparado con la media de su competición en la misma temporada.</p>
    </section>
  );
}

/* ───────────────────────────── Partidos ───────────────────────────── */

export function GamesScreen({ clubId, nav }: { clubId: number; nav: Nav }) {
  const [mode, setMode] = useState<'mine' | 'days'>('mine');
  return (
    <div>
      <Tabs<'mine' | 'days'> value={mode} onChange={setMode} options={[['mine', 'Mi calendario'], ['days', 'Jornadas']]} />
      {mode === 'mine' ? <MySchedule clubId={clubId} nav={nav} /> : <Rounds nav={nav} clubId={clubId} />}
    </div>
  );
}

function MySchedule({ clubId, nav }: { clubId: number; nav: Nav }) {
  const { data, error } = useData<GameRow[]>('schedule', { clubId }, [clubId]);
  if (!data) return <Loading error={error} />;
  return (
    <section>
      <ul className="plain games">
        {data.map((g) => (
          <li key={g.id} className={g.status === 'jugado' ? 'tap' : ''} onClick={g.status === 'jugado' ? () => nav.game(g.id) : undefined}>
            <span className="muted">{g.stage === 'playoffs' ? 'PO' : `J${g.day}`}</span>
            <span>{g.home_id === clubId ? 'vs' : 'en'} {g.home_id === clubId ? g.away : g.home}</span>
            <span>{g.status === 'jugado' ? <Result g={g} clubId={clubId} /> : <span className="muted">pendiente</span>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Rounds({ nav, clubId }: { nav: Nav; clubId: number }) {
  const [comp, setComp] = useState(1);
  const days = useData<{ day: number; stage: string; played: number; total: number }[]>('compDays', { comp }, [comp]);
  const [day, setDay] = useState<number | null>(null);
  const current = useMemo(() => {
    if (!days.data?.length) return null;
    const lastPlayed = [...days.data].reverse().find((d) => d.played > 0);
    return day ?? lastPlayed?.day ?? days.data[0]!.day;
  }, [days.data, day]);
  const games = useData<GameRow[]>('dayGames', { comp, day: current }, [comp, current]);
  return (
    <section>
      <Tabs<string> small value={String(comp)} onChange={(v) => { setComp(Number(v)); setDay(null); }} options={[['1', 'Liga ACB'], ['2', 'Primera FEB']]} />
      {days.data && current !== null && (
        <div className="row">
          <button className="sec" disabled={current <= days.data[0]!.day} onClick={() => setDay(current - 1)}>‹</button>
          <select value={current} onChange={(e) => setDay(Number(e.target.value))}>
            {days.data.map((d) => (<option key={d.day} value={d.day}>{d.stage === 'playoffs' ? `Playoffs, día ${d.day}` : `Jornada ${d.day}`}{d.played === d.total ? '' : ' (pendiente)'}</option>))}
          </select>
          <button className="sec" disabled={current >= days.data[days.data.length - 1]!.day} onClick={() => setDay(current + 1)}>›</button>
        </div>
      )}
      {games.data ? (
        <ul className="plain games">
          {games.data.map((g) => (
            <li key={g.id} className={`${g.status === 'jugado' ? 'tap' : ''} ${g.home_id === clubId || g.away_id === clubId ? 'me' : ''}`} onClick={g.status === 'jugado' ? () => nav.game(g.id) : undefined}>
              <span>{g.home}</span>
              <b>{g.status === 'jugado' ? `${g.home_pts} - ${g.away_pts}${g.ot ? ' (pr.)' : ''}` : 'vs'}</b>
              <span>{g.away}</span>
            </li>
          ))}
        </ul>
      ) : <Loading error={games.error ?? days.error} />}
    </section>
  );
}

/* ───────────────────────────── Hoja de partido ───────────────────────────── */

type GameData = ReturnType<typeof Q.gameDetail>;
type BoxRow = GameData['players'][number];
const KIND_NAME = ['cerca del aro', 'en la pintura', 'de media distancia', 'de tres'];

function pbpText(e: number[], names: Record<number, string>): string {
  const [type, , , , p1, p2, extra] = e as [number, number, number, number, number, number, number];
  const n = (id: number) => names[id] ?? '¿?';
  switch (type) {
    case EV.MADE: {
      const k = (extra % 100) % 10;
      const pts = Math.floor((extra % 100) / 10);
      return `${n(p1)} anota ${KIND_NAME[k]} (${pts})${p2 ? `, asistencia de ${n(p2)}` : ''}`;
    }
    case EV.MISS: {
      const k = (extra % 100) % 10;
      const blocked = Math.floor(extra / 100) % 10 === 1;
      return `${n(p1)} falla ${KIND_NAME[k]}${blocked ? `: tapón de ${n(p2)}` : ''}`;
    }
    case EV.FT_MADE: return `${n(p1)} anota un tiro libre`;
    case EV.FT_MISS: return `${n(p1)} falla un tiro libre`;
    case EV.OREB: return `Rebote ofensivo de ${n(p1)}`;
    case EV.DREB: return `Rebote defensivo de ${n(p1)}`;
    case EV.TOV: return `Pérdida de ${n(p1)}${p2 ? `, robo de ${n(p2)}` : ''}`;
    case EV.FOUL: return `Falta${extra ? ' en el tiro' : ''} de ${n(p1)} sobre ${n(p2)}`;
    case EV.SUB: return `Cambio: entra ${n(p1)} por ${n(p2)}`;
    default: return '';
  }
}

export function GameScreen({ id, nav }: { id: number; nav: Nav }) {
  const { data, error } = useData<GameData>('game', { id }, [id]);
  const [tab, setTab] = useState<'box' | 'pbp' | 'shots' | 'team'>('box');
  const [side, setSide] = useState<0 | 1>(0);
  const [subs, setSubs] = useState(false);
  if (!data) return <><Back onBack={nav.back} /><Loading error={error} /></>;
  const g = data.game;
  const clubs = [g.home_id, g.away_id];
  const names = [g.home, g.away];
  const teamLine = (c: number) => data.teams.find((t) => t.club_id === c)!;
  const boxCols: Col<BoxRow>[] = [
    { key: 'n', label: 'Jugador', left: true, value: (r) => r.name, render: (r) => <span className={r.gs ? 'b' : ''}>{r.name}</span> },
    { key: 'min', label: 'MIN', value: (r) => r.line.sec, render: (r) => mins(r.line.sec) },
    { key: 'pts', label: 'PTS', value: (r) => r.line.pts },
    { key: 't2', label: 'T2', value: (r) => r.line.fga2, render: (r) => `${r.line.fgm2}/${r.line.fga2}` },
    { key: 't3', label: 'T3', value: (r) => r.line.fga3, render: (r) => `${r.line.fgm3}/${r.line.fga3}` },
    { key: 'tl', label: 'TL', value: (r) => r.line.fta, render: (r) => `${r.line.ftm}/${r.line.fta}` },
    { key: 'reb', label: 'REB', value: (r) => reb(r.line), render: (r) => `${reb(r.line)} (${r.line.orb}+${r.line.drb})` },
    { key: 'ast', label: 'AST', value: (r) => r.line.ast },
    { key: 'stl', label: 'ROB', value: (r) => r.line.stl },
    { key: 'blk', label: 'TAP', value: (r) => r.line.blk },
    { key: 'tov', label: 'PÉR', value: (r) => r.line.tov },
    { key: 'pf', label: 'FC', value: (r) => r.line.pf },
    { key: 'pm', label: '+/-', value: (r) => r.line.pm, render: (r) => signed(r.line.pm) },
    { key: 'pir', label: 'VAL', value: (r) => pir(r.line) },
  ];
  // Relato con marcador acumulado.
  let sh = 0;
  let sa = 0;
  const pbpRows = (data.pbp ?? []).map((e, i) => {
    const t = e[0]!;
    if (t === EV.MADE) {
      const pts = Math.floor(((e[6] ?? 0) % 100) / 10);
      if (e[3] === 0) sh += pts; else sa += pts;
    }
    if (t === EV.FT_MADE) { if (e[3] === 0) sh += 1; else sa += 1; }
    return { i, e, score: `${sh}-${sa}` };
  });
  const quarterLabel = (q: number) => (q <= 4 ? `${q}º cuarto` : q === 5 ? 'Prórroga' : `${q - 4}ª prórroga`);
  return (
    <div>
      <Back onBack={nav.back} />
      <section className="hero score">
        <div className="muted">{g.comp} · {stageLabel(g.stage)} · {g.stage === 'playoffs' ? `día ${g.day}` : `jornada ${g.day}`}</div>
        <div className="sb">
          <span className="tap" onClick={() => nav.club(g.home_id)}>{g.home}</span>
          <b>{g.home_pts} - {g.away_pts}</b>
          <span className="tap" onClick={() => nav.club(g.away_id)}>{g.away}</span>
        </div>
        {g.ot > 0 && <div className="muted">{g.ot === 1 ? 'Tras una prórroga' : `Tras ${g.ot} prórrogas`}</div>}
        {data.series && <div className="muted">Eliminatoria: {String(data.series.high_wins)}-{String(data.series.low_wins)}</div>}
      </section>
      <Tabs small value={tab} onChange={setTab} options={[['box', 'Estadísticas'], ['pbp', 'Jugada a jugada'], ['shots', 'Tiros'], ['team', 'Equipos']]} />
      {(tab === 'box' || tab === 'shots') && <Tabs<string> small value={String(side)} onChange={(v) => setSide(Number(v) as 0 | 1)} options={[['0', g.home_short], ['1', g.away_short]]} />}

      {tab === 'box' && (
        <section>
          <Table
            cols={boxCols}
            rows={data.players.filter((p) => p.club_id === clubs[side])}
            rowKey={(r) => r.id}
            onRow={(r) => nav.player(r.id)}
            foot={(() => {
              const t = teamLine(clubs[side]!).line;
              return (
                <tfoot>
                  <tr>
                    <td className="l">Total</td><td>{mins(t.sec / 5)}</td><td>{t.pts}</td><td>{t.fgm2}/{t.fga2}</td><td>{t.fgm3}/{t.fga3}</td><td>{t.ftm}/{t.fta}</td>
                    <td>{reb(t)} ({t.orb}+{t.drb})</td><td>{t.ast}</td><td>{t.stl}</td><td>{t.blk}</td><td>{t.tov}</td><td>{t.pf}</td><td></td><td>{pir(t)}</td>
                  </tr>
                </tfoot>
              );
            })()}
          />
          <p className="muted small">En negrita, los titulares. <Tag kind="sim" /></p>
        </section>
      )}

      {tab === 'pbp' && (
        <section>
          {!data.pbp ? (
            <p className="muted">El relato jugada a jugada se guarda solo en los partidos de tu equipo.</p>
          ) : (
            <>
              <label className="row"><input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} /> Mostrar cambios</label>
              <ul className="pbp">
                {pbpRows.map(({ i, e, score }) => {
                  if (e[0] === EV.START) return <li key={i} className="q">{quarterLabel(e[1]!)}</li>;
                  if (e[0] === EV.END) return <li key={i} className="q muted">Final del {e[1]! <= 4 ? `${e[1]}º cuarto` : 'tiempo extra'} · {score}</li>;
                  if (e[0] === EV.SUB && !subs) return null;
                  const scoring = e[0] === EV.MADE || e[0] === EV.FT_MADE;
                  return (
                    <li key={i} className={`${e[3] === 0 ? 'h' : 'a'} ${scoring ? 'sc' : ''}`}>
                      <span className="t">{clock(e[2]!)}</span>
                      <span className="who">{e[3] === 0 ? g.home_short : g.away_short}</span>
                      <span className="tx">{pbpText(e, data.names)}</span>
                      {scoring && <span className="s">{score}</span>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {tab === 'shots' && (
        <section>
          {(() => {
            const ids = new Set(data.players.filter((p) => p.club_id === clubs[side]).map((p) => p.id));
            const nm = new Map(data.players.map((p) => [p.id, p.name]));
            const s = data.shots.filter((x) => ids.has(x.player));
            const made = s.filter((x) => x.made).length;
            return (
              <>
                <DotMap shots={s.map((x) => ({ x: x.x, y: x.y, made: x.made, label: `${nm.get(x.player)}: ${x.made ? 'anotado' : 'fallado'} (${ZONES[x.zone]!.name})` }))} color={side === 0 ? 'var(--accent)' : 'var(--accent2)'} />
                <p className="muted">{names[side]}: {made}/{s.length} en tiros de campo. Relleno = anotado; hueco = fallado.</p>
              </>
            );
          })()}
        </section>
      )}

      {tab === 'team' && (
        <section>
          <div className="tbl">
            <table>
              <thead><tr><th className="l"></th><th>{g.home_short}</th><th>{g.away_short}</th></tr></thead>
              <tbody>
                {(() => {
                  const [a, b] = clubs.map((c) => teamLine(c!));
                  const row = (label: string, f: (x: typeof a) => string) => (<tr key={label}><td className="l">{label}</td><td>{f(a!)}</td><td>{f(b!)}</td></tr>);
                  const eFG = (x: typeof a) => pc((fgm(x!.line) + 0.5 * x!.line.fgm3) / fga(x!.line));
                  return [
                    row('Posesiones', (x) => f0(x!.poss)),
                    row('Puntos por 100 posesiones', (x) => f1((100 * x!.line.pts) / x!.poss)),
                    row('eFG%', eFG),
                    row('Pérdidas por 100 posesiones', (x) => f1((100 * x!.line.tov) / x!.poss)),
                    row('Rebote ofensivo %', (x) => { const o = x === a ? b! : a!; return pc(x!.line.orb / (x!.line.orb + o.line.drb)); }),
                    row('Tiros libres / tiros de campo', (x) => f2(x!.line.ftm / fga(x!.line))),
                    row('Asistencias', (x) => f0(x!.line.ast)),
                    row('Rebotes', (x) => f0(reb(x!.line))),
                    row('Robos', (x) => f0(x!.line.stl)),
                    row('Tapones', (x) => f0(x!.line.blk)),
                    row('Faltas', (x) => f0(x!.line.pf)),
                  ];
                })()}
              </tbody>
            </table>
          </div>
          <p className="muted small">Los cuatro factores de Dean Oliver: eFG%, pérdidas, rebote ofensivo y tiros libres.</p>
        </section>
      )}
    </div>
  );
}

/* ───────────────────────────── Liga ───────────────────────────── */

type TableRow = ReturnType<typeof Q.leagueTable>[number];
type LTab = 'table' | 'leaders' | 'teams' | 'po' | 'hist';
const LEADER_CATS: { key: string; label: string; value: (l: Q.PlayerLine) => number | null; fmt: (x: number | null) => string; min?: (l: Q.PlayerLine) => boolean }[] = [
  { key: 'pts', label: 'Puntos', value: (l) => l.pts / l.gp, fmt: f1 },
  { key: 'reb', label: 'Rebotes', value: (l) => reb(l) / l.gp, fmt: f1 },
  { key: 'ast', label: 'Asistencias', value: (l) => l.ast / l.gp, fmt: f1 },
  { key: 'stl', label: 'Robos', value: (l) => l.stl / l.gp, fmt: f1 },
  { key: 'blk', label: 'Tapones', value: (l) => l.blk / l.gp, fmt: f1 },
  { key: 'pir', label: 'Valoración', value: (l) => l.pir / l.gp, fmt: f1 },
  { key: 'ws', label: 'Win Shares', value: (l) => l.ws, fmt: f1 },
  { key: 'ws40', label: 'WS por 40 min', value: (l) => l.ws40, fmt: f2, min: (l) => l.sec >= 60 * 200 },
  { key: 'ts', label: 'TS%', value: (l) => l.ts, fmt: pc, min: (l) => fga(l) >= l.gp * 4 },
  { key: 't3', label: 'Triples %', value: (l) => (l.fga3 ? l.fgm3 / l.fga3 : null), fmt: pc, min: (l) => l.fga3 >= l.gp * 1.5 },
  { key: 'ft', label: 'Tiros libres %', value: (l) => (l.fta ? l.ftm / l.fta : null), fmt: pc, min: (l) => l.fta >= l.gp * 1.5 },
  { key: 'usg', label: 'USG%', value: (l) => l.usg, fmt: pcRaw },
];

export function LeagueScreen({ nav, myClub }: { nav: Nav; myClub: number }) {
  const [comp, setComp] = useState(1);
  const [tab, setTab] = useState<LTab>('table');
  return (
    <div>
      <Tabs<string> value={String(comp)} onChange={(v) => setComp(Number(v))} options={[['1', 'Liga ACB'], ['2', 'Primera FEB']]} />
      <Tabs<LTab> small value={tab} onChange={setTab} options={[['table', 'Clasificación'], ['leaders', 'Líderes'], ['teams', 'Equipos'], ['po', 'Playoffs'], ['hist', 'Historial']]} />
      {tab === 'table' && <Standings comp={comp} nav={nav} myClub={myClub} adv={false} />}
      {tab === 'teams' && <Standings comp={comp} nav={nav} myClub={myClub} adv />}
      {tab === 'leaders' && <Leaders comp={comp} nav={nav} myClub={myClub} />}
      {tab === 'po' && <Playoffs comp={comp} nav={nav} />}
      {tab === 'hist' && <History />}
    </div>
  );
}

function Standings({ comp, nav, myClub, adv }: { comp: number; nav: Nav; myClub: number; adv: boolean }) {
  const { data, error } = useData<TableRow[]>('table', { comp }, [comp]);
  if (!data) return <Loading error={error} />;
  const n = data.length;
  const cols: Col<TableRow>[] = adv
    ? [
        { key: 'club', label: 'Club', left: true, value: (r) => r.name },
        { key: 'o', label: 'ORtg', title: 'Puntos anotados por 100 posesiones', value: (r) => r.ortg, render: (r) => f1(r.ortg) },
        { key: 'd', label: 'DRtg', title: 'Puntos recibidos por 100 posesiones', value: (r) => r.drtg, render: (r) => f1(r.drtg) },
        { key: 'n', label: 'Net', value: (r) => (r.ortg ?? 0) - (r.drtg ?? 0), render: (r) => f1((r.ortg ?? 0) - (r.drtg ?? 0)) },
        { key: 'p', label: 'Ritmo', title: 'Posesiones por 40 minutos', value: (r) => r.pace, render: (r) => f1(r.pace) },
        { key: 'efg', label: 'eFG%', value: (r) => r.ff?.efg ?? null, render: (r) => pc(r.ff?.efg) },
        { key: 'tov', label: 'PÉR%', value: (r) => r.ff?.tov ?? null, render: (r) => pc(r.ff?.tov) },
        { key: 'orb', label: 'RO%', value: (r) => r.ff?.orb ?? null, render: (r) => pc(r.ff?.orb) },
        { key: 'ftr', label: 'TL/TC', value: (r) => r.ff?.ftr ?? null, render: (r) => f2(r.ff?.ftr) },
      ]
    : [
        { key: 'pos', label: '#', left: true, value: (r) => data.indexOf(r) + 1, render: (r) => { const i = data.indexOf(r) + 1; return <span className={comp === 1 && i <= 8 ? 'po' : (comp === 1 && i === n) || (comp === 2 && i === 1) ? 'mv' : ''}>{i}</span>; } },
        { key: 'club', label: 'Club', left: true, value: (r) => r.name },
        { key: 'gp', label: 'PJ', value: (r) => r.gp },
        { key: 'w', label: 'G', value: (r) => r.w },
        { key: 'l', label: 'P', value: (r) => r.l },
        { key: 'pf', label: 'PF', value: (r) => r.pf },
        { key: 'pa', label: 'PC', value: (r) => r.pa },
        { key: 'd', label: 'Dif.', value: (r) => r.pf - r.pa, render: (r) => signed(r.pf - r.pa) },
      ];
  return (
    <section>
      <Table cols={cols} rows={data} rowKey={(r) => r.club_id} highlight={(r) => r.club_id === myClub} onRow={(r) => nav.club(r.club_id)} defaultSort={adv ? { key: 'n', desc: true } : null} />
      {!adv && <p className="muted small">{comp === 1 ? 'Los 8 primeros juegan los playoffs; el último desciende.' : 'El primero asciende a la Liga ACB.'}</p>}
      {adv && <p className="muted small">Fase regular. Posesiones exactas contadas por el motor.</p>}
    </section>
  );
}

function Leaders({ comp, nav, myClub }: { comp: number; nav: Nav; myClub: number }) {
  const [stage, setStage] = useState<'regular' | 'playoffs'>('regular');
  const [cat, setCat] = useState('pts');
  const { data, error } = useData<Q.PlayerLine[]>('leaders', { comp, stage }, [comp, stage]);
  if (!data) return <Loading error={error} />;
  const c = LEADER_CATS.find((x) => x.key === cat)!;
  const maxGp = Math.max(1, ...data.map((l) => l.gp));
  const rows = data
    .filter((l) => l.gp >= Math.ceil(maxGp * 0.4) && (c.min ? c.min(l) : true) && c.value(l) !== null)
    .sort((a, b) => (c.value(b) ?? 0) - (c.value(a) ?? 0))
    .slice(0, 20);
  return (
    <section>
      <div className="row">
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          {LEADER_CATS.map((x) => (<option key={x.key} value={x.key}>{x.label}</option>))}
        </select>
        {comp === 1 && <Tabs<'regular' | 'playoffs'> small value={stage} onChange={setStage} options={[['regular', 'Regular'], ['playoffs', 'Playoffs']]} />}
      </div>
      <ol className="leaders">
        {rows.map((l) => (
          <li key={`${l.id}-${l.club_id}`} className={`tap ${l.club_id === myClub ? 'me' : ''}`} onClick={() => nav.player(l.id)}>
            <span>{l.name} <span className="muted">{l.club} · {l.pos1}</span></span>
            <b>{c.fmt(c.value(l))}</b>
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="muted">Todavía no hay suficientes partidos.</p>}
      <p className="muted small">Mínimo: 40 % de los partidos{c.min ? ' y un volumen mínimo de tiros o minutos' : ''}.</p>
    </section>
  );
}

function Playoffs({ comp, nav }: { comp: number; nav: Nav }) {
  const { data, error } = useData<ReturnType<typeof Q.playoffs>>('playoffs', { comp }, [comp]);
  if (comp !== 1) return <p className="muted">La Primera FEB no tiene playoffs en esta versión: el primero asciende directamente.</p>;
  if (!data) return <Loading error={error} />;
  if (!data.length) return <p className="muted">Los playoffs empiezan al terminar la fase regular: 1º-8º, 4º-5º, 2º-7º y 3º-6º.</p>;
  const rounds = [1, 2, 3].filter((r) => data.some((s) => s.round === r));
  const label = { 1: 'Cuartos (al mejor de 3)', 2: 'Semifinales (al mejor de 5)', 3: 'Final (al mejor de 5)' } as Record<number, string>;
  return (
    <section>
      {rounds.map((r) => (
        <div key={r}>
          <h3>{label[r]}</h3>
          <ul className="plain series">
            {data.filter((s) => s.round === r).map((s) => (
              <li key={s.id}>
                <span className={s.winner_id === s.high_id ? 'win tap' : 'tap'} onClick={() => nav.club(s.high_id)}>{s.high_seed}. {s.high}</span>
                <b>{s.high_wins}-{s.low_wins}</b>
                <span className={s.winner_id === s.low_id ? 'win tap' : 'tap'} onClick={() => nav.club(s.low_id)}>{s.low_seed}. {s.low}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function History() {
  const { data, error } = useData<ReturnType<typeof Q.history>>('history', null, []);
  if (!data) return <Loading error={error} />;
  if (!data.length) return <p className="muted">El historial se llena al terminar cada temporada.</p>;
  return (
    <section>
      <Table
        cols={[
          { key: 's', label: 'Temp.', left: true, value: (r) => r.season, render: (r) => seasonLabel(r.season) },
          { key: 'c', label: 'Competición', left: true, value: (r) => r.competition },
          { key: 'ch', label: 'Campeón', left: true, value: (r) => r.champion ?? '—' },
          { key: 'ru', label: 'Subcampeón', left: true, value: (r) => r.runner_up ?? '—' },
          { key: 'f', label: '1º regular', left: true, value: (r) => r.first ?? '—' },
        ]}
        rows={data}
        rowKey={(r) => `${r.season}-${r.competition}`}
      />
    </section>
  );
}
