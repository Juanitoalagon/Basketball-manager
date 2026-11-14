/**
 * Importador de los datos de SuperManagerLab (zip de la carpeta datos/).
 *
 * Qué hay en esos ficheros (comprobado con los del usuario, noviembre de 2026):
 *  - actas_temporada.csv: temporada en curso, una fila por jugador y partido: minutos, valoración (PIR),
 *    puntos SuperManager, equipo, rival, local, resultado.
 *  - historico_acb_v3.csv: lo mismo para la temporada anterior completa.
 *  - valoraciones.csv: nombre completo, nombre corto, código de equipo, posición (Base/Alero/Pivot), cupo y precio.
 *  - previsiones_app.csv: predicción del motor de SuperManagerLab, precio, bróker esperado y media.
 * Qué NO hay: puntos reales, tiros, rebotes, asistencias, edad ni altura.
 *
 * Por eso cada jugador real se crea así:
 *  - Reales: nombre, club, posición general, cupo, minutos y valoración por partido.
 *  - Estimados a partir de lo anterior: nivel general (atributos 1-99), posición concreta, edad, altura,
 *    nacionalidad concreta. Quedan marcados en `player.estimated` y la ficha lo muestra.
 * Las estadísticas reales se guardan aparte (real_game_line) y nunca se suman a las simuladas.
 */
import { strFromU8, unzipSync } from 'fflate';
import { ATTRS, type Pos, generatePlayer, makePotential, overall } from './attributes';
import { generateRoster } from './generate';
import { REAL_CLUBS } from './names';
import { ensureEconomy } from './market';
import { scheduleEurope, setupWorld } from './world';
import { Rng } from './rng';
import { FIRST_SEASON, freeNumber, getUniverse, insertPlayer, scheduleSeason, seasonSetup, type UniverseInfo } from './season';
import { type Db, ENGINE_VERSION, GAME_TABLES, transaction } from './schema';
import { sha256Hex } from './savefile';

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const head = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, '').trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export const norm = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.\-']/g, ' ').replace(/\s+/g, ' ').trim();
/** Quita la fecha que a veces aparece pegada al nombre del equipo ("Unicaja 14 may 2026"). */
const cleanTeam = (s: string) => s.replace(/\s+\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s+\d{4}$/i, '').trim();
const lastName = (s: string) => norm(s).split(' ').filter((w) => w.length > 1).pop() ?? '';
const num = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));

interface GameLine { day: number; game: string; team: string; opp: string; home: boolean; win: boolean; teamPts: number | null; oppPts: number | null; min: number; val: number; sm: number | null; short: string }
export interface RealPlayer {
  key: string;
  short: string;
  name: string;
  team: string;
  code: string | null;
  posGroup: 'Base' | 'Alero' | 'Pivot' | null;
  cupo: string | null;
  cur: GameLine[];
  prev: GameLine[];
  prediction: { day: number; prediction: number | null; horizon: number | null; price: number | null; broker: number | null; avg: number | null } | null;
  quality?: number;
}
export interface RealData {
  files: string[];
  sha256: string;
  teams: { name: string; code: string | null; players: RealPlayer[] }[];
  unmatched: string[];
  prevMatched: number;
  currentDays: number;
}

function lines(rows: Record<string, string>[]): (GameLine & { key: string })[] {
  return rows
    .filter((r) => r.jugador && r.equipo)
    .map((r) => ({
      key: `${norm(r.jugador!)}|${norm(cleanTeam(r.equipo!))}`,
      short: r.jugador!.trim(),
      day: Number(r.jornada),
      game: r.partido ?? '',
      team: cleanTeam(r.equipo!),
      opp: cleanTeam(r.rival ?? ''),
      home: r.local === 'True',
      win: r.gana === 'True',
      teamPts: num(r.tanteo),
      oppPts: num(r.tanteo_rival),
      min: Number(r.minutos) || 0,
      val: Number(r.val) || 0,
      sm: num(r.puntos),
    }));
}

