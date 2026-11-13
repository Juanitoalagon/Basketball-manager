import { useCallback, useEffect, useRef, useState } from 'react';
import { TABLES } from '../core/schema';
import { COMP_INFO } from '../core/names';
import type * as Q from '../core/queries';
import type { DayReport } from '../core/season';
import { call, cancelLoad, setProgressListener } from '../db/client';
import type { ImportReport, LoadProgress, LoadResult, Status } from '../db/protocol';
import { type Nav, Loading, Tabs, f0, seasonLabel, useData } from './kit';
import { GameScreen, GamesScreen, HomeScreen, LeagueScreen, PlayerScreen, SquadScreen } from './screens';
import { PlayersScreen } from './market';
import { LiveScreen } from './live';

const mb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const fecha = (iso: string | number | null) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca');
const num = (n: number) => n.toLocaleString('es-ES');

type TabKey = 'home' | 'squad' | 'players' | 'games' | 'league' | 'data';
type View = { kind: 'player'; id: number } | { kind: 'game'; id: number } | { kind: 'club'; id: number } | { kind: 'live' };

export function App() {
  const [st, setSt] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('home');
  const [stack, setStack] = useState<View[]>([]);
  const [log, setLog] = useState<DayReport[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSt(await call<Status>('status'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // Pedimos al navegador que no borre la partida si el dispositivo se queda sin espacio.
      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
      try {
        setSt(await call<Status>('init', Object.fromEntries(new URLSearchParams(location.search))));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  // El botón «atrás» del móvil cierra la pantalla abierta en lugar de salir de la app.
  useEffect(() => {
    const onPop = () => setStack((s) => s.slice(0, -1));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const push = (v: View) => {
    history.pushState({ v: stack.length + 1 }, '');
    setStack((s) => [...s, v]);
    window.scrollTo(0, 0);
  };
  const nav: Nav = {
    player: (id) => push({ kind: 'player', id }),
    game: (id) => push({ kind: 'game', id }),
    club: (id) => push({ kind: 'club', id }),
    live: () => push({ kind: 'live' }),
    back: () => history.back(),
  };

  if (!st) {
    return (
      <main>
        <h1>Basketball Manager Advanced</h1>
        <Loading error={error} />
      </main>
    );
  }
  const u = st.universe;
  if (!u) return <NewGame onDone={(s) => setSt(s)} hasGame={false} />;
  if (!u.user_club_id) return <ChooseClub onDone={(s) => { setSt(s); setTab('home'); }} />;

  const top = stack[stack.length - 1];
  // Tras importar, restaurar o empezar de nuevo: el resumen de la última simulación ya no vale.
  const changed = () => {
    setLog(null);
    void refresh();
  };
  return (
    <>
      <main>
        {top?.kind === 'live' ? <LiveScreen nav={nav} onDone={(gid) => { setStack((s) => [...s.slice(0, -1), { kind: 'game', id: gid }]); setLog(null); void refresh(); }} /> :
         top?.kind === 'player' ? <PlayerScreen id={top.id} nav={nav} myClub={u.user_club_id} onChanged={() => void refresh()} /> :
         top?.kind === 'game' ? <GameScreen id={top.id} nav={nav} /> :
         top?.kind === 'club' ? <SquadScreen clubId={top.id} nav={nav} isMine={top.id === u.user_club_id} onBack={nav.back} /> :
         tab === 'home' ? <HomeScreen nav={nav} onChanged={() => void refresh()} log={log} setLog={setLog} /> :
         tab === 'squad' ? <SquadScreen clubId={u.user_club_id} nav={nav} isMine /> :
         tab === 'players' ? <PlayersScreen nav={nav} myClub={u.user_club_id} /> :
         tab === 'games' ? <GamesScreen clubId={u.user_club_id} nav={nav} /> :
         tab === 'league' ? <LeagueScreen nav={nav} myClub={u.user_club_id} /> :
         <DataScreen st={st} setSt={setSt} onChanged={changed} />}
      </main>
      <nav className="bottom">
        {([['home', 'Inicio', '⌂'], ['squad', 'Equipo', '☰'], ['players', 'Jugadores', '⌕'], ['games', 'Partidos', '◷'], ['league', 'Liga', '★'], ['data', 'Datos', '⛁']] as [TabKey, string, string][]).map(([k, label, icon]) => (
          <button key={k} className={tab === k && !top ? 'on' : ''} onClick={() => { if (stack.length) history.go(-stack.length); setStack([]); setTab(k); window.scrollTo(0, 0); }}>
            <span className="ic" aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

interface RealPreview { teams: { name: string; code: string | null; players: number }[]; players: number; unmatched: string[]; prevMatched: number; currentDays: number; files: string[] }

function NewGame({ onDone, hasGame }: { onDone: (s: Status) => void; hasGame: boolean }) {
  const [name, setName] = useState('Mi carrera');
  const [kind, setKind] = useState<'real' | 'gen'>('real');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<RealPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    setPreview(null);
    try {
      setPreview(await call<RealPreview>('previewReal', { bytes: new Uint8Array(await f.arrayBuffer()) }));
      setFileName(f.name);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const seed = Math.floor(Math.random() * 2 ** 31);
      onDone(await call<Status>(kind === 'real' ? 'createReal' : 'newGame', { name: name.trim(), seed, fileName }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main>
      <h1>Basketball Manager Advanced</h1>
      <section>
        <h2>Nueva partida</h2>
        <label>
          Nombre de la partida
          <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <Tabs<'real' | 'gen'> value={kind} onChange={setKind} options={[['real', 'ACB real (SuperManagerLab)'], ['gen', 'Universo inventado']]} />
        {kind === 'gen' ? (
          <p className="muted">Liga ACB y Primera FEB con 36 clubes ficticios y 432 jugadores inventados.</p>
        ) : (
          <>
            <p className="muted">
              Elige el zip de la carpeta <b>datos</b> de SuperManagerLab. La Liga ACB se crea con sus clubes y jugadores reales; la Primera FEB, inventada.
              Como esos datos solo traen minutos y valoración por partido, el nivel de cada jugador se estima a partir de ellos y sus atributos concretos, edad y altura son estimados.
            </p>
            <div className="row">
              <button className="sec" disabled={busy} onClick={() => fileRef.current?.click()}>{preview ? 'Elegir otro zip' : 'Elegir zip de datos'}</button>
              <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => void pick(e.target.files?.[0])} />
            </div>
            {preview && (
              <div className="card">
                <p><b>{preview.teams.length} clubes y {preview.players} jugadores</b> con {preview.currentDays} jornadas de esta temporada. {preview.prevMatched} jugadores enlazados con la temporada anterior.</p>
                {preview.unmatched.length > 0 && (
                  <details className="gloss">
                    <summary>{preview.unmatched.length} sin ficha completa (se importan con su nombre corto y posición estimada)</summary>
                    <p className="muted small">{preview.unmatched.join(' · ')}</p>
                  </details>
                )}
                <p className="muted small">{preview.teams.map((t) => `${t.name} (${t.players})`).join(' · ')}</p>
              </div>
            )}
          </>
        )}
        {hasGame && <p className="warn">Sustituirá a la partida actual (se guarda una copia interna antes).</p>}
        {err && <p className="error">{err}</p>}
        <div className="row">
          <button disabled={busy || !name.trim() || (kind === 'real' && !preview)} onClick={() => void create()}>
            {busy ? 'Un momento…' : 'Crear partida'}
          </button>
        </div>
      </section>
    </main>
  );
}

function ChooseClub({ onDone }: { onDone: (s: Status) => void }) {
  const { data, error } = useData<ReturnType<typeof Q.listClubs>>('clubs', null, []);
  const [comp, setComp] = useState(1);
  const [busy, setBusy] = useState(false);
  if (!data) return <main><Loading error={error} /></main>;
  return (
    <main>
      <h1>Elige tu club</h1>
      <p className="muted">«Nivel» es la media de sus 8 mejores jugadores. Un club modesto es un reto mayor. Las etiquetas indican quién juega en Europa (EL EuroLeague, EC EuroCup, BCL Champions League).</p>
      <Tabs<string> value={String(comp)} onChange={(v) => setComp(Number(v))} options={[['1', 'Liga ACB'], ['2', 'Primera FEB']]} />
      <ul className="plain clubs">
        {data.filter((c) => c.competition_id === comp).map((c) => (
          <li key={c.id}>
            <div>
              <b>{c.name}</b> {c.euro && <span className={`compbadge c${c.euro}`}>{COMP_INFO[c.euro]?.short}</span>}
              <div className="muted small">Nivel {c.level} · presupuesto {f0(c.budget / 1e6)} M€ · reputación {c.reputation}</div>
            </div>
            <button disabled={busy} onClick={async () => { setBusy(true); try { onDone(await call<Status>('chooseClub', { clubId: c.id })); } finally { setBusy(false); } }}>Elegir</button>
          </li>
        ))}
      </ul>
    </main>
  );
}

const RELACION: Record<ImportReport['relation'], { texto: string; aviso: boolean }> = {
  'sin-partida-local': { texto: 'No hay ninguna partida en este dispositivo. Se cargará esta.', aviso: false },
  'mas-reciente': { texto: 'Es la misma partida, más avanzada que la de este dispositivo.', aviso: false },
  igual: { texto: 'Es la misma partida y en el mismo punto. Importarla no cambia nada.', aviso: false },
  'mas-antigua': { texto: 'ATENCIÓN: la partida de este dispositivo está MÁS AVANZADA que el fichero. Si importas, perderás ese avance.', aviso: true },
  'otro-universo': { texto: 'ATENCIÓN: es una partida distinta. Sustituirá a la de este dispositivo.', aviso: true },
};

function DataScreen({ st, setSt, onChanged }: { st: Status; setSt: (s: Status) => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [seasons, setSeasons] = useState(5);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [table, setTable] = useState<string>('club');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [newGame, setNewGame] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshStorage = useCallback(async () => {
    if (navigator.storage?.persisted) setPersisted(await navigator.storage.persisted());
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      setQuota({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
    }
  }, []);
  useEffect(() => {
    void refreshStorage();
    setProgressListener(setProgress);
    return () => setProgressListener(null);
  }, [refreshStorage]);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    setMsg(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(null);
      void refreshStorage();
    }
  };

  if (newGame) return <NewGame hasGame onDone={(s) => { setSt(s); setNewGame(false); onChanged(); }} />;

  const prueba = () =>
    run('Simulando temporadas de prueba…', async () => {
      setResult(null);
      setProgress(null);
      setResult(await call<LoadResult>('loadTest', { seasons }));
      setProgress(null);
    });

  const exportar = () =>
    run('Preparando la copia…', async () => {
      const { bytes, fileName } = await call<{ bytes: Uint8Array; fileName: string }>('exportSave');
      const file = new File([bytes as unknown as BlobPart], fileName, { type: 'application/zip' });
      setSt(await call<Status>('status'));
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: fileName });
          setMsg(`Copia compartida: ${fileName} (${mb(bytes.length)}).`);
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            setMsg('Has cancelado el envío. La partida no ha cambiado.');
            return;
          }
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      setMsg(`Copia descargada: ${fileName} (${mb(bytes.length)}). Súbela a Google Drive para tenerla a salvo.`);
    });

  const elegirFichero = async (f: File | undefined) => {
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await run('Verificando el fichero…', () => call<ImportReport>('importCheck', { bytes }));
    if (r) setReport(r);
    if (fileRef.current) fileRef.current.value = '';
  };
  const ver = (t: string) =>
    run('Leyendo…', async () => {
      setTable(t);
      setRows(await call<Record<string, unknown>[]>('inspect', { table: t, limit: 50, offset: 0 }));
    });

  const u = st.universe;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div>
      <h2>Datos y copias</h2>
      <p className="muted">Versión {st.appVersion} · esquema {st.schemaVersion}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {busy && <p className="muted" role="status">{busy}</p>}

      <section>
        <h3>Partida</h3>
        {u && (
          <dl>
            <dt>Nombre</dt><dd>{u.name}</dd>
            <dt>Punto de la partida</dt><dd>Temporada {seasonLabel(u.game_season)}, día {u.game_day} · revisión {st.revision}</dd>
            <dt>Contenido</dt><dd>{num(st.counts.club ?? 0)} clubes · {num(st.counts.player ?? 0)} jugadores · {num(st.counts.game ?? 0)} partidos · {num(st.counts.game_player_box ?? 0)} líneas de estadística</dd>
            <dt>Última copia exportada</dt><dd className={st.lastExport ? '' : 'warn'}>{fecha(st.lastExport)}</dd>
          </dl>
        )}
        <div className="row">
          <button disabled={!!busy || !u} onClick={exportar}>Exportar partida</button>
          <button className="sec" disabled={!!busy} onClick={() => fileRef.current?.click()}>Importar partida</button>
          <input ref={fileRef} type="file" hidden onChange={(e) => void elegirFichero(e.target.files?.[0])} />
        </div>
        <p className="muted small">La única copia segura es la que sale del dispositivo: exporta y guarda el fichero en Google Drive.</p>
        {report && (
          <div className={`card ${RELACION[report.relation].aviso ? 'danger' : ''}`} role="alertdialog" aria-label="Confirmar importación">
            <h3>Fichero verificado</h3>
            <p>{RELACION[report.relation].texto}</p>
            <dl>
              <dt>Partida</dt><dd>{report.manifest.universeName}</dd>
              <dt>Punto</dt><dd>Temporada {seasonLabel(report.manifest.gameSeason)}, día {report.manifest.gameDay} · revisión {report.manifest.revision}{report.localRevision !== null && report.relation !== 'otro-universo' ? ` (aquí: ${report.localRevision})` : ''}</dd>
              <dt>Exportada</dt><dd>{fecha(report.manifest.exportedAt)}</dd>
              {report.migratedFrom !== null && (<><dt>Esquema</dt><dd>Se actualizará de la versión {report.migratedFrom} a la {st.schemaVersion}</dd></>)}
            </dl>
            <div className="row">
              <button disabled={!!busy} onClick={() => run('Importando…', async () => { setSt(await call<Status>('importCommit')); setReport(null); setMsg('Partida importada. La anterior queda guardada como copia interna.'); onChanged(); })}>{RELACION[report.relation].aviso ? 'Importar de todos modos' : 'Importar'}</button>
              <button className="sec" disabled={!!busy} onClick={() => run('Cancelando…', async () => { setSt(await call<Status>('importCancel')); setReport(null); })}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h3>Copias internas</h3>
        <p className="muted small">Se crean solas antes de importar, de empezar temporada o de sustituir la partida (se guardan las 3 últimas). No protegen si se borran los datos de la app.</p>
        {st.snapshots.length === 0 ? <p className="muted">No hay copias internas.</p> : (
          <ul className="list">
            {st.snapshots.map((s) => (
              <li key={s.name}>
                <span>{fecha(s.at)} · {s.reason} · {mb(s.bytes)}</span>
                <button className="sec" disabled={!!busy} onClick={() => { if (confirm('La partida actual se sustituirá por esta copia. ¿Seguir?')) void run('Restaurando…', async () => { setSt(await call<Status>('restoreSnapshot', { name: s.name })); setMsg('Copia restaurada.'); onChanged(); }); }}>Restaurar</button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="sec" disabled={!!busy || !u} onClick={() => run('Guardando copia…', async () => { setSt(await call<Status>('snapshotNow')); setMsg('Copia interna creada.'); })}>Crear copia interna ahora</button>
        </div>
      </section>

      <section>
        <h3>Almacenamiento</h3>
        <dl>
          <dt>Almacenamiento persistente</dt>
          <dd className={persisted ? 'good' : 'warn'}>{persisted === null ? 'no disponible en este navegador' : persisted ? 'concedido: el navegador no borrará la partida por falta de espacio' : 'NO concedido todavía'}</dd>
          <dt>Espacio usado por la app</dt><dd>{quota ? `${mb(quota.usage)} de ${mb(quota.quota)} disponibles` : 'desconocido'}</dd>
          <dt>Tamaño de la partida</dt><dd>{mb(st.sizeBytes)}</dd>
          <dt>Apertura de la base de datos</dt><dd>{st.openMs} ms</dd>
        </dl>
        {persisted === false && (
          <>
            <p className="muted small">Chrome suele concederlo al instalar la app en la pantalla de inicio.</p>
            <button className="sec" disabled={!!busy} onClick={() => run('Pidiendo permiso…', async () => { await navigator.storage.persist(); })}>Pedir almacenamiento persistente</button>
          </>
        )}
      </section>

      <section>
        <h3>Prueba de rendimiento</h3>
        <p className="muted small">Juega temporadas completas con el motor real en una base aparte (tu partida no se toca) y mide cuánto tarda tu dispositivo en simular y guardar cada jornada.</p>
        <div className="row">
          <label>Temporadas <input type="number" min={1} max={50} value={seasons} disabled={!!busy} onChange={(e) => setSeasons(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></label>
          <button disabled={!!busy} onClick={prueba}>Empezar prueba</button>
          <button className="sec" disabled={!progress} onClick={cancelLoad}>Detener</button>
        </div>
        {progress && (
          <div>
            <progress max={100} value={pct} aria-label="Progreso de la prueba" />
            <p className="muted">{pct}% · temporada {seasonLabel(progress.season)}, día {progress.day} · última jornada en {progress.lastMs} ms</p>
          </div>
        )}
        {result && (
          <div className="tbl">
            <table>
              <caption>{result.cancelled ? 'Prueba detenida' : 'Prueba terminada'}: {num(result.days)} jornadas en {(result.totalMs / 1000).toFixed(1)} s</caption>
              <tbody>
                <tr><th className="l">Simular y guardar una jornada (media)</th><td>{result.avgMs} ms</td></tr>
                <tr><th className="l">El 95 % de las jornadas, por debajo de</th><td>{result.p95Ms} ms</td></tr>
                <tr><th className="l">Peor jornada</th><td>{result.maxMs} ms</td></tr>
                <tr><th className="l">Media por temporada</th><td className="wrap">{result.perSeasonAvgMs.join(' · ')} ms</td></tr>
                <tr><th className="l">Tamaño de la base</th><td>{mb(result.sizeBytes)}</td></tr>
                {result.queries.map((q) => (<tr key={q.name}><th className="l">{q.name}</th><td>{q.ms} ms</td></tr>))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3>Inspector de la base de datos</h3>
        <div className="row">
          <select value={table} disabled={!!busy} onChange={(e) => void ver(e.target.value)} aria-label="Tabla">
            {TABLES.map((t) => (<option key={t} value={t}>{t} ({num(st.counts[t] ?? 0)})</option>))}
          </select>
          <button className="sec" disabled={!!busy} onClick={() => void ver(table)}>Ver 50 filas</button>
        </div>
        {rows && (rows.length === 0 ? <p className="muted">La tabla está vacía.</p> : (
          <div className="tbl">
            <table>
              <thead><tr>{Object.keys(rows[0]!).map((c) => (<th key={c}>{c}</th>))}</tr></thead>
              <tbody>{rows.map((r, i) => (<tr key={i}>{Object.values(r).map((v, j) => (<td key={j}>{v === null ? '—' : v instanceof Uint8Array ? `${v.length} bytes` : String(v)}</td>))}</tr>))}</tbody>
            </table>
          </div>
        ))}
      </section>

      <section>
        <h3>Empezar de nuevo</h3>
        <div className="row">
          <button className="sec" disabled={!!busy} onClick={() => setNewGame(true)}>Nueva partida</button>
          <button className="dangerBtn" disabled={!!busy} onClick={() => { if (confirm('Se borrará la partida y todas las copias internas de este dispositivo. ¿Seguro?')) void run('Borrando…', async () => { setSt(await call<Status>('reset')); setRows(null); setResult(null); }); }}>Borrar todo</button>
        </div>
      </section>
    </div>
  );
}
