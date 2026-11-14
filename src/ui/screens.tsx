/** Pantallas del juego: inicio, plantilla, ficha de jugador, partidos, hoja de partido y liga. */
import React, { useEffect, useMemo, useState } from 'react';
import { CareerView, type CareerRow } from './career';
import { UnitsView } from './units';
import { SeasonSummary } from './summary';
import { PO_SIZE } from '../core/leagues';
import { RequestPanel } from './inbox';
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
import { ContractCard, FinanceScreen, MarketBanner, MoneyBar, NewsList, eur } from './market';
import type { Level, Role, Tactics } from '../core/engine';
import { Face, parseColors } from './Face';
import { AwardsView, ClubHistory, PlayerCompare, RecordsView } from './history';
import { IndividualTraining, TrainingScreen, YouthScreen } from './club';
import { BoardCard, InboxPanel } from './inbox';
import { AnalysisView, EvolutionView } from './analysis';
import { TacticsEditor, TendencyEditor } from './tactics';
import { PreviewView } from './preview';
import { Back, type Col, CupoSummary, CupoTag, Loading, type Nav, POS_ORDER, Table, Tabs, Tag, clock, posSort, shortName, useSticky, f0, f1, f2, mins, pc, pcRaw, seasonLabel, signed, useData, Toast } from './kit';

type HomeData = NonNullable<ReturnType<typeof Q.home>> & { club: NonNullable<ReturnType<typeof Q.home>>['club'] };
type GameRow = Q.GameListRow;

const per = (l: Line, k: keyof Line) => (l.gp ? (l[k] as number) / l.gp : null);
const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** «2026-10-03» → «3 oct» (o «sáb 3 oct»). */
export function fmtDate(iso: string, withDay = false): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${withDay ? `${DOW[d.getUTCDay()]} ` : ''}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
const STAGE_LABEL: Record<string, string> = { regular: 'Liga regular', playoffs: 'Playoffs', copa: 'Copa del Rey', grupos: 'Fase de grupos', eliminatoria: 'Eliminatoria' };
const stageLabel = (s: string) => STAGE_LABEL[s] ?? s;
const COMP_NAME: Record<number, string> = { 1: 'Liga ACB', 2: 'Primera FEB', 3: 'Copa del Rey', 4: 'EuroLeague', 5: 'EuroCup', 6: 'Basketball Champions League' };
const AWARD_NAME: Record<string, string> = { mvp: 'MVP', joven: 'Mejor joven', defensor: 'Mejor defensor', sexto: 'Sexto hombre', mejorado: 'Más mejorado', quinteto: 'Quinteto ideal', mvp_final: 'MVP de la final' };
const COMP_SHORT: Record<number, string> = { 1: 'ACB', 2: 'FEB', 3: 'Copa', 4: 'EL', 5: 'EC', 6: 'BCL' };
const roundLabel = (stage: string, day: number, round?: number | null) =>
  stage === 'regular' ? `J${round ?? day}` : stage === 'grupos' ? `J${round ?? Math.round(day / 2)}` : stage === 'playoffs' ? 'PO' : 'Elim.';
/** Etiqueta corta de un partido: competición (si no es la liga) y jornada. */
export function GameTag({ comp, stage, day, round }: { comp: number; stage: string; day: number; round?: number | null }) {
  return (
    <span className="muted">
      {comp >= 3 && <span className={`compbadge c${comp}`}>{COMP_SHORT[comp]}</span>}
      {roundLabel(stage, day, round)}
    </span>
  );
}

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
  const [showPrev, setShowPrev] = useSticky('home.preview', false);

  useEffect(() => {
    setProgressListener(setProgress);
    return () => setProgressListener(null);
  }, []);

  const go = async (mode: 'day' | 'mine' | 'week' | 'regular' | 'season') => {
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
        <div className="muted">{data.club.comp} · Temporada {seasonLabel(u.game_season)} · {u.phase === 'playoffs' ? 'Playoffs' : u.phase === 'fin' ? 'Temporada terminada' : u.game_day === 0 ? 'Pretemporada' : `Jornada ${data.round} de 34${data.today ? ` · ${fmtDate(data.today)}` : ''}`}</div>
        <h2 className="tap" onClick={() => nav.club(data.club!.id)}>{data.club.name}</h2>
        <div className="big">
          {me ? `${me.w}-${me.l}` : '0-0'} <span className="muted">· {data.position}º</span>
        </div>
      </section>

      {err && <p className="error">{err}</p>}
      {u.phase === 'fin' && <SeasonSummary nav={nav} />}
      <section className="nextmatch">
        <h3>Próximo partido</h3>
        {data.next ? (
          <p className="tap" onClick={() => nav.club(data.next!.home_id === data.club!.id ? data.next!.away_id : data.next!.home_id)}>
            <GameTag comp={data.next.competition_id} stage={data.next.stage} day={data.next.day} round={data.next.round} /> {stageLabel(data.next.stage)} · {data.nextDate ? fmtDate(data.nextDate, true) : `día ${data.next.day}`} · {data.next.home_id === data.club.id ? `contra ${data.next.away} (en casa)` : `en la pista de ${data.next.home}`}
          </p>
        ) : (
          <p className="muted">{u.phase === 'fin' ? 'La temporada ha terminado.' : u.phase === 'playoffs' ? 'Tu equipo no juega estos playoffs. Puedes seguir simulando.' : 'Sin partidos pendientes.'}</p>
        )}
        {playing && (
          <div className="row">
            {data.next && data.nextDay === data.next.day && <button disabled={!!busy} onClick={nav.live}>▶ Jugar en directo</button>}
            {data.next && <button className="sec" onClick={() => setShowPrev(!showPrev)}>{showPrev ? 'Ocultar previa' : 'Previa'}</button>}
            {data.next && data.nextDay === data.next.day
              ? <button className="sec" disabled={!!busy} onClick={() => go('day')}>Simular partido</button>
              : <>
                  {data.next && <button disabled={!!busy} onClick={() => go('mine')}>Hasta mi partido</button>}
                  <button className={data.next ? 'sec' : ''} disabled={!!busy || data.nextDay === null && u.phase !== 'regular'} onClick={() => go('day')}>Siguiente día</button>
                </>}
            <button className="sec" disabled={!!busy} onClick={() => go('week')}>5 jornadas</button>
            {u.phase === 'regular' && <button className="sec" disabled={!!busy} onClick={() => go('regular')}>Hasta los playoffs</button>}
            <button className="sec" disabled={!!busy} onClick={() => go('season')}>Hasta el final</button>
          </div>
        )}
        {showPrev && data.next && <PreviewView gameId={data.next.id} nav={nav} />}
        {u.phase === 'fin' && (
          <div className="row">
            <button disabled={!!busy} onClick={newSeason}>Empezar temporada {seasonLabel(u.game_season + 1)}</button>
          </div>
        )}
        {u.phase === 'fin' && (
          <p className="muted small">Antes de empezar, renueva en Equipo › Finanzas a quien quieras conservar: los contratos que terminan quedan libres. Puedes fichar agentes libres en Jugadores.</p>
        )}
        {busy && (
          <div className="row">
            <span className="live">
              Simulando… {progress ? (progress.stage === 'playoffs' ? `playoffs, día ${progress.day}` : `jornada ${progress.day}`) : ''}
              {progress?.record && <b> · {progress.record}</b>}
              {progress?.last && <span className="muted"> · {progress.last}</span>}
            </span>
            <button className="sec" onClick={cancelLoad}>Detener</button>
          </div>
        )}
        {data.result.length > 0 && (
          <ul className="plain">
            {data.result.map((r) => (
              <li key={r.competition_id}>{COMP_NAME[r.competition_id] ?? ''}: {r.champion ? <b>campeón {r.champion}</b> : <>líder de la fase regular {r.first}</>}</li>
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
                {g.comp >= 3 && <span className={`compbadge c${g.comp}`}>{COMP_SHORT[g.comp]}</span>}{g.home} <b>{g.homePts}-{g.awayPts}</b> {g.away} ›
              </li>
            ))}
            {events.map((e, i) => (
              <li key={`e${i}`}>{e}</li>
            ))}
          </ul>
        </section>
      )}

      <MoneyBar clubId={data.club.id} />
      <InboxPanel clubId={data.club.id} nav={nav} />
      <MarketBanner nav={nav} />

      <section>
        <h3>Últimos resultados</h3>
        {data.last.length === 0 ? <p className="muted">Aún no se ha jugado ningún partido.</p> : (
          <ul className="plain">
            {data.last.map((g) => (
              <li key={g.id} className="tap" onClick={() => nav.game(g.id)}>
                <GameTag comp={g.competition_id} stage={g.stage} day={g.day} round={g.round} /> <Result g={g} clubId={data.club!.id} /> ›
              </li>
            ))}
          </ul>
        )}
      </section>

      <BoardCard clubId={data.club.id} />
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
  type V = 'plantilla' | 'quinteto' | 'quintetos' | 'tacticas' | 'entreno' | 'cantera' | 'finanzas' | 'historia';
  const [view, setView] = useSticky<V>('squad.view', 'plantilla');
  if (isMine && !onBack) {
    return (
      <div>
        <Tabs<V> value={view} onChange={setView} options={[['plantilla', 'Plantilla'], ['quinteto', 'Quinteto'], ['quintetos', 'Quintetos +/-'], ['tacticas', 'Tácticas'], ['entreno', 'Entreno'], ['cantera', 'Cantera'], ['finanzas', 'Finanzas'], ['historia', 'Historia']]} />
        {view === 'plantilla' ? <SquadTable clubId={clubId} nav={nav} /> : view === 'quinteto' ? <LineupEditor clubId={clubId} nav={nav} /> : view === 'quintetos' ? <UnitsView clubId={clubId} nav={nav} /> : view === 'tacticas' ? <TacticsEditor clubId={clubId} /> : view === 'entreno' ? <><TrainingScreen clubId={clubId} /><IndividualTraining clubId={clubId} nav={nav} /></> : view === 'cantera' ? <YouthScreen clubId={clubId} nav={nav} /> : view === 'historia' ? <ClubHistory clubId={clubId} nav={nav} /> : <FinanceScreen clubId={clubId} nav={nav} />}
      </div>
    );
  }
  return <OtherClub clubId={clubId} nav={nav} onBack={onBack} />;
}