/** Lee el zip y cruza los ficheros. No toca la base de datos. */
export async function readSuperManagerZip(zipBytes: Uint8Array): Promise<RealData> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch {
    throw new Error('No se puede abrir el fichero: tiene que ser el zip de la carpeta «datos» de SuperManagerLab.');
  }
  const byName = new Map(Object.entries(files).map(([p, b]) => [p.split('/').pop()!, b]));
  const read = (n: string) => {
    const b = byName.get(n);
    return b ? parseCsv(strFromU8(b)) : null;
  };
  const actas = read('actas_temporada.csv');
  if (!actas?.length) throw new Error('Falta actas_temporada.csv en el zip (las actas de la temporada en curso).');
  const hist = read('historico_acb_v3.csv') ?? read('historico_acb_v2.csv') ?? read('historico_acb.csv') ?? [];
  const vals = read('valoraciones.csv') ?? [];
  const prevs = read('previsiones_app.csv') ?? [];

  const cur = lines(actas);
  const prev = lines(hist);

  // Fichas de valoraciones.csv: nombre corto -> nombre completo, código de equipo, posición y cupo.
  const vByShort = new Map<string, Record<string, string>[]>();
  const vByLast = new Map<string, Record<string, string>[]>();
  for (const v of vals) {
    if (!v.corto) continue;
    const k = norm(v.corto);
    if (!vByShort.get(k)?.some((x) => x.jugador === v.jugador)) (vByShort.get(k) ?? vByShort.set(k, []).get(k)!).push(v);
    const l = lastName(v.jugador ?? v.corto);
    if (!vByLast.get(l)?.some((x) => x.jugador === v.jugador)) (vByLast.get(l) ?? vByLast.set(l, []).get(l)!).push(v);
  }
  // Código de cada equipo (UNI, RMA...) por coincidencia de jugadores.
  const votes = new Map<string, Map<string, number>>();
  for (const l of cur) {
    for (const v of vByShort.get(norm(l.short)) ?? []) {
      const m = votes.get(l.team) ?? votes.set(l.team, new Map()).get(l.team)!;
      m.set(v.equipo!, (m.get(v.equipo!) ?? 0) + 1);
    }
  }
  const codeOf = new Map([...votes].map(([team, m]) => [team, [...m].sort((a, b) => b[1] - a[1])[0]![0]]));

  const players = new Map<string, RealPlayer>();
  for (const l of cur) {
    let p = players.get(l.key);
    if (!p) {
      p = { key: l.key, short: l.short, name: l.short, team: l.team, code: codeOf.get(l.team) ?? null, posGroup: null, cupo: null, cur: [], prev: [], prediction: null };
      players.set(l.key, p);
    }
    p.team = l.team; // el último equipo en el que jugó
    p.cur.push(l);
  }
  const unmatched: string[] = [];
  for (const p of players.values()) {
    const code = codeOf.get(p.team);
    let cand = vByShort.get(norm(p.short)) ?? [];
    if (cand.length !== 1) {
      const sameTeam = (cand.length ? cand : vByLast.get(lastName(p.short)) ?? []).filter((v) => v.equipo === code);
      cand = sameTeam.length === 1 ? sameTeam : cand.length === 1 ? cand : [];
    }
    const v = cand[0];
    if (v) {
      p.name = v.jugador ?? p.short;
      p.posGroup = (v.posicion === 'Base' || v.posicion === 'Alero' || v.posicion === 'Pivot' ? v.posicion : null) as RealPlayer['posGroup'];
      p.cupo = v.cupo || null;
    } else unmatched.push(`${p.short} (${p.team})`);
  }
  // Temporada anterior: se enlaza por nombre corto; si el nombre corto no es único, no se enlaza.
  const shortCount = new Map<string, number>();
  for (const p of players.values()) shortCount.set(norm(p.short), (shortCount.get(norm(p.short)) ?? 0) + 1);
  const byShort = new Map([...players.values()].filter((p) => shortCount.get(norm(p.short)) === 1).map((p) => [norm(p.short), p]));
  let prevMatched = 0;
  for (const l of prev) {
    const p = byShort.get(norm(l.short));
    if (p) {
      if (!p.prev.length) prevMatched++;
      p.prev.push(l);
    }
  }
  // Predicciones: por nombre completo normalizado; se queda la jornada más reciente.
  const byFull = new Map([...players.values()].map((p) => [norm(p.name), p]));
  for (const r of prevs) {
    const p = byFull.get(norm(r.jugador ?? '')) ?? byFull.get(r.k ?? '');
    if (!p) continue;
    const day = Number(r.jornada) || 0;
    if (p.prediction && p.prediction.day > day) continue;
    p.prediction = { day, prediction: num(r.prevision), horizon: num(r.prev_horizonte), price: num(r.precio), broker: num(r.broker_esp), avg: num(r.media) };
  }
  const teams = [...new Set([...players.values()].map((p) => p.team))].sort().map((name) => ({
    name,
    code: codeOf.get(name) ?? null,
    players: [...players.values()].filter((p) => p.team === name),
  }));
  return {
    files: [...byName.keys()].filter((n) => n.endsWith('.csv')),
    sha256: await sha256Hex(zipBytes),
    teams,
    unmatched,
    prevMatched,
    currentDays: new Set(cur.map((l) => l.day)).size,
  };
}

