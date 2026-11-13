/// <reference lib="webworker" />
/**
 * Hilo de trabajo: aquí vive la base de datos. La interfaz solo le envía mensajes.
 * SQLite guarda en OPFS (almacenamiento privado del navegador) con el VFS opfs-sahpool.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { buildSave, readSave, type Manifest } from '../core/savefile';
import { APP_VERSION, ENGINE_VERSION, TABLES, getSetting, migrate, schemaVersion, setSetting, type Db } from '../core/schema';
import { COMP, advanceDay, chooseClub, createUniverse, getUniverse, startNewSeason, type DayReport } from '../core/season';
import * as Q from '../core/queries';
import { wrapDb } from './adapter';
import type { AdvanceResult, ImportReport, LoadResult, Status } from './protocol';

const MAIN = '/universe.sqlite';
const INCOMING = '/incoming.sqlite';
const BENCH = '/bench.sqlite';
const MAX_SNAPSHOTS = 3;
// Ajustes de escritura; se pueden cambiar desde la dirección (?j=...&s=...) para comparar en la prueba de carga.
let JOURNAL = 'PERSIST';
let SYNC = 'FULL';
let PAGE = 32768;

/* eslint-disable @typescript-eslint/no-explicit-any */
let pool: any;
let raw: any;
let db: Db;
let openMs = 0;
let cancelRequested = false;
let pendingImport: Manifest | null = null;

function openMain() {
  raw = new pool.OpfsSAHPoolDb(MAIN);
  db = wrapDb(raw);
  // Menos lecturas y escrituras a disco: caché de 32 MB, temporales en memoria y diario reutilizado.
  if (schemaVersion(db) === 0) db.exec('PRAGMA page_size = ' + PAGE); // solo se puede fijar en una base nueva
  db.exec('PRAGMA cache_size = -32000');
  db.exec('PRAGMA temp_store = MEMORY');
  db.rows('PRAGMA journal_mode = ' + JOURNAL);
  db.exec('PRAGMA synchronous = ' + SYNC);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
}

async function init(opts?: { j?: string; s?: string; p?: string }): Promise<Status> {
  if (opts?.p && /^(4096|8192|16384|32768)$/.test(opts.p)) PAGE = Number(opts.p);
  const t0 = performance.now();
  if (opts?.j && /^(DELETE|TRUNCATE|PERSIST|MEMORY)$/.test(opts.j)) JOURNAL = opts.j;
  if (opts?.s && /^(FULL|NORMAL|OFF)$/.test(opts.s)) SYNC = opts.s;
  if (!pool) {
    const sqlite3: any = await sqlite3InitModule();
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'bm-pool', initialCapacity: 16 });
    } catch (e) {
      // Nunca seguimos con una base en memoria: perdería la partida al cerrar.
      throw new Error(
        'Este navegador no permite guardar la partida en el dispositivo (OPFS no disponible). ' +
          'Usa Chrome actualizado y cierra otras pestañas con la app abierta. Detalle: ' + (e as Error).message,
      );
    }
    for (const f of [INCOMING, BENCH]) if (pool.getFileNames().includes(f)) pool.unlink(f);
    openMain();
  }
  openMs = Math.round(performance.now() - t0);
  return status();
}

function dbSize(d: Db): number {
  const pc = Number(d.rows<{ page_count: number }>('PRAGMA page_count')[0]!.page_count);
  const ps = Number(d.rows<{ page_size: number }>('PRAGMA page_size')[0]!.page_size);
  return pc * ps;
}

function tableCounts(d: Db): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = Number(d.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)[0]!.n);
  return out;
}

function listSnapshots(): Status['snapshots'] {
  return (pool.getFileNames() as string[])
    .filter((n) => n.startsWith('/snap-'))
    .map((name) => {
      // El tamaño va en el nombre para no tener que leer la copia entera.
      const m = /^\/snap-(\d+)-(\d+)-(.+)\.sqlite$/.exec(name);
      return { name, at: Number(m?.[1] ?? 0), reason: (m?.[3] ?? '').replace(/-/g, ' '), bytes: Number(m?.[2] ?? 0) };
    })
    .sort((a, b) => b.at - a.at);
}

