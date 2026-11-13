/**
 * Universo, calendario, simulación de jornadas, playoffs y paso de temporada.
 * Cada jornada se confirma en UNA transacción: si la app se cierra a mitad, la jornada se repite entera.
 */
import { deflateSync, strToU8 } from 'fflate';
import { ATTR_KEYS, type Attrs, type NewPlayer, type Pos, developAttrs, overall, makePotential } from './attributes';
import { BOX_FIELDS, type EngineTeam, type Intervention, type Level, type Role, type Tactics, type TendKey, simulateGame } from './engine';
import { ROSTER_SIZE, TIER_QUALITY, generateProspect, generateRoster } from './generate';
import { REAL_CLUBS } from './names';
import { computeAwards } from './awards';
import { addFreeAgents, addNews, assignClauses, ensureEconomy, offseason, rookieContract } from './market';
import { INTENSITY, aiFillNeeds, positionNeeds, afterDay, fixRosterCupos, getTraining, scheduleEurope, setupWorld, trainingBonus, youthOffseason } from './world';
import { Rng, mixSeed } from './rng';
import { type Db, ENGINE_VERSION, GAME_TABLES, bumpRevision, transaction } from './schema';

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

export function insertPlayer(db: Db, p: NewPlayer, clubId: number | null, number: number | null, season: number): number {
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

export function freeNumber(rng: Rng, used: Set<number>): number {
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

export function scheduleSeason(db: Db, season: number, seed: number) {
  const rng = new Rng(mixSeed(seed, season));
  for (const comp of [COMP.ACB, COMP.FEB]) {
    const clubs = db.rows<{ id: number }>('SELECT id FROM club WHERE competition_id = ? ORDER BY id', [comp]).map((c) => c.id);
    for (const [day, h, a] of roundRobin(clubs, rng)) {
      db.exec("INSERT INTO game (season, competition_id, stage, day, round, home_id, away_id, seed, status) VALUES (?,?, 'regular', ?,?,?,?,?, 'pendiente')", [
        season, comp, day, day, h, a, rng.int(1, 2 ** 31 - 1),
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
    for (const t of GAME_TABLES) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM settings WHERE key <> 'lastExport'");
    db.exec("INSERT INTO universe VALUES (?,?,?,?,?,0,'eleccion',NULL,?)", [opts.id, opts.name, opts.seed, new Date().toISOString(), season, ENGINE_VERSION]);
    db.exec("INSERT INTO competition VALUES (1, 'Liga ACB', 'ACB', 'liga', 'ES', 1), (2, 'Primera FEB', 'FEB', 'liga', 'ES', 2)");
    const used = new Set<string>();
    REAL_CLUBS.forEach((c, i) => {
      const strength = c.strength * 0.8 + (rng.next() + rng.next() - 1) * 2.5;
      const id = i + 1;
      db.exec('INSERT INTO club (id, name, short, city, country, reputation, budget, competition_id, cash) VALUES (?,?,?,?,?,?,?,?,?)', [
        id, c.name, c.short, c.city, 'ES', Math.round(50 + c.strength * 5 + (c.tier === 1 ? 20 : 0)), 0, c.tier, 0,
      ]);
      const nums = new Set<number>();
      const roster = generateRoster(rng, { tier: c.tier, season, strength, used });
      fixRosterCupos(rng, roster, used);
      for (const p of roster) insertPlayer(db, p, id, freeNumber(rng, nums), season);
    });
    scheduleSeason(db, season, opts.seed);
    setupWorld(db);
    scheduleEurope(db, season, opts.seed);
    ensureEconomy(db);
    db.exec("INSERT INTO settings(key, value) VALUES ('revision', '0') ON CONFLICT(key) DO UPDATE SET value = '0'");
  });
  return getUniverse(db)!;
}

/** Quinteto y roles del club del usuario. starters: un jugador por hueco (PG..C) o null = automático. */
export function setLineup(db: Db, clubId: number, starters: (number | null)[], roles: Record<number, Role>, shoot: Record<number, Level> = {}, tactics?: Tactics) {
  const ids = starters.filter((x): x is number => x !== null);
  if (new Set(ids).size !== ids.length) throw new Error('Un jugador no puede ocupar dos huecos del quinteto.');
  transaction(db, () => {
    db.exec('DELETE FROM lineup WHERE club_id = ?', [clubId]);
    const roster = db.rows<{ id: number }>('SELECT id FROM player WHERE club_id = ? AND retired = 0', [clubId]).map((r) => r.id);
    for (const pid of roster) {
      const slot = starters.indexOf(pid);
      const role = slot >= 0 ? 'rot' : (roles[pid] ?? 'rot');
      const sh = shoot[pid] ?? 'normal';
      if (slot >= 0 || role !== 'rot' || sh !== 'normal') {
        db.exec('INSERT INTO lineup (club_id, player_id, slot, role, shoot) VALUES (?,?,?,?,?)', [clubId, pid, slot >= 0 ? slot : null, role, sh]);
      }
    }
    if (tactics) db.exec('INSERT OR REPLACE INTO tactics (club_id, data) VALUES (?,?)', [clubId, JSON.stringify(tactics)]);
    bumpRevision(db);
  });
}

export function chooseClub(db: Db, clubId: number) {
  transaction(db, () => {
    db.exec("UPDATE universe SET user_club_id = ?, phase = CASE WHEN phase = 'eleccion' THEN 'regular' ELSE phase END", [clubId]);
    bumpRevision(db);
  });
}

function loadTeam(db: Db, clubId: number, season: number): EngineTeam {
  const rows = db.rows<Record<string, number | string | null>>(
    `SELECT p.id, p.pos1, p.pos2, p.height_cm, p.morale, a.* FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     WHERE p.club_id = ? AND p.retired = 0 AND p.injury_games = 0 ORDER BY a.ovr DESC LIMIT 16`,
    [season, clubId],
  );
  const lu = db.rows<{ player_id: number; slot: number | null; role: Role; shoot: Level }>('SELECT player_id, slot, role, shoot FROM lineup WHERE club_id = ?', [clubId]);
  const tac = db.rows<{ data: string }>('SELECT data FROM tactics WHERE club_id = ?', [clubId])[0];
  const ids = new Set(rows.map((r) => Number(r.id)));
  const mine = lu.filter((l) => ids.has(l.player_id));
  const starters: (number | null)[] = [null, null, null, null, null];
  for (const l of mine) if (l.slot !== null && l.slot >= 0 && l.slot < 5) starters[l.slot] = l.player_id;
  // Tendencias ajustadas por el entrenador.
  const tend = new Map<number, Partial<Record<TendKey, number>>>();
  for (const t of db.rows<{ player_id: number; key: TendKey; value: number }>(
    'SELECT t.player_id, t.key, t.value FROM player_tendency t JOIN player p ON p.id = t.player_id WHERE p.club_id = ?',
    [clubId],
  )) (tend.get(t.player_id) ?? tend.set(t.player_id, {}).get(t.player_id)!)[t.key] = t.value;
  return {
    clubId,
    lineup: mine.length ? { starters, roles: Object.fromEntries(mine.map((l) => [l.player_id, l.role])), shoot: Object.fromEntries(mine.map((l) => [l.player_id, l.shoot])) } : undefined,
    tactics: tac ? (JSON.parse(tac.data) as Tactics) : undefined,
    players: rows.map((r) => ({
      id: Number(r.id),
      pos1: r.pos1 as Pos,
      pos2: (r.pos2 as Pos | null) ?? null,
      height_cm: Number(r.height_cm),
      morale: Number(r.morale),
      attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs,
      tend: tend.get(Number(r.id)),
    })),
  };
}

export interface DayReport {
  season: number;
  day: number;
  stage: string;
  games: number;
  userGame: { id: number; home: string; away: string; homePts: number; awayPts: number; comp: number } | null;
  userGames?: { id: number; home: string; away: string; homePts: number; awayPts: number; comp: number }[];
  events: string[];
  seasonOver: boolean;
}

/**
 * Partido en directo: el próximo partido del usuario si se juega en la siguiente jornada.
 * Devuelve las mismas plantillas y semilla que usará advanceDay, así el resultado coincide.
 */
export function prepareLive(db: Db, gameId?: number) {
  const u = getUniverse(db);
  if (!u || !u.user_club_id || (u.phase !== 'regular' && u.phase !== 'playoffs')) return null;
  const next = db.rows<{ d: number | null }>("SELECT MIN(day) AS d FROM game WHERE season = ? AND status = 'pendiente'", [u.game_season])[0]?.d ?? null;
  if (next === null) return null;
  const options = db.rows<{ id: number; seed: number; home_id: number; away_id: number; stage: string; day: number; competition_id: number }>(
    "SELECT id, seed, home_id, away_id, stage, day, competition_id FROM game WHERE season = ? AND day = ? AND status = 'pendiente' AND (home_id = ? OR away_id = ?) ORDER BY competition_id",
    [u.game_season, next, u.user_club_id, u.user_club_id],
  );
  const g = options.find((x) => x.id === gameId) ?? options[0];
  if (!g) return null;
  const home = loadTeam(db, g.home_id, u.game_season);
  const away = loadTeam(db, g.away_id, u.game_season);
  const ids = [...home.players, ...away.players].map((p) => p.id);
  const people = db.rows<{ id: number; name: string; number: number | null; pos1: string; ovr: number; nationality: string; birth_year: number; origin: string }>(
    `SELECT p.id, p.name, p.number, p.pos1, a.ovr, p.nationality, p.birth_year, p.origin FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.id IN (${ids.join(',') || 0})`,
    [u.game_season],
  );
  const clubs = db.rows<{ id: number; name: string; short: string; colors: string | null }>('SELECT id, name, short, colors FROM club WHERE id IN (?, ?)', [g.home_id, g.away_id]);
  return { options: options.map((o) => o.id), game: g, seed: mixSeed(u.seed, g.seed), home, away, userSide: (g.home_id === u.user_club_id ? 0 : 1) as 0 | 1, people, clubs };
}

/** Simula la siguiente jornada con partidos pendientes (creando playoffs cuando toca). */
export function advanceDay(db: Db, opts: { interventions?: Intervention[]; liveGameId?: number } = {}): DayReport {
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
    const userGames: NonNullable<DayReport['userGame']>[] = [];
    const names = new Map(db.rows<{ id: number; name: string }>('SELECT id, name FROM club').map((c) => [c.id, c.name]));
    const stagesPlayed = new Set<string>();
    const compsPlayed = new Set<number>();
    // Las órdenes en directo solo valen para el partido que se jugó en directo.
    const liveId = opts.liveGameId ?? games.find((g) => g.home_id === u.user_club_id || g.away_id === u.user_club_id)?.id;
    for (const g of games) {
      const isUser = g.home_id === u.user_club_id || g.away_id === u.user_club_id;
      const r = simulateGame(loadTeam(db, g.home_id, season), loadTeam(db, g.away_id, season), mixSeed(u.seed, g.seed), { pbp: isUser, interventions: isUser && g.id === liveId ? opts.interventions : undefined });
      saveGame(db, g, season, r);
      afterGame(db, g, r, u.user_club_id, mixSeed(u.seed, g.seed + 17));
      stagesPlayed.add(g.stage);
      compsPlayed.add(g.competition_id);
      if (isUser) {
        userGame = { id: g.id, home: names.get(g.home_id)!, away: names.get(g.away_id)!, homePts: r.score[0], awayPts: r.score[1], comp: g.competition_id };
        userGames.push(userGame);
      }
      if (g.series_id) updateSeries(db, g.series_id, r.score[0] > r.score[1] ? g.home_id : g.away_id);
    }
    const stage = games.find((g) => g.competition_id <= 2)?.stage ?? games[0]?.stage ?? 'regular';
    let seasonOver = false;
    events.push(...afterDay(db, season, next, u.seed, stagesPlayed, compsPlayed));
    if (stagesPlayed.has('playoffs')) {
      const res = scheduleKnockout(db, season, COMP.ACB, next + 1, u.seed, next);
      events.push(...res.events);
      if (res.finished) {
        db.exec("UPDATE universe SET phase = 'fin'");
        db.exec("UPDATE season SET status = 'cerrada' WHERE year = ?", [season]);
        events.push(...computeAwards(db, season));
        seasonOver = true;
      }
    }
    db.exec('UPDATE universe SET game_day = ?', [next]);
    bumpRevision(db);
    return { season, day: next, stage, games: games.length, userGame, userGames, events, seasonOver };
  });
}

type GameRow = { id: number; competition_id: number; stage: string; home_id: number; away_id: number };

const INJURIES: [number, number, string][] = [
  // [peso, partidos de baja máximos, nombre]
  [30, 1, 'Molestias musculares'], [22, 2, 'Esguince de tobillo leve'], [15, 4, 'Sobrecarga en el gemelo'],
  [12, 6, 'Rotura fibrilar'], [8, 10, 'Esguince de tobillo grave'], [6, 14, 'Lesión de rodilla'],
  [4, 22, 'Fractura en la mano'], [3, 34, 'Rotura de ligamento'],
];

/**
 * Lesiones y moral tras cada partido.
 * Lesión: probabilidad por partido = 1,5 % · (minutos / 30) · (1,25 − resistencia/200).
 * Moral: +3 al ganar, −3 al perder, ±2 según minutos frente a lo que espera por su nivel en el club,
 * y vuelve poco a poco a 70.
 */
function afterGame(db: Db, g: GameRow, r: ReturnType<typeof simulateGame>, userClub: number | null, seed: number) {
  const rng = new Rng(seed);
  for (const [side, club] of [[0, g.home_id], [1, g.away_id]] as const) {
    const inten = INTENSITY[getTraining(db, club).intensity];
    // Los que ya estaban lesionados cumplen un partido de baja.
    for (const p of db.rows<{ id: number; name: string; injury_games: number }>('SELECT id, name, injury_games FROM player WHERE club_id = ? AND injury_games > 0', [club])) {
      db.exec('UPDATE player SET injury_games = injury_games - 1, injury = CASE WHEN injury_games - 1 = 0 THEN NULL ELSE injury END WHERE id = ?', [p.id]);
      if (p.injury_games === 1 && club === userClub) addNews(db, 'alta', `${p.name} recibe el alta y vuelve a estar disponible.`, club, p.id);
    }
    const won = r.score[side] > r.score[1 - side]!;
    const roster = db.rows<{ id: number; name: string; morale: number; sta: number; ovr: number }>(
      `SELECT p.id, p.name, p.morale, a.sta, a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = (SELECT game_season FROM universe)
       WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC`,
      [club],
    );
    roster.forEach((p, rank) => {
      const box = r.box.get(p.id);
      const min = box ? box[0]! / 60 : 0;
      const expected = rank < 5 ? 26 : rank < 8 ? 16 : rank < 10 ? 8 : 2;
      let m = p.morale + (won ? 3 : -3) + Math.max(-2, Math.min(2, (min - expected) / 6)) + inten.morale;
      m += (70 - m) * 0.05;
      db.exec('UPDATE player SET morale = ? WHERE id = ?', [Math.round(Math.max(0, Math.min(100, m))), p.id]);
      if (min > 0 && rng.chance(0.015 * inten.injury * (min / 30) * (1.25 - p.sta / 200))) {
        const total = INJURIES.reduce((a, x) => a + x[0], 0);
        let x = rng.next() * total;
        const inj = INJURIES.find((i) => (x -= i[0]) < 0) ?? INJURIES[0]!;
        const games = rng.int(Math.max(1, Math.ceil(inj[1] / 2)), inj[1]);
        db.exec('UPDATE player SET injury_games = ?, injury = ? WHERE id = ?', [games, inj[2], p.id]);
        if (club === userClub || games >= 10) {
          const cname = db.rows<{ name: string }>('SELECT name FROM club WHERE id = ?', [club])[0]!.name;
          addNews(db, 'lesion', `${p.name} (${cname}): ${inj[2].toLowerCase()}. Baja de ${games} ${games === 1 ? 'partido' : 'partidos'}.`, club, p.id);
        }
      }
    });
  }
}

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
  scheduleKnockout(db, season, COMP.ACB, lastDay + 1, u.seed);
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
const KO_STAGE: Record<number, string> = { 1: 'playoffs', 3: 'copa', 4: 'eliminatoria', 5: 'eliminatoria', 6: 'eliminatoria' };
const COMP_NAME: Record<number, string> = { 1: 'la Liga ACB', 3: 'la Copa del Rey', 4: 'la EuroLeague', 5: 'la EuroCup', 6: 'la Basketball Champions League' };
/** Día del siguiente partido de una eliminatoria: la ACB y la Copa juegan días seguidos; Europa, días 30, 32 y 33. */
export function koNextDay(comp: number, day: number): number {
  if (comp >= 4) return day < 32 ? day + 2 : day + 1;
  return day + 1;
}

/**
 * Eliminatorias (playoffs ACB, Copa y fases finales europeas): programa los partidos del día `day`
 * y crea la ronda siguiente cuando se cierra una. `playedDay` es el día que se acaba de jugar.
 */
export function scheduleKnockout(db: Db, season: number, comp: number, day: number, seed: number, playedDay = day - 1): { finished: boolean; events: string[] } {
  const events: string[] = [];
  type S = { id: number; round: number; slot: number; high_id: number; low_id: number; high_seed: number; low_seed: number; best_of: number; high_wins: number; low_wins: number; winner_id: number | null };
  const all = db.rows<S>('SELECT * FROM playoff_series WHERE season = ? AND competition_id = ? ORDER BY round, slot', [season, comp]);
  if (!all.length) return { finished: false, events };
  const round = Math.max(...all.map((s) => s.round));
  const current = all.filter((s) => s.round === round);
  const names = new Map(db.rows<{ id: number; name: string }>('SELECT id, name FROM club').map((c) => [c.id, c.name]));
  const rng = new Rng(mixSeed(seed, season * 100 + day + comp * 7));
  const decidedToday = (s: S) => db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM game WHERE series_id = ? AND day = ?', [s.id, playedDay])[0]!.n > 0;
  if (current.every((s) => s.winner_id)) {
    if (round === 3) {
      const f = current[0]!;
      const loser = f.winner_id === f.high_id ? f.low_id : f.high_id;
      db.exec('INSERT OR IGNORE INTO season_result (season, competition_id) VALUES (?,?)', [season, comp]);
      db.exec('UPDATE season_result SET champion_id = ?, runner_up_id = ? WHERE season = ? AND competition_id = ?', [f.winner_id, loser, season, comp]);
      if (decidedToday(f)) events.push(`🏆 ${names.get(f.winner_id!)} gana ${COMP_NAME[comp]}.`);
      return { finished: true, events };
    }
    for (const s of current) if (decidedToday(s)) events.push(`${names.get(s.winner_id!)} pasa ${round === 1 ? 'a semifinales' : 'a la final'} de ${COMP_NAME[comp]}.`);
    const winners = current.map((s) => ({ id: s.winner_id!, seed: s.winner_id === s.high_id ? s.high_seed : s.low_seed }));
    const bo = comp === 1 ? 5 : 1;
    for (let k = 0; k < winners.length / 2; k++) {
      const [a, b] = [winners[2 * k]!, winners[2 * k + 1]!].sort((x, y) => x.seed - y.seed);
      db.exec('INSERT INTO playoff_series (season, competition_id, round, slot, high_id, low_id, high_seed, low_seed, best_of) VALUES (?,?,?,?,?,?,?,?,?)', [
        season, comp, round + 1, k, a!.id, b!.id, a!.seed, b!.seed, bo,
      ]);
    }
    return { finished: false, events: [...events, ...scheduleKnockout(db, season, comp, day, seed, -1).events] };
  }
  for (const s of current) {
    if (s.winner_id) {
      if (decidedToday(s) && comp === 1) events.push(`${names.get(s.winner_id)} gana su eliminatoria de ${ROUND_NAME[round]}.`);
      continue;
    }
    const played = s.high_wins + s.low_wins;
    // Mejor de 3: 1º y 3º en casa del mejor clasificado. Mejor de 5: 1º, 2º y 5º. A partido único: casa del mejor (Copa: sede neutral).
    const highHome = s.best_of === 3 ? played !== 1 : s.best_of === 5 ? played <= 1 || played === 4 : true;
    const exists = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE series_id = ? AND status = 'pendiente'", [s.id])[0]!.n;
    if (exists) continue;
    db.exec('INSERT INTO game (season, competition_id, stage, day, series_id, home_id, away_id, seed, status) VALUES (?,?,?,?,?,?,?,?, \'pendiente\')', [
      season, comp, KO_STAGE[comp], day, s.id, highHome ? s.high_id : s.low_id, highHome ? s.low_id : s.high_id, rng.int(1, 2 ** 31 - 1),
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

    const clubTraining = new Map(db.rows<{ id: number; facilities: number }>('SELECT id, facilities FROM club').map((c) => [c.id, { t: getTraining(db, c.id), facilities: c.facilities }]));
    const players = db.rows<Record<string, number | string | null>>(
      `SELECT p.id, p.birth_year, p.pos1, p.height_cm, p.potential, p.club_id, p.youth, a.* FROM player p
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
        db.exec('DELETE FROM lineup WHERE player_id = ?', [r.id]);
        db.exec('DELETE FROM contract WHERE player_id = ?', [r.id]);
        retired++;
        continue;
      }
      void tier;
      const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs;
      let next = developAttrs(rng, attrs, age, ovr, Number(r.potential));
      // Entrenamiento e instalaciones del club (o de la cantera).
      const ct = clubTraining.get(Number(r.club_id ?? r.youth ?? 0));
      if (ct) next = trainingBonus(next, age, ct.t, ct.facilities, rng);
      const nOvr = overall(next, r.pos1 as Pos, Number(r.height_cm));
      saveAttrs(db, Number(r.id), season, next, nOvr);
      const pot = age >= 27 ? nOvr : Math.max(nOvr, Number(r.potential));
      const est = makePotential(rng, nOvr, age);
      db.exec('UPDATE player SET potential = ?, potential_est = ? WHERE id = ?', [pot, Math.max(nOvr, Math.round((est.potentialEst + pot) / 2)), r.id]);
    }
    // Lesiones: el verano cura casi todo.
    db.exec('UPDATE player SET injury_games = MAX(0, injury_games - 12)');
    db.exec('UPDATE player SET injury = NULL WHERE injury_games = 0');
    // Agentes libres que siguen sin equipo también evolucionan (ya lo hicieron arriba si tenían atributos).
    offseason(db, old, season, u.user_club_id, events);
    // Rellenar plantillas con jóvenes de cantera.
    const used = new Set(db.rows<{ name: string }>('SELECT name FROM player').map((p) => p.name));
    for (const c of db.rows<{ id: number; competition_id: number }>('SELECT id, competition_id FROM club')) {
      const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND retired = 0', [c.id]).map((x) => x.number));
      let n = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [c.id])[0]!.n;
      while (n < ROSTER_SIZE) {
        const need = positionNeeds(db, c.id)[0];
        const pid = insertPlayer(db, generateProspect(rng, { tier: c.competition_id ?? 1, season, used, pos: need }), c.id, freeNumber(rng, nums), season);
        rookieContract(db, pid, c.id, season);
        n++;
        prospects++;
      }
    }
    youthOffseason(db, season, u.user_club_id, rng, events);
    aiFillNeeds(db, season, u.user_club_id, rng, events);
    // Que siempre quede un mercado de agentes libres con el que trabajar.
    const left = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id IS NULL AND retired = 0 AND youth = 0')[0]!.n;
    if (left < 35) addFreeAgents(db, rng, 35 - left, season);
    scheduleSeason(db, season, u.seed);
    setupWorld(db);
    scheduleEurope(db, season, u.seed);
    db.exec("UPDATE universe SET game_season = ?, game_day = 0, phase = 'regular'", [season]);
    assignClauses(db);
    bumpRevision(db);
    events.push(`${retired} jugadores se retiran y ${prospects} jóvenes suben de las canteras.`);
    return { season, retired, prospects, events };
  });
}