/**
 * Nivel estimado de cada jugador real (en la escala del generador: la ACB tiene media ≈ 61).
 * valoración por 40 minutos encogida hacia la media de su grupo de posición según minutos jugados
 * (con 300 minutos pesa la mitad su dato y la mitad la media), combinada con minutos por partido
 * (los entrenadores dan más minutos a los mejores). Temporada anterior con la mitad de peso.
 */
export function estimateQuality(data: RealData): void {
  const all = data.teams.flatMap((t) => t.players);
  const agg = (p: RealPlayer) => {
    const w = (ls: GameLine[], k: number) => ls.reduce((a, l) => ({ min: a.min + l.min * k, val: a.val + l.val * k, gp: a.gp + (l.min > 0 ? k : 0) }), { min: 0, val: 0, gp: 0 });
    const a = w(p.cur, 1);
    const b = w(p.prev, 0.5);
    return { min: a.min + b.min, val: a.val + b.val, gp: a.gp + b.gp };
  };
  const stats = all.map((p) => ({ p, ...agg(p) }));
  const groupRate = new Map<string, number>();
  for (const g of ['Base', 'Alero', 'Pivot', 'null']) {
    const xs = stats.filter((s) => String(s.p.posGroup) === g);
    const min = xs.reduce((a, s) => a + s.min, 0);
    groupRate.set(g, min > 0 ? xs.reduce((a, s) => a + s.val, 0) / min : 0.35);
  }
  const M0 = 300;
  const scored = stats.map((s) => {
    const prior = groupRate.get(String(s.p.posGroup)) ?? 0.35;
    const rate = (s.val + M0 * prior * 0.8) / (s.min + M0); // el prior algo por debajo de la media: poco minuto suele ser peor jugador
    const mpg = s.gp > 0 ? s.min / s.gp : 0;
    return { p: s.p, rate, mpg };
  });
  const z = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1;
    return xs.map((x) => (x - m) / sd);
  };
  const zr = z(scored.map((s) => s.rate));
  const zm = z(scored.map((s) => s.mpg));
  scored.forEach((s, i) => {
    const score = 0.6 * zr[i]! + 0.4 * zm[i]!;
    s.p.quality = Math.max(38, Math.min(86, 59 + 7.5 * score));
  });
}