function status(): Status {
  return {
    appVersion: APP_VERSION,
    schemaVersion: schemaVersion(db),
    universe: getUniverse(db),
    revision: Number(getSetting(db, 'revision') ?? '0'),
    sizeBytes: dbSize(db),
    counts: tableCounts(db),
    snapshots: listSnapshots(),
    lastExport: getSetting(db, 'lastExport'),
    openMs,
  };
}

async function snapshot(reason: string): Promise<void> {
  if (!getUniverse(db)) return;
  const bytes: Uint8Array = pool.exportFile(MAIN);
  await pool.importDb(`/snap-${Date.now()}-${bytes.length}-${reason}.sqlite`, bytes);
  for (const old of listSnapshots().slice(MAX_SNAPSHOTS)) pool.unlink(old.name);
}

async function replaceMain(bytes: Uint8Array): Promise<void> {
  raw.close();
  pool.unlink(MAIN);
  await pool.importDb(MAIN, bytes);
  openMain();
}

/**
 * Prueba de rendimiento en una base aparte (no toca la partida): crea un universo, juega N
 * temporadas completas con el motor real y mide cuánto tarda cada jornada (simular + guardar).
 */
async function loadTest(seasons: number): Promise<LoadResult> {
  cancelRequested = false;
  if (pool.getFileNames().includes(BENCH)) pool.unlink(BENCH);
  const bRaw = new pool.OpfsSAHPoolDb(BENCH);
  const b = wrapDb(bRaw);
  b.exec('PRAGMA page_size = ' + PAGE);
  b.exec('PRAGMA cache_size = -32000');
  b.rows('PRAGMA journal_mode = ' + JOURNAL);
  b.exec('PRAGMA synchronous = ' + SYNC);
  const times: number[] = [];
  const perSeasonAvgMs: number[] = [];
  const t0 = performance.now();
  let sizeBytes = 0;
  let queries: LoadResult['queries'] = [];
  try {
    migrate(b);
    createUniverse(b, { name: 'Prueba', seed: 12345, id: 'bench' });
    chooseClub(b, 1);
    const estimate = seasons * 47;
    for (let s = 0; s < seasons && !cancelRequested; s++) {
      const start = times.length;
      while (!cancelRequested) {
        const t = performance.now();
        const r = advanceDay(b);
        times.push(performance.now() - t);
        postMessage({ event: 'progress', progress: { done: times.length, total: Math.max(estimate, times.length), season: r.season, day: r.day, lastMs: Math.round(times[times.length - 1]!) } });
        await new Promise((res) => setTimeout(res, 0));
        if (r.seasonOver) break;
      }
      const chunk = times.slice(start);
      if (chunk.length) perSeasonAvgMs.push(Math.round(chunk.reduce((x, y) => x + y, 0) / chunk.length));
      if (!cancelRequested && s < seasons - 1) startNewSeason(b);
    }
    sizeBytes = dbSize(b);
    const u = getUniverse(b)!;
    const tq = (name: string, fn: () => unknown) => {
      const t = performance.now();
      const r = fn();
      return { name, ms: Math.round((performance.now() - t) * 10) / 10, rows: Array.isArray(r) ? r.length : 1 };
    };
    queries = [
      tq('Clasificación', () => Q.leagueTable(b, u.game_season, COMP.ACB)),
      tq('Estadísticas avanzadas de toda la liga', () => Q.playerLines(b, u.game_season, COMP.ACB, 'regular')),
      tq('Ficha completa de un jugador', () => [Q.playerDetail(b, 3)]),
      tq('Mapa de tiro de un jugador', () => Q.shotZones(b, 3, u.game_season).mine),
      tq('Hoja de un partido con relato', () => [Q.gameDetail(b, Number(b.rows<{ id: number }>("SELECT id FROM game WHERE home_id = 1 AND status = 'jugado' LIMIT 1")[0]?.id ?? 1))]),
    ];
  } finally {
    bRaw.close();
    pool.unlink(BENCH);
  }
  const sorted = [...times].sort((x, y) => x - y);
  return {
    days: times.length,
    cancelled: cancelRequested,
    totalMs: Math.round(performance.now() - t0),
    avgMs: Math.round(times.reduce((x, y) => x + y, 0) / Math.max(1, times.length)),
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
    perSeasonAvgMs,
    sizeBytes,
    queries,
  };
}