function OtherClub({ clubId, nav, onBack }: { clubId: number; nav: Nav; onBack?: () => void }) {
  const [view, setView] = useSticky<'plantilla' | 'historia'>('club.view', 'plantilla');
  return (
    <div>
      {view === 'historia' && onBack && <Back onBack={onBack} />}
      {view === 'plantilla' ? <SquadTable clubId={clubId} nav={nav} onBack={onBack} tabs={<Tabs<'plantilla' | 'historia'> small value={view} onChange={setView} options={[['plantilla', 'Plantilla'], ['historia', 'Historia']]} />} /> : (
        <>
          <Tabs<'plantilla' | 'historia'> small value={view} onChange={setView} options={[['plantilla', 'Plantilla'], ['historia', 'Historia']]} />
          <ClubHistory clubId={clubId} nav={nav} />
        </>
      )}
    </div>
  );
}

function SquadTable({ clubId, nav, onBack, tabs }: { clubId: number; nav: Nav; onBack?: () => void; tabs?: React.ReactNode }) {
  const { data, error } = useData<SquadData>('squad', { clubId }, [clubId]);
  const [group, setGroup] = useSticky<Group>('squad.group', 'basic');
  if (!data) return <Loading error={error} />;
  const L = (r: SquadRow) => r.line;
  const pg = (k: keyof Line) => (r: SquadRow) => (L(r) ? per(L(r)!, k) : null);
  const spanish = data.club.country === 'ES';
  const base: Col<SquadRow>[] = [{
    key: 'name', label: 'Jugador', left: true, value: (r) => r.name,
    render: (r) => (
      <span className="pname">
        {r.origin !== 'real' && <Face id={r.id} nationality={r.nationality} age={r.age} colors={data.club.colors} size={22} />}
        <span><span className="num">{r.number ?? ''}</span> {spanish && <CupoTag nationality={r.nationality} />} {shortName(r.name)}{r.injury_games > 0 && <span className="bad" title={r.injury ?? ''}> ✚</span>}{r.wants_out ? <span title="Pide salir"> 😠</span> : r.listed ? <span title="Transferible"> 📋</span> : null}</span>
      </span>
    ),
  },
  { key: 'pos', label: 'Pos.', value: (r) => posSort(r.pos1, r.pos2), render: (r) => `${r.pos1}${r.pos2 ? `/${r.pos2}` : ''}` },
  { key: 'ovr', label: 'Media', title: 'Media en su posición', value: (r) => r.ovr, render: (r) => <b className={`ovr ${ovrClass(r.ovr)}`}>{r.ovr}</b> },
  ];
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
      { key: 't2p', label: 'T2%', value: (r) => (L(r)?.fga2 ? L(r)!.fgm2 / L(r)!.fga2 : null), render: (r) => pc(L(r)?.fga2 ? L(r)!.fgm2 / L(r)!.fga2 : null) },
      { key: 't3', label: 'T3', value: (r) => L(r)?.fga3 ?? 0, render: (r) => (L(r) ? `${L(r)!.fgm3}/${L(r)!.fga3}` : '—') },
      { key: 't3p', label: 'T3%', value: (r) => (L(r)?.fga3 ? L(r)!.fgm3 / L(r)!.fga3 : null), render: (r) => pc(L(r)?.fga3 ? L(r)!.fgm3 / L(r)!.fga3 : null) },
      { key: 't1', label: 'T1', value: (r) => L(r)?.fta ?? 0, render: (r) => (L(r) ? `${L(r)!.ftm}/${L(r)!.fta}` : '—') },
      { key: 'ftp', label: 'T1%', value: (r) => (L(r)?.fta ? L(r)!.ftm / L(r)!.fta : null), render: (r) => pc(L(r)?.fta ? L(r)!.ftm / L(r)!.fta : null) },
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
      { key: 'va', label: 'VA', title: 'Victorias añadidas sobre un jugador de reemplazo', value: (r) => L(r)?.va ?? null, render: (r) => f1(L(r)?.va) },
      { key: 'pm', label: '+/-', value: (r) => L(r)?.pm ?? null, render: (r) => (L(r) ? signed(L(r)!.pm) : '—') },
    ],
    bio: [
      { key: 'age', label: 'Edad', value: (r) => r.age },
      { key: 'h', label: 'Altura', value: (r) => r.height_cm, render: (r) => `${(r.height_cm / 100).toFixed(2).replace('.', ',')}` },
      { key: 'pot', label: 'Pot.', title: 'Potencial estimado por tus ojeadores', value: (r) => r.potential_est },
      { key: 'mor', label: 'Moral', value: (r) => r.morale, render: (r) => <span className={r.morale >= 60 ? 'good' : r.morale < 40 ? 'bad' : ''}>{r.morale}</span> },
      { key: 'sal', label: 'Sueldo', value: (r) => r.salary ?? 0, render: (r) => eur(r.salary) },
      { key: 'until', label: 'Hasta', value: (r) => r.until ?? 0, render: (r) => (r.until ? seasonLabel(r.until) : '—') },
      { key: 'inj', label: 'Estado', value: (r) => r.injury_games, render: (r) => (r.injury_games ? <span className="bad">✚ {r.injury} ({r.injury_games})</span> : 'Disponible') },
      { key: 'nat', label: 'Nac.', value: (r) => r.nationality, render: (r) => <CupoTag nationality={r.nationality} full /> },
    ],
  };
  return (
    <div>
      {onBack && <Back onBack={onBack} />}
      <section className="hero">
        <ClubBand colors={data.club.colors} />
        <div className="muted">{data.club.comp} · {seasonLabel(data.season)}</div>
        <h2>{data.club.name}</h2>
        {spanish && <CupoSummary cupo={data.cupo} />}
      </section>
      {tabs}
      <Tabs<Group> small value={group} onChange={setGroup} options={[['basic', 'Básicas'], ['shoot', 'Tiro'], ['adv', 'Avanzadas'], ['bio', 'Ficha']]} />
      <Table id={`squad-${group}`} cols={[...base, ...groups[group]]} rows={data.players} rowKey={(r) => r.id} onRow={(r) => nav.player(r.id)} defaultSort={group === 'bio' ? { key: 'ovr', desc: true } : null} />
      <p className="muted">Por partido, fase regular. <Tag kind="sim" /> Toca un jugador para ver su ficha.</p>
      {group === 'adv' && <Glossary />}
    </div>
  );
}