/** Crea un universo con la Liga ACB real (jugadores importados) y la Primera FEB generada. */
export function createRealUniverse(db: Db, data: RealData, opts: { name: string; seed: number; id: string; fileName: string }): UniverseInfo {
  estimateQuality(data);
  const rng = new Rng(opts.seed);
  const season = FIRST_SEASON;
  transaction(db, () => {
    for (const t of GAME_TABLES) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM settings WHERE key <> 'lastExport'");
    db.exec("INSERT INTO universe VALUES (?,?,?,?,?,0,'eleccion',NULL,?)", [opts.id, opts.name, opts.seed, new Date().toISOString(), season, ENGINE_VERSION]);
    db.exec("INSERT INTO competition VALUES (1, 'Liga ACB', 'ACB', 'liga', 'ES', 1), (2, 'Primera FEB', 'FEB', 'liga', 'ES', 2)");
    db.exec('INSERT INTO import_batch (file_name, sha256, origin, imported_at) VALUES (?,?,?,?)', [opts.fileName, data.sha256, 'SuperManagerLab', new Date().toISOString()]);
    const batch = Number(db.rows<{ id: number }>('SELECT last_insert_rowid() AS id')[0]!.id);
    const used = new Set<string>();
    let clubId = 0;
    const estimatedFields = JSON.stringify(['atributos', 'posición concreta', 'edad', 'altura', 'peso']);
    for (const t of data.teams) {
      clubId++;
      const quals = t.players.map((p) => p.quality ?? 55).sort((a, b) => b - a);
      const strength = quals.slice(0, 8).reduce((a, b) => a + b, 0) / Math.min(8, quals.length || 1);
      db.exec('INSERT INTO club (id, name, short, city, country, reputation, budget, competition_id) VALUES (?,?,?,?,?,?,?,?)', [
        clubId, t.name, t.code ?? t.name.slice(0, 3).toUpperCase(), t.name, 'ES', Math.round(40 + (strength - 50) * 2.5),
        Math.round(Math.max(2, (strength - 50) * 0.9) * 1e6), 1,
      ]);
      const nums = new Set<number>();
      // Reparto de posiciones concretas dentro de cada grupo, alternando para cubrir los cinco puestos.
      const alt: Record<string, number> = { Base: 0, Alero: 0, Pivot: 0 };
      for (const p of [...t.players].sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))) {
        const g = p.posGroup ?? rng.pick(['Base', 'Alero', 'Pivot'] as const);
        const i = alt[g]!++;
        const pos: Pos = g === 'Base' ? (i % 3 === 2 ? 'SG' : 'PG') : g === 'Alero' ? (i % 2 ? 'SG' : 'SF') : i % 2 ? 'C' : 'PF';
        // El dato real es el cupo, no el país: se guarda el cupo tal cual.
        const nat = p.cupo === 'nacional' ? 'ES' : p.cupo === 'comunitario' ? 'UE' : p.cupo === 'extracomunitario' ? 'EXT' : '?';
        const age = Math.max(19, Math.min(36, Math.round(27 + (rng.next() + rng.next() - 1) * 6)));
        const np = generatePlayer(rng, { pos, quality: p.quality ?? 55, age, season, nationality: nat, name: p.name });
        np.pos2 = g === 'Base' ? (pos === 'PG' ? 'SG' : 'PG') : g === 'Alero' ? (pos === 'SF' ? 'SG' : 'SF') : pos === 'C' ? 'PF' : 'C';
        // Ajuste fino: que su media sea exactamente el nivel estimado con sus datos reales.
        for (let it = 0; it < 3; it++) {
          const d = Math.round((p.quality ?? 55) - np.ovr);
          if (!d) break;
          for (const a of ATTRS) if (a.group !== 'men') np.attrs[a.key] = Math.max(1, Math.min(99, np.attrs[a.key] + d));
          np.ovr = overall(np.attrs, np.pos1, np.heightCm);
        }
        Object.assign(np, makePotential(rng, np.ovr, age));
        used.add(p.name);
        const pid = insertPlayer(db, np, clubId, freeNumber(rng, nums), season);
        db.exec("UPDATE player SET origin = 'real', ext_ids = ?, estimated = ? WHERE id = ?", [JSON.stringify({ supermanager: p.key, cupo: p.cupo, posicion: p.posGroup }), estimatedFields, pid]);
        const ins = (season: number, l: GameLine) =>
          db.exec('INSERT OR IGNORE INTO real_game_line VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
            batch, season, 'ACB', l.day, l.game || `${l.day}-${l.team}`, pid, l.team, l.opp, l.home ? 1 : 0, l.win ? 1 : 0, l.teamPts, l.oppPts, l.min, l.val, l.sm,
          ]);
        for (const l of p.cur) ins(season, l);
        for (const l of p.prev) ins(season - 1, l);
        if (p.prediction) {
          const r = p.prediction;
          db.exec('INSERT OR REPLACE INTO real_prediction VALUES (?,?,?,?,?,?,?,?,?)', [batch, season, r.day, pid, r.prediction, r.horizon, r.price, r.broker, r.avg]);
        }
      }
    }
    // Primera FEB: 18 clubes generados (no hay datos reales de esa liga).
    REAL_CLUBS.filter((c) => c.tier === 2).forEach((c) => {
      clubId++;
      const strength = c.strength * 0.8 + (rng.next() + rng.next() - 1) * 2.5;
      db.exec('INSERT INTO club (id, name, short, city, country, reputation, budget, competition_id) VALUES (?,?,?,?,?,?,?,?)', [clubId, c.name, c.short, c.city, 'ES', Math.round(40 + c.strength * 4), 0, 2]);
      const nums = new Set<number>();
      for (const p of generateRoster(rng, { tier: 2, season, strength, used })) insertPlayer(db, p, clubId, freeNumber(rng, nums), season);
    });
    scheduleSeason(db, season, opts.seed);
    setupWorld(db);
    scheduleEurope(db, season, opts.seed);
    ensureEconomy(db);
    seasonSetup(db, season, null, new Rng(opts.seed + 4711));
    db.exec("INSERT INTO settings(key, value) VALUES ('revision', '0') ON CONFLICT(key) DO UPDATE SET value = '0'");
    db.exec("INSERT OR REPLACE INTO settings(key, value) VALUES ('econ', '2')");
  });
  return getUniverse(db)!;
}