/** Avanza jornadas guardando cada una por separado; se puede detener entre jornadas. */
async function advance(mode: 'day' | 'week' | 'regular' | 'season'): Promise<AdvanceResult> {
  cancelRequested = false;
  const reports: DayReport[] = [];
  const max = mode === 'day' ? 1 : mode === 'week' ? 5 : 200;
  const startPhase = getUniverse(db)?.phase;
  for (let i = 0; i < max && !cancelRequested; i++) {
    const r = advanceDay(db);
    reports.push(r);
    postMessage({ event: 'progress', progress: { done: i + 1, total: max === 200 ? 0 : max, season: r.season, day: r.day, lastMs: 0 } });
    if (r.seasonOver) break;
    const u = getUniverse(db)!;
    if (mode === 'regular' && (u.phase !== startPhase || r.stage !== 'regular')) break;
    if (mode === 'regular' && !db.rows("SELECT 1 FROM game WHERE season = ? AND status = 'pendiente' AND stage = 'regular' LIMIT 1", [u.game_season]).length) break;
    await new Promise((res) => setTimeout(res, 0));
  }
  return { reports, cancelled: cancelRequested };
}

async function exportSave(): Promise<{ bytes: Uint8Array; fileName: string }> {
  const u = getUniverse(db);
  if (!u) throw new Error('No hay ninguna partida que exportar.');
  setSetting(db, 'lastExport', new Date().toISOString());
  const dbBytes: Uint8Array = pool.exportFile(MAIN);
  const bytes = await buildSave(dbBytes, {
    schemaVersion: schemaVersion(db),
    engineVersion: ENGINE_VERSION,
    universeId: u.id,
    universeName: u.name,
    revision: Number(getSetting(db, 'revision') ?? '0'),
    gameSeason: u.game_season,
    gameDay: u.game_day,
    tables: tableCounts(db),
  });
  const safe = u.name.normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'partida';
  return { bytes, fileName: `${safe}-T${u.game_season}-J${u.game_day}-r${getSetting(db, 'revision')}.bmsave` };
}

/** Paso 1 de importar: verifica todo en una copia aparte. La partida actual no se toca. */
async function importCheck(zipBytes: Uint8Array): Promise<ImportReport> {
  pendingImport = null;
  const { manifest, dbBytes } = await readSave(zipBytes);
  if (pool.getFileNames().includes(INCOMING)) pool.unlink(INCOMING);
  await pool.importDb(INCOMING, dbBytes);
  const inRaw = new pool.OpfsSAHPoolDb(INCOMING);
  let migratedFrom: number | null = null;
  try {
    const d = wrapDb(inRaw);
    const check = d.rows<{ integrity_check: string }>('PRAGMA integrity_check')[0]?.integrity_check;
    if (check !== 'ok') throw new Error('La base de datos de la partida está dañada.');
    const v = schemaVersion(d);
    if (v < 1) throw new Error('La partida no tiene un esquema reconocible.');
    const before = v;
    migrate(d); // lanza un error claro si la partida es de una versión más nueva
    if (schemaVersion(d) !== before) migratedFrom = before;
    const u = getUniverse(d);
    if (!u || u.id !== manifest.universeId) throw new Error('El contenido de la partida no coincide con su manifiesto.');
  } catch (e) {
    inRaw.close();
    pool.unlink(INCOMING);
    throw e;
  }
  inRaw.close();
  const local = getUniverse(db);
  const localRevision = local ? Number(getSetting(db, 'revision') ?? '0') : null;
  const relation: ImportReport['relation'] = !local
    ? 'sin-partida-local'
    : local.id !== manifest.universeId
      ? 'otro-universo'
      : manifest.revision > localRevision!
        ? 'mas-reciente'
        : manifest.revision === localRevision
          ? 'igual'
          : 'mas-antigua';
  pendingImport = manifest;
  return { manifest, relation, localRevision, migratedFrom };
}

/** Paso 2: guarda una instantánea de lo actual y sustituye la partida de una vez. */
async function importCommit(): Promise<Status> {
  if (!pendingImport || !pool.getFileNames().includes(INCOMING)) throw new Error('No hay ninguna importación pendiente.');
  await snapshot('antes-de-importar');
  const bytes: Uint8Array = pool.exportFile(INCOMING);
  await replaceMain(bytes);
  pool.unlink(INCOMING);
  pendingImport = null;
  return status();
}

