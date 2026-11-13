/**
 * Universo, calendario, simulación de jornadas, playoffs y paso de temporada.
 * Cada jornada se confirma en UNA transacción: si la app se cierra a mitad, la jornada se repite entera.
 */
import { deflateSync, strToU8 } from 'fflate';
import { ATTR_KEYS, type Attrs, type NewPlayer, type Pos, developAttrs, overall, makePotential } from './attributes';
import { BOX_FIELDS, type EngineTeam, simulateGame } from './engine';
import { ROSTER_SIZE, TIER_QUALITY, generateProspect, generateRoster } from './generate';
import { CLUB_CITIES, clubName } from './names';
import { Rng, mixSeed } from './rng';
import { type Db, ENGINE_VERSION, bumpRevision, transaction } from './schema';

export const FIRST_SEASON = 2026;
export const COMP = { ACB: 1, FEB: 2 } as const;
export const REGULAR_DAYS = 34;
export type Phase = 'eleccion' | 'regular' | 'playoffs' | 'fin';

export interface UniverseInfo {
  id: string;
  name: string;
  seed: number;
  created_at: string;
  game_season: number;
  game_day: number;
  phase: Phase;
  user_club_id: number | null;
  engine_version: string;
}

export function getUniverse(db: Db): UniverseInfo | null {
  return db.rows<UniverseInfo>('SELECT * FROM universe LIMIT 1')[0] ?? null;
}

const BOX_COLS = BOX_FIELDS.join(', ');

function insertPlayer(db: Db, p: NewPlayer, clubId: number | null, number: number | null, season: number): number {
  db.exec(
    `INSERT INTO player (name, nationality, birth_year, height_cm, weight_kg, wingspan_cm, hand, pos1, pos2, club_id, number, potential, potential_est, origin)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'generado')`,
    [p.name, p.nationality, p.birthYear, p.heightCm, p.weightKg, p.wingspanCm, p.hand, p.pos1, p.pos2, clubId, number, p.potential, p.potentialEst],
  );
  const id = Number(db.rows<{ id: number }>('SELECT last_insert_rowid() AS id')[0]!.id);
  saveAttrs(db, id, season, p.attrs, p.ovr);
  return id;
}

function saveAttrs(db: Db, playerId: number, season: number, a: Attrs, ovr: number) {
  db.exec(
    `INSERT OR REPLACE INTO player_attributes (player_id, season, ovr, ${ATTR_KEYS.join(', ')}) VALUES (?,?,?,${ATTR_KEYS.map(() => '?').join(',')})`,
    [playerId, season, ovr, ...ATTR_KEYS.map((k) => a[k])],
  );
}

function freeNumber(rng: Rng, used: Set<number>): number {
  for (let i = 0; i < 50; i++) {
    const n = rng.chance(0.6) ? rng.int(0, 25) : rng.int(0, 99);
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return 99;
}

/** Calendario a doble vuelta por el método del círculo. Devuelve [jornada, local, visitante]. */
export function roundRobin(clubIds: number[], rng: Rng): [number, number, number][] {
  const ids = rng.shuffle([...clubIds]);
  if (ids.length % 2) ids.push(-1);
  const n = ids.length;
  const out: [number, number, number][] = [];
  const arr = [...ids];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]!;
      const b = arr[n - 1 - i]!;
      if (a < 0 || b < 0) continue;
      const flip = (r + i) % 2 === 0;
      out.push([r + 1, flip ? a : b, flip ? b : a]);
    }
    arr.splice(1, 0, arr.pop()!);
  }
  const first = out.length;
  for (let k = 0; k < first; k++) {
    const [d, h, a] = out[k]!;
    out.push([d + n - 1, a, h]);
  }
  return out;
}

function scheduleSeason(db: Db, season: number, seed: number) {
  const rng = new Rng(mixSeed(seed, season));
  for (const comp of [COMP.ACB, COMP.FEB]) {
    const clubs = db.rows<{ id: number }>('SELECT id FROM club WHERE competition_id = ? ORDER BY id', [comp]).map((c) => c.id);
    for (const [day, h, a] of roundRobin(clubs, rng)) {
      db.exec("INSERT INTO game (season, competition_id, stage, day, home_id, away_id, seed, status) VALUES (?,?, 'regular', ?,?,?,?, 'pendiente')", [
        season, comp, day, h, a, rng.int(1, 2 ** 31 - 1),
      ]);
    }
  }
  db.exec("INSERT OR REPLACE INTO season (year, status) VALUES (?, 'en curso')", [season]);
}