export function ClubBand({ colors }: { colors: string | null | undefined }) {
  const c = parseColors(colors);
  return <div className="club-band" style={{ background: `linear-gradient(90deg, ${c[0]} 0 55%, ${c[1]} 55% 80%, ${c[2]} 80%)` }} />;
}

/* ───────────────────────────── Ficha de jugador ───────────────────────────── */

function WatchButton({ id, watched, onDone }: { id: number; watched: boolean; onDone: () => void }) {
  return (
    <button className={`sec small-btn ${watched ? 'on' : ''}`} onClick={async () => { await call('watch', { id, on: !watched }); onDone(); }}>
      {watched ? '★ En seguimiento' : '☆ Seguir'}
    </button>
  );
}

function PositionEditor({ id, pos1, pos2, posOvr, onDone }: { id: number; pos1: Pos; pos2: Pos | null; posOvr: { pos: Pos; ovr: number }[]; onDone: () => void }) {
  const [a, setA] = useState<Pos>(pos1);
  const [b, setB] = useState<Pos | ''>(pos2 ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const best = [...posOvr].sort((x, y) => y.ovr - x.ovr)[0]!;
  return (
    <div className="card">
      <b>Cambiar de posición</b>
      <p className="muted small">Su media pasa a ser la del puesto principal. Jugar en su puesto principal o secundario no penaliza; a un puesto de distancia, −3; a dos, −9.{best.pos !== pos1 ? ` Rinde más de ${best.pos} (${best.ovr}).` : ''}</p>
      <div className="row">
        <select value={a} onChange={(e) => setA(e.target.value as Pos)} aria-label="Posición principal">{['PG', 'SG', 'SF', 'PF', 'C'].map((x) => <option key={x} value={x}>Principal: {x}</option>)}</select>
        <select value={b} onChange={(e) => setB(e.target.value as Pos | '')} aria-label="Posición secundaria"><option value="">Sin secundaria</option>{['PG', 'SG', 'SF', 'PF', 'C'].filter((x) => x !== a).map((x) => <option key={x} value={x}>Secundaria: {x}</option>)}</select>
        <button className="sec" disabled={a === pos1 && (b || null) === pos2} onClick={async () => {
          const r = await call<{ message: string }>('setPositions', { id, pos1: a, pos2: b || null });
          setMsg(r.message);
          onDone();
        }}>Cambiar</button>
      </div>
      <Toast text={msg} />
    </div>
  );
}

type PlayerData = ReturnType<typeof Q.playerDetail>;
type PTab = 'res' | 'attr' | 'tend' | 'ana' | 'evo' | 'stats' | 'log' | 'map' | 'cmp' | 'real';

export function ovrClass(v: number) {
  return v >= 75 ? 'o4' : v >= 68 ? 'o3' : v >= 60 ? 'o2' : v >= 50 ? 'o1' : 'o0';
}
function attrClass(v: number) {
  return v >= 80 ? 'a4' : v >= 65 ? 'a3' : v >= 50 ? 'a2' : v >= 35 ? 'a1' : 'a0';
}

export function PlayerScreen({ id, nav, myClub, onChanged }: { id: number; nav: Nav; myClub: number; onChanged: () => void }) {
  const { data, error, reload } = useData<PlayerData>('player', { id }, [id]);
  const [tab, setTab] = useSticky<PTab>(`player.tab.${id}`, 'res');
  if (!data) return <Loading error={error} />;
  const p = data.player as Record<string, string | number | null>;
  const cur = data.career.filter((c) => c.season === data.season);
  const reg = cur.find((c) => c.stage === 'regular')?.line;
  return (
    <div>
      <Back onBack={nav.back} />
      <section className="hero">
        <ClubBand colors={(p.club_colors as string | null) ?? null} />
        <div className="phead">
          {p.origin !== 'real' && <Face id={id} nationality={String(p.nationality)} age={data.age} colors={(p.club_colors as string | null) ?? null} size={64} />}
          <div>
            <div className="muted tap" onClick={() => p.club_id && nav.club(Number(p.club_id))}>
              {p.number !== null ? `#${p.number} · ` : ''}{p.club ?? (p.youth_club ? `Cantera · ${p.youth_club}` : 'Sin club')} · {POS_LABEL[p.pos1 as Pos]}{p.pos2 ? ` / ${POS_LABEL[p.pos2 as Pos]}` : ''}
            </div>
            <h2>{p.name}</h2>
            <div className="keyline">
              <b className="kpos">{String(p.pos1)}{p.pos2 ? `/${p.pos2}` : ''}</b>
              <b className={`ovr big ${ovrClass(data.ovr)}`}>{data.ovr}</b>
              <span className="muted small">{data.prevOvr !== null && data.ovr !== data.prevOvr ? `${signed(data.ovr - data.prevOvr)} · ` : ''}pot. {String(p.potential_est)} · {data.age} años</span>
            </div>
            <div className="archs">{data.archetypes.map((a) => <span key={a.key} title={a.hint}>{a.label}</span>)}</div>
            {!data.mine && <WatchButton id={id} watched={data.watched} onDone={reload} />}
          </div>
        </div>
        <div className="chips">
          <span>{(Number(p.height_cm) / 100).toFixed(2).replace('.', ',')} m</span>
          <span>{p.weight_kg} kg</span>
          <span>Env. {(Number(p.wingspan_cm) / 100).toFixed(2).replace('.', ',')} m</span>
          <span><CupoTag nationality={String(p.nationality)} full /></span>
          <span>{p.hand === 'L' ? 'Zurdo' : 'Diestro'}</span>
        </div>
        {p.mood_note && <p className="small" style={{ margin: '6px 0 0' }}>Moral {String(p.morale)} · <span className="muted">{String(p.mood_note)}</span>{Number(p.fatigue) > 0.25 && <span className="warn"> · cansado ({Math.round(Number(p.fatigue) * 100)} %)</span>}</p>}
        {data.mine && (Number(p.wants_out) > 0 || Number(p.listed) > 0 || data.promise) && <RequestPanel id={id} wantsOut={Number(p.wants_out) > 0} listed={Number(p.listed) > 0} promise={data.promise} onDone={reload} />}
        {p.origin === 'real'
          ? <p className="muted small">Jugador real <Tag kind="real" /> · atributos, edad y altura <Tag kind="est" /> · estadísticas del juego <Tag kind="sim" /></p>
          : <p className="muted small">Jugador generado <Tag kind="est" /> · estadísticas <Tag kind="sim" /></p>}
      </section>
      <Tabs<PTab> small value={tab} onChange={setTab} options={[['res', 'Resumen'], ['attr', 'Atributos'], ['tend', 'Tendencias'], ['ana', 'Análisis'], ['evo', 'Evolución'], ['stats', 'Estadísticas'], ['log', 'Partidos'], ['map', 'Mapa de tiro'], ['cmp', 'Comparar'], ...(p.origin === 'real' ? [['real', 'Datos reales'] as [PTab, string]] : [])]} />

      {tab === 'res' && (
        <section>
          <h3>Temporada {seasonLabel(data.season)}</h3>
          {reg ? (
            <div className="kpis">
              {[
                ['PTS', f1(reg.pts / reg.gp)], ['REB', f1(reb(reg) / reg.gp)], ['AST', f1(reg.ast / reg.gp)], ['MIN', mins(reg.sec, reg.gp)],
                ['T2%', pc(reg.fga2 ? reg.fgm2 / reg.fga2 : null)], ['T3%', pc(reg.fga3 ? reg.fgm3 / reg.fga3 : null)], ['T1%', pc(reg.fta ? reg.ftm / reg.fta : null)], ['TS%', pc(reg.ts)],
                ['VAL', f1(reg.pir / reg.gp)], ['USG%', pcRaw(reg.usg)], ['WS', f1(reg.ws)], ['VA', f1(reg.va)],
              ].map(([k, v]) => (
                <div key={k}><div className="kv">{v}</div><div className="kk">{k}</div></div>
              ))}
            </div>
          ) : <p className="muted">Todavía no ha jugado esta temporada.</p>}
          <ContractCard id={id} myClub={myClub} injury={(p.injury as string | null) ?? null} onChanged={() => { reload(); onChanged(); }} />
          <h3>Tendencias de tiro</h3>
          <Tendencies natural={data.tendencies.natural} real={data.tendencies.real} shots={data.tendencies.shots} />
          {data.awards.length > 0 && (
            <>
              <h3>Palmarés individual</h3>
              <ul className="plain">
                {data.awards.map((a, i) => (
                  <li key={i}>{a.rank === 1 || a.award === 'quinteto' || a.award === 'mvp_final' ? '🏅 ' : ''}{AWARD_NAME[a.award] ?? a.award}{a.award !== 'quinteto' && a.award !== 'mvp_final' && a.rank > 1 ? ` (${a.rank}º)` : ''} · {COMP_SHORT[a.competition_id]} {seasonLabel(a.season)}</li>
                ))}
              </ul>
            </>
          )}
          <h3>Media en cada posición</h3>
          <div className="chips">
            {data.posOvr.map((x) => (
              <span key={x.pos} className={x.pos === p.pos1 ? 'on' : ''}>{x.pos} {x.ovr}</span>
            ))}
          </div>
          <p className="muted small">La media resume al jugador para su posición; los partidos los deciden los atributos concretos.</p>
          {data.mine && <PositionEditor id={id} pos1={p.pos1 as Pos} pos2={(p.pos2 as Pos | null) ?? null} posOvr={data.posOvr} onDone={() => { reload(); onChanged(); }} />}
        </section>
      )}

      {tab === 'tend' && <TendencyEditor id={id} attrs={data.attrs} />}
      {tab === 'ana' && <AnalysisView id={id} season={data.season} />}
      {tab === 'evo' && <EvolutionView id={id} />}
      {tab === 'cmp' && <PlayerCompare a={data} myClub={myClub} nav={nav} />}

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
        <CareerView career={data.career as CareerRow[]} moves={data.moves} youthClub={(p.youth_club as string | null) ?? null} currentClub={(p.club as string | null) ?? null} season={data.season} nav={nav} />
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
              { key: 'tl', label: 'T1', value: (r) => r.line.fta, render: (r) => `${r.line.ftm}/${r.line.fta}` },
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

      {tab === 'real' && <RealData id={id} />}
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
  const [mode, setMode] = useSticky<'mine' | 'cal' | 'days'>('games.mode', 'mine');
  return (
    <div>
      <Tabs<'mine' | 'cal' | 'days'> value={mode} onChange={setMode} options={[['mine', 'Mis partidos'], ['cal', 'Calendario'], ['days', 'Jornadas']]} />
      {mode === 'mine' ? <MySchedule clubId={clubId} nav={nav} /> : mode === 'cal' ? <MonthCalendar clubId={clubId} nav={nav} /> : <Rounds nav={nav} clubId={clubId} />}
    </div>
  );
}

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Calendario mensual de tu club: todas las competiciones, con resultado y color por competición. */
function MonthCalendar({ clubId, nav }: { clubId: number; nav: Nav }) {
  const { data, error } = useData<(GameRow & { date: string | null })[]>('schedule', { clubId }, [clubId]);
  const months = useMemo(() => [...new Set((data ?? []).filter((g) => g.date).map((g) => g.date!.slice(0, 7)))], [data]);
  const nextIdx = (data ?? []).findIndex((g) => g.status === 'pendiente');
  const defaultMonth = (nextIdx >= 0 ? data![nextIdx]!.date : data?.[data.length - 1]?.date)?.slice(0, 7) ?? months[0];
  const [month, setMonth] = useSticky<string | null>(`cal.month.${clubId}`, null);
  if (!data) return <Loading error={error} />;
  const m = month && months.includes(month) ? month : defaultMonth;
  if (!m) return <p className="muted">Sin partidos.</p>;
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // lunes primero
  const byDate = new Map<string, (GameRow & { date: string | null })[]>();
  for (const g of data) if (g.date) (byDate.get(g.date) ?? byDate.set(g.date, []).get(g.date)!).push(g);
  const idx = months.indexOf(m);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="sec" disabled={idx <= 0} onClick={() => setMonth(months[idx - 1]!)}>‹</button>
        <b style={{ textTransform: 'capitalize' }}>{MONTH_NAMES[mo - 1]} {y}</b>
        <button className="sec" disabled={idx >= months.length - 1} onClick={() => setMonth(months[idx + 1]!)}>›</button>
      </div>
      <div className="calgrid">
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => <div key={d} className="calh">{d}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="calc empty" />;
          const iso = `${m}-${String(d).padStart(2, '0')}`;
          const gs = byDate.get(iso) ?? [];
          return (
            <div key={i} className={`calc ${gs.length ? 'has' : ''}`}>
              <span className="cd">{d}</span>
              {gs.map((g) => {
                const home = g.home_id === clubId;
                const mine = home ? g.home_pts : g.away_pts;
                const theirs = home ? g.away_pts : g.home_pts;
                const res = g.status === 'jugado' ? (mine! > theirs! ? 'G' : 'P') : null;
                return (
                  <div key={g.id} className={`calg c${g.competition_id} ${res === 'G' ? 'win' : res === 'P' ? 'loss' : ''}`} onClick={() => (g.status === 'jugado' ? nav.game(g.id) : nav.club(home ? g.away_id : g.home_id))}>
                    <span>{home ? '' : '@'}{home ? g.away_short : g.home_short}</span>
                    {res && <b>{res} {mine}-{theirs}</b>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="muted small">
        <span className="compbadge">Liga</span><span className="compbadge c3">Copa</span><span className="compbadge c4">EL</span><span className="compbadge c5">EC</span><span className="compbadge c6">BCL</span> · @ = fuera de casa · toca un partido jugado para ver la hoja, o uno pendiente para ver al rival.
      </p>
    </section>
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
            <GameTag comp={g.competition_id} stage={g.stage} day={g.day} round={g.round} />
            <span>{g.home_id === clubId ? 'vs' : 'en'} {g.home_id === clubId ? g.away : g.home}</span>
            <span>{g.status === 'jugado' ? <Result g={g} clubId={clubId} /> : <span className="muted">pendiente</span>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Rounds({ nav, clubId }: { nav: Nav; clubId: number }) {
  const [comp, setComp] = useSticky('rounds.comp', 1);
  const days = useData<{ day: number; stage: string; played: number; total: number; round: number | null; date: string | null }[]>('compDays', { comp }, [comp]);
  const [day, setDay] = useState<number | null>(null);
  const current = useMemo(() => {
    if (!days.data?.length) return null;
    const lastPlayed = [...days.data].reverse().find((d) => d.played > 0);
    return day ?? lastPlayed?.day ?? days.data[0]!.day;
  }, [days.data, day]);
  const games = useData<GameRow[]>('dayGames', { comp, day: current }, [comp, current]);
  const idx = days.data && current !== null ? days.data.findIndex((d) => d.day === current) : -1;
  return (
    <section>
      <Tabs<string> small value={String(comp)} onChange={(v) => { setComp(Number(v)); setDay(null); }} options={[['1', 'ACB'], ['2', 'FEB'], ['3', 'Copa'], ['4', 'EuroLeague'], ['5', 'EuroCup'], ['6', 'BCL']]} />
      {days.data && days.data.length === 0 && <p className="muted">{comp === 3 ? 'La Copa se juega en los días 18-20, tras la primera vuelta.' : 'Esta competición no tiene partidos esta temporada.'}</p>}
      {days.data && days.data.length > 0 && current !== null && (
        <div className="row">
          <button className="sec" disabled={idx <= 0} onClick={() => setDay(days.data![idx - 1]!.day)}>‹</button>
          <select value={current} onChange={(e) => setDay(Number(e.target.value))}>
            {days.data.map((d) => (<option key={d.day} value={d.day}>{d.round ? `Jornada ${d.round}` : stageLabel(d.stage)}{d.date ? ` · ${fmtDate(d.date, true)}` : ''}{d.played === d.total ? '' : ' (pendiente)'}</option>))}
          </select>
          <button className="sec" disabled={idx >= days.data.length - 1} onClick={() => setDay(days.data![idx + 1]!.day)}>›</button>
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

export function pbpText(e: number[], names: Record<number, string>): string {
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
    case EV.TIMEOUT: return 'Tiempo muerto';
    default: return '';
  }
}

export function GameScreen({ id, nav }: { id: number; nav: Nav }) {
  const { data, error } = useData<GameData>('game', { id }, [id]);
  const [tab, setTab] = useSticky<'box' | 'pbp' | 'shots' | 'team'>('game.tab', 'box');
  const [side, setSide] = useState<0 | 1>(0);
  const [subs, setSubs] = useState(false);
  if (!data) return <><Back onBack={nav.back} /><Loading error={error} /></>;
  const g = data.game;
  const clubs = [g.home_id, g.away_id];
  const names = [g.home, g.away];
  const teamLine = (c: number) => data.teams.find((t) => t.club_id === c)!;
  const boxCols: Col<BoxRow>[] = [
    { key: 'n', label: 'Jugador', left: true, value: (r) => r.name, render: (r) => <span className={r.gs ? 'b' : ''}>{shortName(r.name)}</span> },
    { key: 'min', label: 'MIN', value: (r) => r.line.sec, render: (r) => mins(r.line.sec) },
    { key: 'pts', label: 'PTS', value: (r) => r.line.pts },
    { key: 't2', label: 'T2', value: (r) => r.line.fga2, render: (r) => `${r.line.fgm2}/${r.line.fga2}` },
    { key: 't3', label: 'T3', value: (r) => r.line.fga3, render: (r) => `${r.line.fgm3}/${r.line.fga3}` },
    { key: 'tl', label: 'T1', value: (r) => r.line.fta, render: (r) => `${r.line.ftm}/${r.line.fta}` },
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
        <div className="muted">{g.comp} · {stageLabel(g.stage)} · {g.round && (g.stage === 'regular' || g.stage === 'grupos') ? `jornada ${g.round}` : ''}{g.date ? ` · ${fmtDate(g.date, true)}` : ''}</div>
        <div className="sb">
          <span className="tap" onClick={() => nav.club(g.home_id)}>{g.home}</span>
          <b>{g.home_pts} - {g.away_pts}</b>
          <span className="tap" onClick={() => nav.club(g.away_id)}>{g.away}</span>
        </div>
        {g.ot > 0 && <div className="muted">{g.ot === 1 ? 'Tras una prórroga' : `Tras ${g.ot} prórrogas`}</div>}
        {data.series && <div className="muted">Eliminatoria: {String(data.series.high_wins)}-{String(data.series.low_wins)}</div>}
      </section>
      {!data.teams.length ? (
        <p className="muted">{g.status === 'jugado' ? '⚡ Partido de simulación rápida: solo se guarda el resultado. Las estadísticas de los jugadores se suman a su temporada.' : 'Partido pendiente.'}</p>
      ) : <>
      <Tabs small value={tab} onChange={setTab} options={[['box', 'Estadísticas'], ['pbp', 'Jugada a jugada'], ['shots', 'Tiros'], ['team', 'Equipos']]} />
      {tab === 'shots' && <Tabs<string> value={String(side)} onChange={(v) => setSide(Number(v) as 0 | 1)} options={[['0', g.home], ['1', g.away]]} />}

      {tab === 'box' && ([0, 1] as const).map((sd) => (
        <section key={sd}>
          <h3 className="tap" onClick={() => nav.club(clubs[sd]!)}>{names[sd]} <span className="muted">{sd === 0 ? g.home_pts : g.away_pts}</span></h3>
          <Table
            id="box"
            cols={boxCols}
            rows={data.players.filter((p) => p.club_id === clubs[sd])}
            rowKey={(r) => r.id}
            onRow={(r) => nav.player(r.id)}
            foot={(() => {
              const t = teamLine(clubs[sd]!).line;
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
          {sd === 1 && <p className="muted small">En negrita, los titulares. <Tag kind="sim" /></p>}
        </section>
      ))}

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
      </>}
    </div>
  );
}

/* ───────────────────────────── Liga ───────────────────────────── */

type TableRow = ReturnType<typeof Q.leagueTable>[number];
type LTab = 'table' | 'leaders' | 'teams' | 'po' | 'awards' | 'records' | 'hist';
const LEADER_CATS: { key: string; label: string; value: (l: Q.PlayerLine) => number | null; fmt: (x: number | null) => string; min?: (l: Q.PlayerLine) => boolean }[] = [
  { key: 'pts', label: 'Puntos', value: (l) => l.pts / l.gp, fmt: f1 },
  { key: 'reb', label: 'Rebotes', value: (l) => reb(l) / l.gp, fmt: f1 },
  { key: 'ast', label: 'Asistencias', value: (l) => l.ast / l.gp, fmt: f1 },
  { key: 'stl', label: 'Robos', value: (l) => l.stl / l.gp, fmt: f1 },
  { key: 'blk', label: 'Tapones', value: (l) => l.blk / l.gp, fmt: f1 },
  { key: 'pir', label: 'Valoración', value: (l) => l.pir / l.gp, fmt: f1 },
  { key: 'ws', label: 'Win Shares', value: (l) => l.ws, fmt: f1 },
  { key: 'va', label: 'Victorias añadidas', value: (l) => l.va, fmt: f1 },
  { key: 'ts', label: 'TS%', value: (l) => l.ts, fmt: pc, min: (l) => fga(l) >= l.gp * 4 },
  { key: 't2', label: 'Tiros de 2 %', value: (l) => (l.fga2 ? l.fgm2 / l.fga2 : null), fmt: pc, min: (l) => l.fga2 >= l.gp * 3 },
  { key: 't3', label: 'Triples %', value: (l) => (l.fga3 ? l.fgm3 / l.fga3 : null), fmt: pc, min: (l) => l.fga3 >= l.gp * 1.5 },
  { key: 'ft', label: 'Tiros libres (T1) %', value: (l) => (l.fta ? l.ftm / l.fta : null), fmt: pc, min: (l) => l.fta >= l.gp * 1.5 },
  { key: 'usg', label: 'USG%', value: (l) => l.usg, fmt: pcRaw },
];

export function LeagueScreen({ nav, myClub }: { nav: Nav; myClub: number }) {
  const [comp, setComp] = useSticky('league.comp', 1);
  const [tab, setTab] = useSticky<LTab>('league.tab', 'table');
  const groups: [string, [number, string][]][] = [
    ['España', [[1, 'Liga ACB'], [2, 'Primera FEB'], [3, 'Copa del Rey']]],
    ['Europa', [[4, 'EuroLeague'], [5, 'EuroCup'], [6, 'Basketball Champions League']]],
    ['Ligas extranjeras (simulación rápida)', [[7, 'Francia · Betclic ÉLITE'], [8, 'Italia · Serie A'], [9, 'Alemania · BBL'], [10, 'Turquía · Süper Ligi'], [11, 'Grecia · Basket League'], [12, 'NBA'], [13, 'NCAA']]],
  ];
  const picker = (
    <select className="comppick" value={comp} onChange={(e) => setComp(Number(e.target.value))} aria-label="Competición">
      {groups.map(([g, cs]) => <optgroup key={g} label={g}>{cs.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
    </select>
  );
  if (comp >= 3 && comp <= 6) {
    return (
      <div>
        {picker}
        <CupView comp={comp} nav={nav} myClub={myClub} />
      </div>
    );
  }
  const fast = comp >= 7;
  const tabs: [LTab, string][] = fast
    ? [['table', 'Clasificación'], ['leaders', 'Líderes'], ['po', 'Playoffs'], ['hist', 'Campeones']]
    : [['table', 'Clasificación'], ['leaders', 'Líderes'], ['teams', 'Equipos'], ['po', 'Playoffs'], ['awards', 'Premios'], ['records', 'Récords'], ['hist', 'Campeones']];
  const cur = tabs.some(([k]) => k === tab) ? tab : 'table';
  return (
    <div>
      {picker}
      {fast && <p className="muted small fastnote">⚡ Simulación rápida: solo resultados y estadísticas de temporada (sin hoja de partido). Plantillas inventadas.</p>}
      <Tabs<LTab> small value={cur} onChange={setTab} options={tabs} />
      {cur === 'table' && <Standings comp={comp} nav={nav} myClub={myClub} adv={false} />}
      {cur === 'teams' && <Standings comp={comp} nav={nav} myClub={myClub} adv />}
      {cur === 'leaders' && <Leaders comp={comp} nav={nav} myClub={myClub} />}
      {cur === 'po' && <Playoffs comp={comp} nav={nav} />}
      {cur === 'hist' && <History />}
      {cur === 'awards' && <AwardsView nav={nav} myClub={myClub} />}
      {cur === 'records' && <RecordsView nav={nav} />}
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
        { key: 'pos', label: '#', left: true, value: (r) => data.indexOf(r) + 1, render: (r) => { const i = data.indexOf(r) + 1; return <span className={(comp === 1 && i <= 8) || (comp >= 7 && i <= (PO_SIZE[comp] ?? 8)) ? 'po' : (comp === 1 && i > n - 2) || (comp === 2 && i <= 2) ? 'mv' : ''}>{i}</span>; } },
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
      {!adv && <p className="muted small">{comp === 1 ? 'Los 8 primeros juegan los playoffs; los dos últimos descienden.' : comp === 2 ? 'Los dos primeros ascienden a la Liga ACB.' : `Simulación rápida: solo resultados y estadísticas de temporada. Los ${PO_SIZE[comp] ?? 8} primeros juegan los playoffs.`}</p>}
      {adv && <p className="muted small">Fase regular. Posesiones exactas contadas por el motor.</p>}
    </section>
  );
}

function Leaders({ comp, nav, myClub }: { comp: number; nav: Nav; myClub: number }) {
  const [stage0, setStage] = useState<'regular' | 'playoffs'>('regular');
  const stage: Q.Stage = comp >= 3 && comp <= 6 ? 'all' : comp >= 7 ? 'regular' : stage0;
  const [cat, setCat] = useSticky('leaders.cat', 'pts');
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
        {comp === 1 && <Tabs<'regular' | 'playoffs'> small value={stage0} onChange={setStage} options={[['regular', 'Regular'], ['playoffs', 'Playoffs']]} />}
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
  if (comp === 2) return <p className="muted">La Primera FEB no tiene playoffs en esta versión: los dos primeros ascienden directamente.</p>;
  if (!data) return <Loading error={error} />;
  if (!data.length) return <p className="muted">Los playoffs empiezan al terminar la fase regular: {PO_SIZE[comp] === 16 ? 'los 16 primeros, 1º contra 16º, 8º contra 9º…' : '1º-8º, 4º-5º, 2º-7º y 3º-6º'}.</p>;
  const rounds = [1, 2, 3, 4].filter((r) => data.some((s) => s.round === r));
  const total = (PO_SIZE[comp] ?? 8) === 16 ? 4 : 3;
  const names = total === 4 ? ['Octavos', 'Cuartos', 'Semifinales', 'Final'] : ['Cuartos', 'Semifinales', 'Final'];
  const label = (r: number) => {
    const bo = data.find((s) => s.round === r)?.best_of ?? 1;
    return `${names[r - 1] ?? `Ronda ${r}`}${bo > 1 ? ` (al mejor de ${bo})` : ' (partido único)'}`;
  };
  return (
    <section>
      {rounds.map((r) => (
        <div key={r}>
          <h3>{label(r)}</h3>
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

type CompView = ReturnType<typeof Q.competitionView>;
const ROUND_NAME: Record<number, string> = { 1: 'Cuartos', 2: 'Semifinales', 3: 'Final' };

/** Copa del Rey y competiciones europeas: grupos, cuadro y líderes. */
function CupView({ comp, nav, myClub }: { comp: number; nav: Nav; myClub: number }) {
  const [tab, setTab] = useState<'groups' | 'po' | 'leaders'>(comp === 3 ? 'po' : 'groups');
  const { data, error } = useData<CompView>('competition', { comp }, [comp]);
  useEffect(() => setTab(comp === 3 ? 'po' : 'groups'), [comp]);
  if (!data) return <Loading error={error} />;
  const opts: ['groups' | 'po' | 'leaders', string][] = comp === 3 ? [['po', 'Cuadro'], ['leaders', 'Líderes']] : [['groups', 'Grupos'], ['po', 'Eliminatorias'], ['leaders', 'Líderes']];
  return (
    <div>
      <section className="hero">
        <h2><span className={`compbadge c${comp}`}>{data.info.short}</span>{data.info.name}</h2>
        <p className="muted small">
          {comp === 3
            ? 'Los 8 primeros de la ACB al acabar la primera vuelta (jornada 17). Cuartos, semifinales y final a partido único (días 18-20), en casa del mejor clasificado.'
            : 'Dos grupos de 8 a doble vuelta (días pares 2-28). Los 4 primeros de cada grupo pasan a cuartos; cuartos, semifinales y final a partido único.'}
        </p>
        {data.champion?.champion && <p>Campeón: <b>{data.champion.champion}</b>{data.champion.runner ? ` · finalista: ${data.champion.runner}` : ''}</p>}
      </section>
      <Tabs small value={tab} onChange={setTab} options={opts} />
      {tab === 'groups' && (
        Object.keys(data.groups).length === 0
          ? <p className="muted">Esta temporada no hay fase de grupos todavía.</p>
          : Object.entries(data.groups).map(([g, rows]) => (
              <section key={g}>
                <h3>Grupo {g}</h3>
                <Table
                  cols={[
                    { key: 'pos', label: '#', left: true, value: (r) => rows.indexOf(r) + 1, render: (r) => { const i = rows.indexOf(r) + 1; return <span className={i <= 4 ? 'po' : ''}>{i}</span>; } },
                    { key: 'club', label: 'Club', left: true, value: (r) => r.name },
                    { key: 'gp', label: 'PJ', value: (r) => r.gp },
                    { key: 'w', label: 'G', value: (r) => r.w },
                    { key: 'l', label: 'P', value: (r) => r.l },
                    { key: 'd', label: 'Dif.', value: (r) => r.pf - r.pa, render: (r) => signed(r.pf - r.pa) },
                  ]}
                  rows={rows}
                  rowKey={(r) => r.club_id}
                  highlight={(r) => r.club_id === myClub}
                  onRow={(r) => nav.club(r.club_id)}
                />
              </section>
            ))
      )}
      {tab === 'po' && <Bracket data={data} nav={nav} myClub={myClub} />}
      {tab === 'leaders' && <Leaders comp={comp} nav={nav} myClub={myClub} />}
    </div>
  );
}

function Bracket({ data, nav, myClub }: { data: CompView; nav: Nav; myClub: number }) {
  if (!data.series.length) return <p className="muted">{data.comp === 3 ? 'El cuadro se sortea al terminar la jornada 17 de la ACB.' : 'Los cruces se conocen al terminar la fase de grupos.'}</p>;
  return (
    <section>
      <div className="bracket">
        {[1, 2, 3].map((r) => (
          <div key={r} className="col">
            <h4>{ROUND_NAME[r]}</h4>
            {data.series.filter((s) => s.round === r).map((s) => {
              const g = s.games[0];
              const hiHome = !g || g.home_id === s.high_id;
              const hiPts = g?.status === 'jugado' ? (hiHome ? g.home_pts : g.away_pts) : null;
              const loPts = g?.status === 'jugado' ? (hiHome ? g.away_pts : g.home_pts) : null;
              return (
                <div key={s.id} className={`tie ${s.high_id === myClub || s.low_id === myClub ? 'me' : ''}`} onClick={() => g && g.status === 'jugado' && nav.game(g.id)}>
                  <div className={s.winner_id === s.high_id ? 'w' : ''}><span>{s.high}</span><span>{hiPts ?? ''}</span></div>
                  <div className={s.winner_id === s.low_id ? 'w' : ''}><span>{s.low}</span><span>{loPts ?? ''}</span></div>
                  {!g || g.status !== 'jugado' ? <div className="muted small">Día {g?.day ?? '—'}</div> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="muted small">Toca un cruce jugado para ver la hoja del partido.</p>
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

/* ───────────────────────────── Glosario, tendencias, quinteto ───────────────────────────── */

function Glossary() {
  return (
    <details className="gloss">
      <summary>¿Qué significa cada columna?</summary>
      <dl>
        <dt>USG%</dt><dd>Porcentaje de las jugadas del equipo que acaba él (tiro, tiros libres o pérdida) mientras está en pista.</dd>
        <dt>AST% / REB%</dt><dd>Porcentaje de canastas de sus compañeros que asiste / de rebotes disponibles que coge mientras juega.</dd>
        <dt>PÉR%</dt><dd>Pérdidas por cada 100 jugadas que acaba.</dd>
        <dt>WS (Win Shares)</dt><dd>Victorias del equipo que se le atribuyen por lo que aporta en ataque (OWS) y en defensa (DWS). La suma de un equipo se acerca a sus victorias.</dd>
        <dt>VA (victorias añadidas)</dt><dd>Victorias que aporta por encima de un suplente de nivel mínimo en sus mismos minutos. 0 = un jugador cualquiera habría hecho lo mismo.</dd>
      </dl>
    </details>
  );
}

const KIND_LABEL: Record<string, string> = { rim: 'Cerca del aro', paint: 'Pintura', mid: 'Media distancia', three: 'Triples' };
function Tendencies({ natural, real, shots }: { natural: Record<string, number>; real: Record<string, number> | null; shots: number }) {
  return (
    <div>
      {(['rim', 'paint', 'mid', 'three'] as const).map((k) => (
        <div key={k} className="attr tend">
          <span className="an">{KIND_LABEL[k]}</span>
          <span className="ab dual">
            <span className="a3" style={{ width: `${Math.round(natural[k]! * 100)}%` }} />
            {real && <span className="real" style={{ width: `${Math.round(real[k]! * 100)}%` }} />}
          </span>
          <span className="av">{Math.round(natural[k]! * 100)}%{real ? <small className="muted"> / {Math.round(real[k]! * 100)}%</small> : null}</span>
        </div>
      ))}
      <p className="muted small">Barra verde: lo que tiende a buscar por sus atributos. Barra fina: lo que ha tirado de verdad esta temporada{shots ? ` (${shots} tiros)` : ''}, que también depende del plan de tiro de su entrenador.</p>
    </div>
  );
}

type LineupRow = ReturnType<typeof Q.lineup>[number];
const SLOT_SHORT = ['PG', 'SG', 'SF', 'PF', 'C'];
const SLOT_LABEL = ['Base (PG)', 'Escolta (SG)', 'Alero (SF)', 'Ala-pívot (PF)', 'Pívot (C)'];
const LEVELS: [Level, string][] = [['menos', 'Menos'], ['normal', 'Normal'], ['mas', 'Más']];
const ROLE_LABEL: Record<string, string> = { estrella: 'Estrella', titular: 'Titular', rotacion: 'Rotación', suplente: 'Suplente', reserva: 'Reserva' };

function LineupEditor({ clubId, nav }: { clubId: number; nav: Nav }) {
  const { data, error } = useData<LineupRow[]>('lineup', { clubId }, [clubId]);
  const [starters, setStarters] = useState<(number | null)[]>([null, null, null, null, null]);
  const [roles, setRoles] = useState<Record<number, Role>>({});
  const [mins, setMins] = useState<Record<number, number | null>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setMins(Object.fromEntries(data.map((p) => [p.id, p.target])));
    const st: (number | null)[] = [null, null, null, null, null];
    for (const p of data) if (p.slot !== null) st[p.slot] = p.id;
    setStarters(st);
    setRoles(Object.fromEntries(data.map((p) => [p.id, p.role as Role])));
  }, [data]);
  if (!data) return <Loading error={error} />;
  const byId = new Map(data.map((p) => [p.id, p]));
  // Quinteto que pondría el entrenador automático (misma regla que el motor: los mejores por puesto, sin lesionados).
  const autoFive = (() => {
    const taken = new Set<number>(starters.filter((x): x is number => x !== null));
    const out: (number | null)[] = [...starters];
    const pairs: { id: number; slot: number; v: number }[] = [];
    for (const p of data) if (!p.injury && !taken.has(p.id) && p.role !== 'fuera') p.atPos.forEach((v, slot) => out[slot] === null && pairs.push({ id: p.id, slot, v }));
    pairs.sort((a, b) => b.v - a.v);
    for (const pr of pairs) if (out[pr.slot] === null && !taken.has(pr.id)) { out[pr.slot] = pr.id; taken.add(pr.id); }
    return out;
  })();
  // La libertad de tiro antigua (Más/Menos) se conserva tal cual; ahora se ajusta con las tendencias del jugador.
  const shoot = Object.fromEntries(data.map((p) => [p.id, p.shoot as Level]));
  const save = async (st = starters, ro = roles) => {
    setErr(null);
    try {
      await call('setLineup', { clubId, starters: st, roles: ro, shoot, minutes: mins });
      setMsg('Guardado. Se aplica desde el próximo partido.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const bench = data.filter((p) => !starters.includes(p.id));
  return (
    <div>
      <Toast text={msg} />
      {err && <p className="error">{err}</p>}
      <section>
        <h3>Quinteto titular</h3>
        <div className="oncourt">
          {starters.map((id, slot) => {
            const auto = id === null;
            const p = byId.get((id ?? autoFive[slot]) as number);
            return (
              <div key={slot} className="pc" onClick={() => p && nav.player(p.id)}>
                {p && p.origin !== 'real' ? <Face id={p.id} nationality={p.nationality} age={p.age} colors={p.colors} size={38} /> : <span className="face" style={{ width: 38, height: 57, display: 'grid', placeItems: 'center', margin: '0 auto', color: 'var(--muted)' }}>{p?.number ?? '?'}</span>}
                <div className="n">{p ? shortName(p.name) : '—'}</div>
                {auto && <div className="muted" style={{ fontSize: '0.62rem' }}>automático</div>}
                <div className="muted">{SLOT_SHORT[slot]}{p ? ` · ${p.atPos[slot]}` : ''}</div>
                {p && <div className="arch">{p.archetype.label}</div>}
              </div>
            );
          })}
        </div>
        {starters.map((id, slot) => (
          <div key={slot} className="slot">
            <span className="sl">{SLOT_LABEL[slot]}</span>
            <select
              value={id ?? ''}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                // Si el elegido ya estaba en otro hueco, se intercambian.
                const prev = starters[slot] ?? null;
                const next = starters.map((x, i) => (i === slot ? v : x === v ? prev : x));
                setStarters(next);
                setMsg(null);
              }}
            >
              <option value="">Automático</option>
              {(() => {
                // Primero los libres, por su media en este puesto; los que ya están en otro hueco, al final.
                const sorted = [...data].sort((a, b) => Number(a.injury) - Number(b.injury) || b.atPos[slot]! - a.atPos[slot]!);
                const busyIn = (p: LineupRow) => starters.findIndex((x, i) => x === p.id && i !== slot);
                const free = sorted.filter((p) => busyIn(p) < 0);
                const taken = sorted.filter((p) => busyIn(p) >= 0);
                const label = (p: LineupRow) => `${p.atPos[slot]} · ${shortName(p.name)} · ${p.pos1}${p.pos2 ? `/${p.pos2}` : ''} · ${p.archetype.label}${p.injury ? ' · LESIONADO' : ''}`;
                return (
                  <>
                    <optgroup label="Disponibles (media en este puesto)">
                      {free.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
                    </optgroup>
                    {taken.length > 0 && (
                      <optgroup label="Ya en el quinteto (se intercambian)">
                        {taken.map((p) => <option key={p.id} value={p.id}>{label(p)} · ahora de {SLOT_SHORT[busyIn(p)]}</option>)}
                      </optgroup>
                    )}
                  </>
                );
              })()}
            </select>
          </div>
        ))}
        <p className="muted small">El primer número es su media jugando en ese puesto. «Automático» deja que el entrenador elija. Con cansancio o faltas, el titular también se sienta.</p>
      </section>

      <section>
        <h3>Rotación</h3>
        <div className="tbl">
          <table>
            <thead><tr><th className="l">Jugador</th><th>Pos.</th><th>Media</th><th className="l">Papel</th><th className="l">Minutos objetivo</th><th>MIN</th><th className="l">Espera</th><th>Moral</th><th>Cansancio</th><th className="l">Perfil</th></tr></thead>
            <tbody>
              {[...starters.filter((x): x is number => x !== null).map((id) => byId.get(id)!), ...bench].map((p) => {
                const isStarter = starters.includes(p.id);
                return (
                  <tr key={p.id}>
                    <td className="l tap" onClick={() => nav.player(p.id)}>{isStarter ? <b>{shortName(p.name)}</b> : shortName(p.name)}{p.injury && <span className="bad"> ✚</span>}</td>
                    <td>{p.pos1}{p.pos2 ? `/${p.pos2}` : ''}</td>
                    <td><b className={`ovr ${ovrClass(p.ovr)}`}>{p.ovr}</b></td>
                    <td className="l">
                      {isStarter ? <span className="muted">Titular</span> : (
                        <select value={roles[p.id] ?? 'rot'} onChange={(e) => { setRoles({ ...roles, [p.id]: e.target.value as Role }); setMsg(null); }}>
                          <option value="rot">Rotación</option>
                          <option value="poco">Pocos min.</option>
                          <option value="fuera">Fuera</option>
                        </select>
                      )}
                    </td>
                    <td className="l">
                      <select value={mins[p.id] ?? ''} onChange={(e) => { setMins({ ...mins, [p.id]: e.target.value === '' ? null : Number(e.target.value) }); setMsg(null); }} aria-label="Minutos objetivo">
                        <option value="">Auto</option>
                        {[0, 6, 10, 14, 18, 22, 26, 30, 34].map((m) => <option key={m} value={m}>{m ? `${m} min` : 'No juega'}</option>)}
                      </select>
                    </td>
                    <td>{p.min !== null ? f1(p.min) : '—'}</td>
                    <td className="l muted">{ROLE_LABEL[p.expected]}</td>
                    <td title={p.mood ?? ''}><span className={p.morale >= 60 ? 'good' : p.morale < 40 ? 'bad' : ''}>{p.morale}</span></td>
                    <td>{p.fatigue > 0.05 ? <span className={p.fatigue > 0.4 ? 'bad' : p.fatigue > 0.2 ? 'warn' : ''}>{Math.round(p.fatigue * 100)} %</span> : '—'}</td>
                    <td className="l">{p.archetype.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Papel: titular, rotación, pocos minutos o fuera. Minutos objetivo: el entrenador intenta darle esos minutos (los cambios automáticos lo tienen en cuenta). MIN: minutos por partido esta temporada. Espera: el papel que cree merecer; si juega mucho menos, baja su moral. Cansancio acumulado: se recupera con los días; si es alto, rinde menos y se lesiona más. Lo que hace cada jugador cuando está en pista (cuánto tira, desde dónde, cuánto defiende) se ajusta en su ficha, pestaña «Tendencias».</p>
      </section>

      <div className="row">
        <button onClick={() => void save()}>Guardar</button>
        <button className="sec" onClick={() => {
          const st = [null, null, null, null, null];
          const ro = {};
          setStarters(st); setRoles(ro);
          void save(st, ro);
        }}>Quinteto automático</button>
      </div>
    </div>
  );
}

function RealData({ id }: { id: number }) {
  const { data, error } = useData<{
    seasons: { season: number; gp: number; min: number; val: number; sm: number | null; wins: number }[];
    prediction: { season: number; day: number; prediction: number | null; horizon: number | null; price: number | null; broker: number | null; avg: number | null } | null;
    last: { season: number; day: number; team: string; opponent: string; home: number; win: number; min: number; val: number; sm_pts: number | null }[];
    batch: { file_name: string; imported_at: string } | null;
  }>('real', { id }, [id]);
  if (!data) return <Loading error={error} />;
  return (
    <section>
      <h3>Liga ACB real <Tag kind="real" /></h3>
      <Table
        cols={[
          { key: 's', label: 'Temp.', left: true, value: (r) => r.season, render: (r) => seasonLabel(r.season) },
          { key: 'gp', label: 'PJ', value: (r) => r.gp },
          { key: 'min', label: 'MIN', value: (r) => (r.gp ? r.min / r.gp : null), render: (r) => (r.gp ? f1(r.min / r.gp) : '—') },
          { key: 'val', label: 'VAL', value: (r) => (r.gp ? r.val / r.gp : null), render: (r) => (r.gp ? f1(r.val / r.gp) : '—') },
          { key: 'v40', label: 'VAL/40', value: (r) => (r.min ? (40 * r.val) / r.min : null), render: (r) => (r.min ? f1((40 * r.val) / r.min) : '—') },
          { key: 'sm', label: 'Pts SM', title: 'Puntos SuperManager por partido', value: (r) => r.sm, render: (r) => f1(r.sm) },
        ]}
        rows={data.seasons}
        rowKey={(r) => r.season}
      />
      {data.prediction && (
        <>
          <h3>Predicción de SuperManagerLab <span className="tag est">Predicción</span></h3>
          <dl>
            <dt>Jornada {data.prediction.day}</dt><dd>{f1(data.prediction.prediction)} puntos SM previstos{data.prediction.horizon !== null ? ` · ${f1(data.prediction.horizon)} a varias jornadas` : ''}</dd>
            <dt>Precio</dt><dd>{data.prediction.price !== null ? `${f0(data.prediction.price)} €` : '—'}{data.prediction.broker !== null ? ` · bróker esperado ${data.prediction.broker >= 0 ? '+' : ''}${f0(data.prediction.broker)} €` : ''}</dd>
          </dl>
        </>
      )}
      <h3>Últimos partidos reales</h3>
      <Table
        cols={[
          { key: 'd', label: 'Jor.', left: true, value: (r) => r.season * 100 + r.day, render: (r) => `${seasonLabel(r.season)} J${r.day}` },
          { key: 'o', label: 'Rival', left: true, value: (r) => r.opponent, render: (r) => `${r.home ? 'vs' : 'en'} ${r.opponent}` },
          { key: 'w', label: '', value: (r) => r.win, render: (r) => <b className={r.win ? 'good' : 'bad'}>{r.win ? 'G' : 'P'}</b> },
          { key: 'min', label: 'MIN', value: (r) => r.min, render: (r) => f1(r.min) },
          { key: 'val', label: 'VAL', value: (r) => r.val },
          { key: 'sm', label: 'SM', value: (r) => r.sm_pts, render: (r) => f1(r.sm_pts) },
        ]}
        rows={data.last}
        rowKey={(r) => `${r.season}-${r.day}-${r.team}`}
      />
      <p className="muted small">
        Datos importados de SuperManagerLab{data.batch ? ` (${data.batch.file_name}, ${new Date(data.batch.imported_at).toLocaleDateString('es-ES')})` : ''}. Solo traen minutos y valoración; por eso los atributos son estimados.
        Estas cifras nunca se mezclan con las estadísticas que genera el juego.
      </p>
    </section>
  );
}