function inspect(table: string, limit: number, offset: number) {
  if (!(TABLES as readonly string[]).includes(table)) throw new Error('Tabla desconocida.');
  const cols = table === 'game_shots' ? 'game_id, n, length(data) AS bytes' : table === 'game_pbp' ? 'game_id, length(data) AS bytes' : '*';
  return db.rows(`SELECT ${cols} FROM ${table} LIMIT ? OFFSET ?`, [Math.min(200, limit), offset]);
}

const ops: Record<string, (a: any) => unknown> = {
  init,
  status,
  newGame: async ({ name, seed }: { name: string; seed: number }) => {
    await snapshot('antes-de-nueva-partida');
    createUniverse(db, { name, seed, id: crypto.randomUUID() });
    return status();
  },
  loadTest: ({ seasons }: { seasons: number }) => loadTest(seasons),
  clubs: () => Q.listClubs(db),
  chooseClub: ({ clubId }: { clubId: number }) => {
    chooseClub(db, clubId);
    return status();
  },
  home: () => Q.home(db),
  advance: ({ mode }: { mode: 'day' | 'week' | 'regular' | 'season' }) => advance(mode),
  newSeason: async () => {
    await snapshot('antes-de-nueva-temporada');
    return startNewSeason(db);
  },
  squad: ({ clubId }: { clubId: number }) => Q.squad(db, clubId, getUniverse(db)!.game_season),
  player: ({ id }: { id: number }) => Q.playerDetail(db, id),
  shotZones: ({ id, season, last }: { id: number; season: number; last?: number }) => Q.shotZones(db, id, season, last),
  schedule: ({ clubId }: { clubId: number }) => Q.clubSchedule(db, clubId, getUniverse(db)!.game_season),
  compDays: ({ comp }: { comp: number }) => Q.compDays(db, getUniverse(db)!.game_season, comp),
  dayGames: ({ comp, day }: { comp: number; day: number }) => Q.dayGames(db, getUniverse(db)!.game_season, comp, day),
  game: ({ id }: { id: number }) => Q.gameDetail(db, id),
  table: ({ comp }: { comp: number }) => Q.leagueTable(db, getUniverse(db)!.game_season, comp),
  leaders: ({ comp, stage }: { comp: number; stage: Q.Stage }) => Q.playerLines(db, getUniverse(db)!.game_season, comp, stage),
  playoffs: ({ comp }: { comp: number }) => Q.playoffs(db, getUniverse(db)!.game_season, comp),
  history: () => Q.history(db),
  exportSave,
  importCheck: ({ bytes }: { bytes: Uint8Array }) => importCheck(bytes),
  importCommit,
  importCancel: () => {
    pendingImport = null;
    if (pool.getFileNames().includes(INCOMING)) pool.unlink(INCOMING);
    return status();
  },
  snapshotNow: async () => {
    await snapshot('manual');
    return status();
  },
  restoreSnapshot: async ({ name }: { name: string }) => {
    if (!listSnapshots().some((s) => s.name === name)) throw new Error('Esa copia ya no existe.');
    const bytes: Uint8Array = pool.exportFile(name);
    await replaceMain(bytes);
    return status();
  },
  inspect: ({ table, limit, offset }: { table: string; limit: number; offset: number }) => inspect(table, limit, offset),
  reset: async () => {
    raw.close();
    await pool.wipeFiles();
    openMain();
    return status();
  },
};

let queue: Promise<unknown> = Promise.resolve();
self.onmessage = (ev: MessageEvent) => {
  const { id, op, args } = ev.data as { id: number; op: string; args: unknown };
  if (op === 'cancel') {
    cancelRequested = true;
    return;
  }
  queue = queue.then(async () => {
    try {
      const fn = ops[op];
      if (!fn) throw new Error(`Operación desconocida: ${op}`);
      const result = await fn(args);
      postMessage({ id, ok: true, result });
    } catch (e) {
      postMessage({ id, ok: false, error: (e as Error).message ?? String(e) });
    }
  });
};