/** Resumen de lo importado de un jugador real, para su ficha. */
export function realSummary(db: Db, playerId: number) {
  const seasons = db.rows<{ season: number; gp: number; min: number; val: number; sm: number | null; wins: number }>(
    `SELECT season, SUM(min > 0) AS gp, SUM(min) AS min, SUM(val) AS val, AVG(sm_pts) AS sm, SUM(win) AS wins
     FROM real_game_line WHERE player_id = ? GROUP BY season ORDER BY season DESC`,
    [playerId],
  );
  const prediction = db.rows<{ season: number; day: number; prediction: number | null; horizon: number | null; price: number | null; broker: number | null; avg: number | null }>(
    'SELECT season, day, prediction, horizon, price, broker, avg FROM real_prediction WHERE player_id = ? ORDER BY season DESC, day DESC LIMIT 1',
    [playerId],
  )[0] ?? null;
  const last = db.rows<{ season: number; day: number; team: string; opponent: string; home: number; win: number; min: number; val: number; sm_pts: number | null }>(
    'SELECT season, day, team, opponent, home, win, min, val, sm_pts FROM real_game_line WHERE player_id = ? ORDER BY season DESC, day DESC LIMIT 10',
    [playerId],
  );
  const batch = db.rows<{ file_name: string; imported_at: string }>('SELECT file_name, imported_at FROM import_batch ORDER BY id DESC LIMIT 1')[0] ?? null;
  return { seasons, prediction, last, batch };
}