/** Crea un universo generado: Liga ACB y Primera FEB con 18 clubes ficticios cada una. */
export function createUniverse(db: Db, opts: { name: string; seed: number; id: string }): UniverseInfo {
  const rng = new Rng(opts.seed);
  const season = FIRST_SEASON;
  transaction(db, () => {
    for (const t of ['shot_zone_stats', 'player_season_stats', 'season_result', 'playoff_series', 'game_pbp', 'game_shots', 'game_player_box', 'game_team_box', 'game', 'season', 'player_attributes', 'player', 'club', 'competition', 'universe', 'import_batch']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec("DELETE FROM settings WHERE key <> 'lastExport'");
    db.exec("INSERT INTO universe VALUES (?,?,?,?,?,0,'eleccion',NULL,?)", [opts.id, opts.name, opts.seed, new Date().toISOString(), season, ENGINE_VERSION]);
    db.exec("INSERT INTO competition VALUES (1, 'Liga ACB', 'ACB', 'liga', 'ES', 1), (2, 'Primera FEB', 'FEB', 'liga', 'ES', 2)");
    const used = new Set<string>();
    CLUB_CITIES.forEach(([city, short], i) => {
      const tier = i < 18 ? 1 : 2;
      const strength = (rng.next() + rng.next() - 1) * 4 + (tier === 1 ? (17 - i) * 0.12 - 1 : 0);
      const id = i + 1;
      db.exec('INSERT INTO club VALUES (?,?,?,?,?,?,?,?)', [
        id, clubName(rng, city), short, city, 'ES', Math.round(50 + strength * 4 + (tier === 1 ? 20 : 0)),
        Math.round((tier === 1 ? 6 : 1.2) * (1 + strength / 15) * 1e6), tier,
      ]);
      const nums = new Set<number>();
      for (const p of generateRoster(rng, { tier, season, strength, used })) insertPlayer(db, p, id, freeNumber(rng, nums), season);
    });
    scheduleSeason(db, season, opts.seed);
    db.exec("INSERT INTO settings(key, value) VALUES ('revision', '0') ON CONFLICT(key) DO UPDATE SET value = '0'");
  });
  return getUniverse(db)!;
}

export function chooseClub(db: Db, clubId: number) {
  transaction(db, () => {
    db.exec("UPDATE universe SET user_club_id = ?, phase = CASE WHEN phase = 'eleccion' THEN 'regular' ELSE phase END", [clubId]);
    bumpRevision(db);
  });
}

function loadTeam(db: Db, clubId: number, season: number): EngineTeam {
  const rows = db.rows<Record<string, number | string | null>>(
    `SELECT p.id, p.pos1, p.pos2, p.height_cm, a.* FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC LIMIT 13`,
    [season, clubId],
  );
  return {
    clubId,
    players: rows.map((r) => ({
      id: Number(r.id),
      pos1: r.pos1 as Pos,
      pos2: (r.pos2 as Pos | null) ?? null,
      height_cm: Number(r.height_cm),
      attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs,
    })),
  };
}

export interface DayReport {
  season: number;
  day: number;
  stage: string;
  games: number;
  userGame: { id: number; home: string; away: string; homePts: number; awayPts: number } | null;
  events: string[];
  seasonOver: boolean;
}

/** Simula la siguiente jornada con partidos pendientes (creando playoffs cuando toca). */
export function advanceDay(db: Db): DayReport {
  const u = getUniverse(db);
  if (!u) throw new Error('No hay partida.');
  if (u.phase === 'eleccion') throw new Error('Primero elige tu club.');
  if (u.phase === 'fin') throw new Error('La temporada ha terminado. Empieza la siguiente desde Inicio.');
  const season = u.game_season;
  const events: string[] = [];

  return transaction(db, () => {
    let next = db.rows<{ d: number | null }>("SELECT MIN(day) AS d FROM game WHERE season = ? AND status = 'pendiente'", [season])[0]?.d ?? null;
    if (next === null && u.phase === 'regular') {
      events.push(...closeRegularSeason(db, season));
      db.exec("UPDATE universe SET phase = 'playoffs'");
      next = db.rows<{ d: number | null }>("SELECT MIN(day) AS d FROM game WHERE season = ? AND status = 'pendiente'", [season])[0]?.d ?? null;
    }
    if (next === null) throw new Error('No quedan partidos pendientes.');

    const games = db.rows<{ id: number; competition_id: number; stage: string; home_id: number; away_id: number; seed: number; series_id: number | null }>(
      "SELECT id, competition_id, stage, home_id, away_id, seed, series_id FROM game WHERE season = ? AND day = ? AND status = 'pendiente' ORDER BY id",
      [season, next],
    );
    let userGame: DayReport['userGame'] = null;
    const names = new Map(db.rows<{ id: number; name: string }>('SELECT id, name FROM club').map((c) => [c.id, c.name]));
    for (const g of games) {
      const isUser = g.home_id === u.user_club_id || g.away_id === u.user_club_id;
      const r = simulateGame(loadTeam(db, g.home_id, season), loadTeam(db, g.away_id, season), mixSeed(u.seed, g.seed), { pbp: isUser });
      saveGame(db, g, season, r);
      if (isUser) userGame = { id: g.id, home: names.get(g.home_id)!, away: names.get(g.away_id)!, homePts: r.score[0], awayPts: r.score[1] };
      if (g.series_id) updateSeries(db, g.series_id, r.score[0] > r.score[1] ? g.home_id : g.away_id);
    }
    const stage = games[0]?.stage ?? 'regular';
    let seasonOver = false;
    if (stage === 'playoffs') {
      const res = schedulePlayoffs(db, season, next + 1, u.seed);
      events.push(...res.events);
      if (res.finished) {
        db.exec("UPDATE universe SET phase = 'fin'");
        db.exec("UPDATE season SET status = 'cerrada' WHERE year = ?", [season]);
        seasonOver = true;
      }
    }
    db.exec('UPDATE universe SET game_day = ?', [next]);
    bumpRevision(db);
    return { season, day: next, stage, games: games.length, userGame, events, seasonOver };
  });
}

type GameRow = { id: number; competition_id: number; stage: string; home_id: number; away_id: number };

function saveGame(db: Db, g: GameRow, season: number, r: ReturnType<typeof simulateGame>) {
  db.exec("UPDATE game SET home_pts = ?, away_pts = ?, ot = ?, engine_version = ?, status = 'jugado' WHERE id = ?", [r.score[0], r.score[1], r.ot, ENGINE_VERSION, g.id]);
  const clubOf = (side: 0 | 1) => (side === 0 ? g.home_id : g.away_id);
  const team: [number[], number[]] = [new Array(BOX_FIELDS.length).fill(0), new Array(BOX_FIELDS.length).fill(0)];
  for (const [pid, b] of r.box) {
    const side = r.side.get(pid)!;
    b.forEach((v, i) => (team[side][i]! += v));
    if (b[0]! <= 0) continue; // no jugó
    const gs = r.starters.has(pid) ? 1 : 0;
    db.exec(`INSERT INTO game_player_box (game_id, player_id, club_id, gs, ${BOX_COLS}) VALUES (?,?,?,?,${BOX_FIELDS.map(() => '?').join(',')})`, [g.id, pid, clubOf(side), gs, ...b]);
    db.exec(
      `INSERT INTO player_season_stats (season, competition_id, stage, player_id, club_id, source, gp, gs, ${BOX_COLS})
       VALUES (?,?,?,?,?, 'sim', 1, ?, ${BOX_FIELDS.map(() => '?').join(',')})
       ON CONFLICT(season, competition_id, stage, player_id, club_id, source) DO UPDATE SET
       gp = gp + 1, gs = gs + excluded.gs, ${BOX_FIELDS.map((f) => `${f} = ${f} + excluded.${f}`).join(', ')}`,
      [season, g.competition_id, g.stage, pid, clubOf(side), gs, ...b],
    );
  }
  for (const side of [0, 1] as const) {
    team[side][BOX_FIELDS.indexOf('pm')] = (side === 0 ? 1 : -1) * (r.score[0] - r.score[1]);
    db.exec(`INSERT INTO game_team_box (game_id, club_id, poss, ${BOX_COLS}) VALUES (?,?,?,${BOX_FIELDS.map(() => '?').join(',')})`, [g.id, clubOf(side), r.poss[side], ...team[side]]);
  }
  const shotData = new Int32Array(r.shots);
  db.exec('INSERT INTO game_shots (game_id, n, data) VALUES (?,?,?)', [g.id, r.shots.length / 4, new Uint8Array(shotData.buffer)]);
  const zones = new Map<string, [number, number]>();
  for (let i = 0; i < r.shots.length; i += 4) {
    const key = `${r.shots[i]}:${r.shots[i + 3]! & 15}`;
    const z = zones.get(key) ?? zones.set(key, [0, 0]).get(key)!;
    z[0] += 1;
    if (r.shots[i + 3]! & 16) z[1] += 1;
  }
  for (const [key, [fga, fgm]] of zones) {
    const [pid, zone] = key.split(':').map(Number);
    db.exec(
      'INSERT INTO shot_zone_stats VALUES (?,?,?,?,?,?) ON CONFLICT(season, competition_id, player_id, zone) DO UPDATE SET fga = fga + excluded.fga, fgm = fgm + excluded.fgm',
      [season, g.competition_id, pid, zone, fga, fgm],
    );
  }
  if (r.pbp) db.exec('INSERT INTO game_pbp (game_id, data) VALUES (?,?)', [g.id, deflateSync(strToU8(JSON.stringify(r.pbp)))]);
}

export interface StandingRow {
  club_id: number;
  name: string;
  short: string;
  gp: number;
  w: number;
  l: number;
  pf: number;
  pa: number;
}

/** Clasificación de la fase regular: victorias, después diferencia de puntos. */
export function standings(db: Db, season: number, comp: number): StandingRow[] {
  return db.rows<StandingRow>(
    `SELECT c.id AS club_id, c.name, c.short,
       COUNT(g.id) AS gp,
       COALESCE(SUM(CASE WHEN (g.home_id = c.id AND g.home_pts > g.away_pts) OR (g.away_id = c.id AND g.away_pts > g.home_pts) THEN 1 ELSE 0 END), 0) AS w,
       COALESCE(SUM(CASE WHEN (g.home_id = c.id AND g.home_pts < g.away_pts) OR (g.away_id = c.id AND g.away_pts < g.home_pts) THEN 1 ELSE 0 END), 0) AS l,
       COALESCE(SUM(CASE WHEN g.home_id = c.id THEN g.home_pts ELSE g.away_pts END), 0) AS pf,
       COALESCE(SUM(CASE WHEN g.home_id = c.id THEN g.away_pts ELSE g.home_pts END), 0) AS pa
     FROM club c
     LEFT JOIN game g ON g.season = ? AND g.competition_id = ? AND g.stage = 'regular' AND g.status = 'jugado' AND (g.home_id = c.id OR g.away_id = c.id)
     WHERE c.id IN (SELECT home_id FROM game WHERE season = ? AND competition_id = ? AND stage = 'regular')
     GROUP BY c.id ORDER BY w DESC, (pf - pa) DESC, pf DESC`,
    [season, comp, season, comp],
  );
}

/** Al acabar la fase regular: campeón de la FEB y cruces de cuartos de la ACB (1-8, 4-5, 2-7, 3-6). */
function closeRegularSeason(db: Db, season: number): string[] {
  const ev: string[] = [];
  const feb = standings(db, season, COMP.FEB);
  db.exec('INSERT OR REPLACE INTO season_result (season, competition_id, champion_id, regular_first_id) VALUES (?,?,?,?)', [season, COMP.FEB, feb[0]!.club_id, feb[0]!.club_id]);
  ev.push(`${feb[0]!.name} gana la Primera FEB y asciende.`);
  const acb = standings(db, season, COMP.ACB);
  db.exec('INSERT OR REPLACE INTO season_result (season, competition_id, regular_first_id) VALUES (?,?,?)', [season, COMP.ACB, acb[0]!.club_id]);
  ev.push(`${acb[0]!.name} acaba líder de la fase regular de la ACB. Empiezan los playoffs.`);
  const pairs = [[1, 8], [4, 5], [2, 7], [3, 6]];
  pairs.forEach(([hi, lo], slot) => {
    db.exec('INSERT INTO playoff_series (season, competition_id, round, slot, high_id, low_id, high_seed, low_seed, best_of) VALUES (?,?,1,?,?,?,?,?,3)', [
      season, COMP.ACB, slot, acb[hi! - 1]!.club_id, acb[lo! - 1]!.club_id, hi, lo,
    ]);
  });
  const lastDay = db.rows<{ d: number }>('SELECT MAX(day) AS d FROM game WHERE season = ?', [season])[0]!.d;
  const u = getUniverse(db)!;
  schedulePlayoffs(db, season, lastDay + 1, u.seed);
  return ev;
}

function updateSeries(db: Db, seriesId: number, winnerClub: number) {
  const s = db.rows<{ high_id: number; best_of: number; high_wins: number; low_wins: number; low_id: number }>('SELECT * FROM playoff_series WHERE id = ?', [seriesId])[0]!;
  const hw = s.high_wins + (winnerClub === s.high_id ? 1 : 0);
  const lw = s.low_wins + (winnerClub === s.low_id ? 1 : 0);
  const need = Math.ceil(s.best_of / 2);
  db.exec('UPDATE playoff_series SET high_wins = ?, low_wins = ?, winner_id = ? WHERE id = ?', [hw, lw, hw >= need ? s.high_id : lw >= need ? s.low_id : null, seriesId]);
}

const ROUND_NAME: Record<number, string> = { 1: 'cuartos de final', 2: 'semifinales', 3: 'final' };

/** Programa los partidos del día indicado y crea la ronda siguiente cuando se cierra una. */
function schedulePlayoffs(db: Db, season: number, day: number, seed: number): { finished: boolean; events: string[] } {
  const events: string[] = [];
  type S = { id: number; round: number; slot: number; high_id: number; low_id: number; high_seed: number; low_seed: number; best_of: number; high_wins: number; low_wins: number; winner_id: number | null };
  const all = db.rows<S>('SELECT * FROM playoff_series WHERE season = ? AND competition_id = ? ORDER BY round, slot', [season, COMP.ACB]);
  const round = Math.max(...all.map((s) => s.round));
  const current = all.filter((s) => s.round === round);
  const names = new Map(db.rows<{ id: number; name: string }>('SELECT id, name FROM club').map((c) => [c.id, c.name]));
  const rng = new Rng(mixSeed(seed, season * 100 + day));
  if (current.every((s) => s.winner_id)) {
    // Solo se anuncia lo que se cerró en esta jornada.
    for (const s of current) {
      const decided = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE series_id = ? AND day = ?", [s.id, day - 1])[0]!.n > 0;
      if (decided && round < 3) events.push(`${names.get(s.winner_id!)} pasa ${round === 1 ? 'a semifinales' : 'a la final'}.`);
    }
    if (round === 3) {
      const f = current[0]!;
      const loser = f.winner_id === f.high_id ? f.low_id : f.high_id;
      db.exec('UPDATE season_result SET champion_id = ?, runner_up_id = ? WHERE season = ? AND competition_id = ?', [f.winner_id, loser, season, COMP.ACB]);
      events.push(`${names.get(f.winner_id!)} es campeón de la Liga ACB.`);
      return { finished: true, events };
    }
    const winners = current.map((s) => ({ id: s.winner_id!, seed: s.winner_id === s.high_id ? s.high_seed : s.low_seed }));
    for (let k = 0; k < winners.length / 2; k++) {
      const [a, b] = [winners[2 * k]!, winners[2 * k + 1]!].sort((x, y) => x.seed - y.seed);
      db.exec('INSERT INTO playoff_series (season, competition_id, round, slot, high_id, low_id, high_seed, low_seed, best_of) VALUES (?,?,?,?,?,?,?,?,5)', [
        season, COMP.ACB, round + 1, k, a!.id, b!.id, a!.seed, b!.seed,
      ]);
    }
    return schedulePlayoffs(db, season, day, seed);
  }
  for (const s of current) {
    if (s.winner_id) {
      const decided = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM game WHERE series_id = ? AND day = ?', [s.id, day - 1])[0]!.n > 0;
      if (decided) events.push(`${names.get(s.winner_id)} gana su eliminatoria de ${ROUND_NAME[round]}.`);
      continue;
    }
    const played = s.high_wins + s.low_wins;
    // Mejor de 3: 1º y 3º en casa del mejor clasificado. Mejor de 5: 1º, 2º y 5º.
    const highHome = s.best_of === 3 ? played !== 1 : played <= 1 || played === 4;
    const exists = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE series_id = ? AND status = 'pendiente'", [s.id])[0]!.n;
    if (exists) continue;
    db.exec("INSERT INTO game (season, competition_id, stage, day, series_id, home_id, away_id, seed, status) VALUES (?,?, 'playoffs', ?,?,?,?,?, 'pendiente')", [
      season, COMP.ACB, day, s.id, highHome ? s.high_id : s.low_id, highHome ? s.low_id : s.high_id, rng.int(1, 2 ** 31 - 1),
    ]);
  }
  return { finished: false, events };
}

/** Nueva temporada: evolución, retiradas, cantera, ascenso y descenso, y calendario nuevo. */
export function startNewSeason(db: Db): { season: number; retired: number; prospects: number; events: string[] } {
  const u = getUniverse(db)!;
  if (u.phase !== 'fin') throw new Error('La temporada todavía no ha terminado.');
  const old = u.game_season;
  const season = old + 1;
  const rng = new Rng(mixSeed(u.seed, season * 7919));
  const events: string[] = [];
  let retired = 0;
  let prospects = 0;
  return transaction(db, () => {
    // Ascenso y descenso directo: último de la ACB por el primero de la FEB.
    const acb = standings(db, old, COMP.ACB);
    const feb = standings(db, old, COMP.FEB);
    const down = acb[acb.length - 1]!;
    const up = feb[0]!;
    db.exec('UPDATE club SET competition_id = ? WHERE id = ?', [COMP.FEB, down.club_id]);
    db.exec('UPDATE club SET competition_id = ? WHERE id = ?', [COMP.ACB, up.club_id]);
    events.push(`${up.name} sube a la ACB; ${down.name} baja a la Primera FEB.`);

    const players = db.rows<Record<string, number | string | null>>(
      `SELECT p.id, p.birth_year, p.pos1, p.height_cm, p.potential, p.club_id, a.* FROM player p
       JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.retired = 0`,
      [old],
    );
    for (const r of players) {
      const age = season - Number(r.birth_year);
      const ovr = Number(r.ovr);
      const tier = Number(db.rows<{ t: number | null }>('SELECT competition_id AS t FROM club WHERE id = ?', [r.club_id])[0]?.t ?? 2);
      const retireP = age >= 38 ? 1 : age >= 34 ? 0.25 + (age - 34) * 0.15 : age >= 31 && ovr < TIER_QUALITY[2]! - 8 ? 0.3 : 0;
      if (rng.chance(retireP)) {
        db.exec('UPDATE player SET retired = 1, club_id = NULL WHERE id = ?', [r.id]);
        retired++;
        continue;
      }
      void tier;
      const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs;
      const next = developAttrs(rng, attrs, age, ovr, Number(r.potential));
      const nOvr = overall(next, r.pos1 as Pos, Number(r.height_cm));
      saveAttrs(db, Number(r.id), season, next, nOvr);
      const pot = age >= 27 ? nOvr : Math.max(nOvr, Number(r.potential));
      const est = makePotential(rng, nOvr, age);
      db.exec('UPDATE player SET potential = ?, potential_est = ? WHERE id = ?', [pot, Math.max(nOvr, Math.round((est.potentialEst + pot) / 2)), r.id]);
    }
    // Rellenar plantillas con jóvenes de cantera.
    const used = new Set(db.rows<{ name: string }>('SELECT name FROM player').map((p) => p.name));
    for (const c of db.rows<{ id: number; competition_id: number }>('SELECT id, competition_id FROM club')) {
      const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND retired = 0', [c.id]).map((x) => x.number));
      let n = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [c.id])[0]!.n;
      while (n < ROSTER_SIZE) {
        insertPlayer(db, generateProspect(rng, { tier: c.competition_id, season, used }), c.id, freeNumber(rng, nums), season);
        n++;
        prospects++;
      }
    }
    scheduleSeason(db, season, u.seed);
    db.exec("UPDATE universe SET game_season = ?, game_day = 0, phase = 'regular'", [season]);
    bumpRevision(db);
    events.push(`${retired} jugadores se retiran y ${prospects} jóvenes suben de las canteras.`);
    return { season, retired, prospects, events };
  });
}
