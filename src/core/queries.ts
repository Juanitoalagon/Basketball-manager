/** Consultas de lectura para las pantallas. Devuelven objetos simples listos para pintar. */
import { inflateSync, strFromU8 } from 'fflate';
import { ATTR_KEYS, type Attrs, overallAt, type Pos, POSITIONS } from './attributes';
import { BOX_FIELDS } from './engine';
import { COMP, type StandingRow, getUniverse, standings } from './season';
import { type Db } from './schema';
import { type League, type Line, type TeamTotals, astPct, drtg, efg, fourFactors, ortg, pace, pir, rebPct, tovPct, ts, usg, winShares } from './stats';

export type Stage = 'regular' | 'playoffs';
const SUMS = BOX_FIELDS.map((f) => `SUM(${f}) AS ${f}`).join(', ');
const toLine = (r: Record<string, unknown>): Line => {
  const o: Record<string, number> = {};
  for (const f of BOX_FIELDS) o[f] = Number(r[f] ?? 0);
  o.gp = Number(r.gp ?? 0);
  o.gs = Number(r.gs ?? 0);
  return o as unknown as Line;
};

export function compOfClub(db: Db, clubId: number): number {
  return db.rows<{ c: number }>('SELECT competition_id AS c FROM club WHERE id = ?', [clubId])[0]?.c ?? COMP.ACB;
}

/** Totales por equipo (y de su rival) y de la liga, para una temporada, competición y fase. */
export function teamTotals(db: Db, season: number, comp: number, stage: Stage): { teams: Map<number, TeamTotals>; league: League } {
  const rows = db.rows<Record<string, number>>(
    `SELECT t.club_id, COUNT(*) AS gp, SUM(t.poss) AS poss, ${BOX_FIELDS.map((f) => `SUM(t.${f}) AS ${f}`).join(', ')},
       SUM(o.poss) AS o_poss, ${BOX_FIELDS.map((f) => `SUM(o.${f}) AS o_${f}`).join(', ')}
     FROM game g JOIN game_team_box t ON t.game_id = g.id JOIN game_team_box o ON o.game_id = g.id AND o.club_id <> t.club_id
     WHERE g.season = ? AND g.competition_id = ? AND g.stage = ? AND g.status = 'jugado'
     GROUP BY t.club_id`,
    [season, comp, stage],
  );
  const teams = new Map<number, TeamTotals>();
  const league: League = { pts: 0, poss: 0, teamGames: 0, sec: 0 };
  for (const r of rows) {
    const opp: Record<string, number> = { gp: r.gp!, poss: r.o_poss! };
    for (const f of BOX_FIELDS) opp[f] = r[`o_${f}`]!;
    const t = { ...toLine(r), poss: r.poss!, opp: opp as unknown as Line & { poss: number } };
    teams.set(r.club_id!, t);
    league.pts += t.pts;
    league.poss += t.poss;
    league.teamGames += t.gp;
    league.sec += t.sec;
  }
  return { teams, league };
}

export interface PlayerLine extends Line {
  id: number;
  name: string;
  club_id: number;
  club: string;
  pos1: string;
  age: number;
  ovr: number;
  usg: number | null;
  ts: number | null;
  efg: number | null;
  pir: number;
  astPct: number | null;
  rebPct: number | null;
  tovPct: number | null;
  ows: number;
  dws: number;
  ws: number;
  ws40: number;
}

/** Líneas de temporada de todos los jugadores de una competición, con estadísticas avanzadas. */
export function playerLines(db: Db, season: number, comp: number, stage: Stage, clubId?: number): PlayerLine[] {
  const { teams, league } = teamTotals(db, season, comp, stage);
  const rows = db.rows<Record<string, unknown>>(
    `SELECT s.player_id AS id, s.club_id, p.name, p.pos1, p.birth_year, c.short AS club, COALESCE(a.ovr, 0) AS ovr,
       SUM(s.gp) AS gp, SUM(s.gs) AS gs, ${BOX_FIELDS.map((f) => `SUM(s.${f}) AS ${f}`).join(', ')}
     FROM player_season_stats s JOIN player p ON p.id = s.player_id JOIN club c ON c.id = s.club_id
     LEFT JOIN player_attributes a ON a.player_id = s.player_id AND a.season = s.season
     WHERE s.season = ? AND s.competition_id = ? AND s.stage = ? AND s.source = 'sim'
     GROUP BY s.player_id, s.club_id`,
    [season, comp, stage],
  );
  const byTeam = new Map<number, (Line & { id: number })[]>();
  const base = rows.map((r) => {
    const l = { ...toLine(r), id: Number(r.id) };
    const club = Number(r.club_id);
    (byTeam.get(club) ?? byTeam.set(club, []).get(club)!).push(l);
    return { r, l, club };
  });
  const ws = new Map<number, { ows: number; dws: number; ws: number }>();
  for (const [club, ls] of byTeam) {
    const t = teams.get(club);
    if (t) for (const [id, v] of winShares(ls, t, league)) ws.set(id, v);
  }
  return base
    .filter((b) => clubId === undefined || b.club === clubId)
    .map(({ r, l, club }) => {
      const t = teams.get(club);
      const w = ws.get(l.id) ?? { ows: 0, dws: 0, ws: 0 };
      return {
        ...l,
        name: String(r.name),
        club_id: club,
        club: String(r.club),
        pos1: String(r.pos1),
        age: season - Number(r.birth_year),
        ovr: Number(r.ovr),
        usg: t ? usg(l, t) : null,
        ts: ts(l),
        efg: efg(l),
        pir: pir(l),
        astPct: t ? astPct(l, t) : null,
        rebPct: t ? rebPct(l, t) : null,
        tovPct: tovPct(l),
        ...w,
        ws40: l.sec > 0 ? (w.ws * 2400) / l.sec : 0,
      };
    });
}

export function listClubs(db: Db) {
  const season = getUniverse(db)?.game_season ?? 0;
  return db.rows<{ id: number; name: string; short: string; city: string; competition_id: number; reputation: number; budget: number; level: number }>(
    `SELECT c.id, c.name, c.short, c.city, c.competition_id, c.reputation, c.budget,
       (SELECT ROUND(AVG(ovr)) FROM (SELECT a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
          WHERE p.club_id = c.id AND p.retired = 0 ORDER BY a.ovr DESC LIMIT 8)) AS level
     FROM club c ORDER BY c.competition_id, level DESC`,
    [season],
  );
}

export function home(db: Db) {
  const u = getUniverse(db);
  if (!u) return null;
  const clubId = u.user_club_id;
  if (!clubId) return { universe: u, club: null };
  const club = db.rows<{ id: number; name: string; short: string; competition_id: number; comp: string }>(
    'SELECT c.id, c.name, c.short, c.competition_id, k.name AS comp FROM club c JOIN competition k ON k.id = c.competition_id WHERE c.id = ?',
    [clubId],
  )[0]!;
  const table = standings(db, u.game_season, club.competition_id);
  const pos = table.findIndex((r) => r.club_id === clubId) + 1;
  const games = db.rows<GameListRow>(GAME_LIST_SQL + ' WHERE g.season = ? AND (g.home_id = ? OR g.away_id = ?) ORDER BY g.day', [u.game_season, clubId, clubId]);
  const next = games.find((g) => g.status === 'pendiente') ?? null;
  const last = games.filter((g) => g.status === 'jugado').slice(-5).reverse();
  const nextDay = db.rows<{ d: number | null }>("SELECT MIN(day) AS d FROM game WHERE season = ? AND status = 'pendiente'", [u.game_season])[0]?.d ?? null;
  const result = db.rows<{ competition_id: number; champion: string | null; first: string | null }>(
    `SELECT r.competition_id, c1.name AS champion, c2.name AS first FROM season_result r
     LEFT JOIN club c1 ON c1.id = r.champion_id LEFT JOIN club c2 ON c2.id = r.regular_first_id WHERE r.season = ?`,
    [u.game_season],
  );
  return { universe: u, club, position: pos, table, next, last, nextDay, result };
}

export interface GameListRow {
  id: number; season: number; day: number; stage: string; competition_id: number; home_id: number; away_id: number;
  home: string; away: string; home_short: string; away_short: string; home_pts: number | null; away_pts: number | null;
  ot: number; status: string; series_id: number | null;
}
const GAME_LIST_SQL = `SELECT g.id, g.season, g.day, g.stage, g.competition_id, g.home_id, g.away_id, h.name AS home, a.name AS away,
  h.short AS home_short, a.short AS away_short, g.home_pts, g.away_pts, g.ot, g.status, g.series_id
  FROM game g JOIN club h ON h.id = g.home_id JOIN club a ON a.id = g.away_id`;

export function clubSchedule(db: Db, clubId: number, season: number): GameListRow[] {
  return db.rows<GameListRow>(GAME_LIST_SQL + ' WHERE g.season = ? AND (g.home_id = ? OR g.away_id = ?) ORDER BY g.day', [season, clubId, clubId]);
}

export function dayGames(db: Db, season: number, comp: number, day: number): GameListRow[] {
  return db.rows<GameListRow>(GAME_LIST_SQL + ' WHERE g.season = ? AND g.competition_id = ? AND g.day = ? ORDER BY g.id', [season, comp, day]);
}

export function compDays(db: Db, season: number, comp: number): { day: number; stage: string; played: number; total: number }[] {
  return db.rows(
    "SELECT day, MIN(stage) AS stage, SUM(status = 'jugado') AS played, COUNT(*) AS total FROM game WHERE season = ? AND competition_id = ? GROUP BY day ORDER BY day",
    [season, comp],
  );
}

export function squad(db: Db, clubId: number, season: number) {
  const comp = compOfClub(db, clubId);
  const lines = new Map(playerLines(db, season, comp, 'regular', clubId).map((l) => [l.id, l]));
  const players = db.rows<{ id: number; name: string; number: number | null; nationality: string; birth_year: number; height_cm: number; pos1: Pos; pos2: Pos | null; potential_est: number; ovr: number }>(
    `SELECT p.id, p.name, p.number, p.nationality, p.birth_year, p.height_cm, p.pos1, p.pos2, p.potential_est, a.ovr
     FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC`,
    [season, clubId],
  );
  const club = db.rows<{ id: number; name: string; short: string; comp: string; competition_id: number }>(
    'SELECT c.id, c.name, c.short, k.name AS comp, c.competition_id FROM club c JOIN competition k ON k.id = c.competition_id WHERE c.id = ?',
    [clubId],
  )[0]!;
  return { club, season, players: players.map((p) => ({ ...p, age: season - p.birth_year, line: lines.get(p.id) ?? null })) };
}

export function playerDetail(db: Db, id: number) {
  const u = getUniverse(db)!;
  const p = db.rows<Record<string, unknown>>(
    `SELECT p.*, c.name AS club, c.short AS club_short, c.competition_id FROM player p LEFT JOIN club c ON c.id = p.club_id WHERE p.id = ?`,
    [id],
  )[0];
  if (!p) throw new Error('Jugador no encontrado.');
  const attrRows = db.rows<Record<string, number>>('SELECT * FROM player_attributes WHERE player_id = ? ORDER BY season', [id]);
  const toAttrs = (r: Record<string, number>) => Object.fromEntries(ATTR_KEYS.map((k) => [k, r[k]])) as Attrs;
  const current = attrRows[attrRows.length - 1]!;
  const previous = attrRows.length > 1 ? attrRows[attrRows.length - 2]! : null;
  const attrs = toAttrs(current);
  const posOvr = POSITIONS.map((pos) => ({ pos, ovr: overallAt(attrs, { pos1: p.pos1 as Pos, pos2: (p.pos2 as Pos | null) ?? null, height_cm: Number(p.height_cm) }, pos) }));

  // Temporadas: una fila por temporada, competición, fase y club.
  const seasonsRows = db.rows<{ season: number; competition_id: number; stage: Stage; club_id: number }>(
    'SELECT DISTINCT season, competition_id, stage, club_id FROM player_season_stats WHERE player_id = ? ORDER BY season, stage DESC',
    [id],
  );
  const career = seasonsRows.map((s) => {
    const l = playerLines(db, s.season, s.competition_id, s.stage, s.club_id).find((x) => x.id === id)!;
    const comp = db.rows<{ short: string }>('SELECT short FROM competition WHERE id = ?', [s.competition_id])[0]!.short;
    return { season: s.season, comp, stage: s.stage, source: 'sim' as const, line: l };
  });
  const gameLog = db.rows<Record<string, unknown>>(
    `SELECT g.id AS game_id, g.day, g.stage, g.home_id, g.away_id, g.home_pts, g.away_pts, h.short AS home_short, a.short AS away_short, b.*
     FROM game_player_box b JOIN game g ON g.id = b.game_id JOIN club h ON h.id = g.home_id JOIN club a ON a.id = g.away_id
     WHERE b.player_id = ? AND g.season = ? ORDER BY g.day DESC`,
    [id, u.game_season],
  ).map((r) => ({ ...r, line: { ...toLine({ ...r, gp: 1 }) } }));
  return {
    player: p,
    season: u.game_season,
    age: u.game_season - Number(p.birth_year),
    ovr: current.ovr,
    prevOvr: previous?.ovr ?? null,
    attrs,
    prevAttrs: previous ? toAttrs(previous) : null,
    posOvr,
    career,
    gameLog,
    shotSeasons: db.rows<{ season: number }>('SELECT DISTINCT season FROM shot_zone_stats WHERE player_id = ? ORDER BY season DESC', [id]).map((r) => r.season),
  };
}

/** Tiros por zona de un jugador y media de la liga en las mismas zonas. */
export function shotZones(db: Db, playerId: number, season: number, lastGames?: number) {
  let mine: { zone: number; fga: number; fgm: number }[];
  let comp: number;
  if (lastGames) {
    const games = db.rows<{ id: number; competition_id: number }>(
      'SELECT g.id, g.competition_id FROM game_player_box b JOIN game g ON g.id = b.game_id WHERE b.player_id = ? AND g.season = ? ORDER BY g.day DESC LIMIT ?',
      [playerId, season, lastGames],
    );
    comp = games[0]?.competition_id ?? COMP.ACB;
    const acc = new Map<number, { zone: number; fga: number; fgm: number }>();
    for (const g of games) for (const s of decodeShots(db, g.id)) {
      if (s.player !== playerId) continue;
      const z = acc.get(s.zone) ?? acc.set(s.zone, { zone: s.zone, fga: 0, fgm: 0 }).get(s.zone)!;
      z.fga++;
      if (s.made) z.fgm++;
    }
    mine = [...acc.values()];
  } else {
    mine = db.rows('SELECT zone, SUM(fga) AS fga, SUM(fgm) AS fgm FROM shot_zone_stats WHERE player_id = ? AND season = ? GROUP BY zone', [playerId, season]);
    comp = db.rows<{ c: number }>('SELECT competition_id AS c FROM shot_zone_stats WHERE player_id = ? AND season = ? LIMIT 1', [playerId, season])[0]?.c ?? COMP.ACB;
  }
  const league = db.rows<{ zone: number; fga: number; fgm: number }>(
    'SELECT zone, SUM(fga) AS fga, SUM(fgm) AS fgm FROM shot_zone_stats WHERE season = ? AND competition_id = ? GROUP BY zone',
    [season, comp],
  );
  return { mine, league };
}

export interface Shot { player: number; x: number; y: number; zone: number; made: boolean; assisted: boolean; blocked: boolean; period: number }
export function decodeShots(db: Db, gameId: number): Shot[] {
  const row = db.rows<{ data: Uint8Array }>('SELECT data FROM game_shots WHERE game_id = ?', [gameId])[0];
  if (!row) return [];
  const bytes = new Uint8Array(row.data);
  const a = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const out: Shot[] = [];
  for (let i = 0; i < a.length; i += 4) {
    const k = a[i + 3]!;
    out.push({ player: a[i]!, x: a[i + 1]!, y: a[i + 2]!, zone: k & 15, made: !!(k & 16), assisted: !!(k & 32), blocked: !!(k & 64), period: k >> 8 });
  }
  return out;
}

export function gameDetail(db: Db, id: number) {
  const g = db.rows<GameListRow & { comp: string }>(GAME_LIST_SQL.replace('FROM game g', ', k.short AS comp FROM game g JOIN competition k ON k.id = g.competition_id') + ' WHERE g.id = ?', [id])[0];
  if (!g) throw new Error('Partido no encontrado.');
  const teams = db.rows<Record<string, number>>('SELECT * FROM game_team_box WHERE game_id = ?', [id]);
  const players = db.rows<Record<string, unknown>>(
    'SELECT b.*, p.name, p.number, p.pos1 FROM game_player_box b JOIN player p ON p.id = b.player_id WHERE b.game_id = ? ORDER BY b.gs DESC, b.sec DESC',
    [id],
  ).map((r) => ({ id: Number(r.player_id), club_id: Number(r.club_id), name: String(r.name), number: r.number as number | null, pos1: String(r.pos1), gs: Number(r.gs), line: toLine({ ...r, gp: 1 }) }));
  const pbpRow = db.rows<{ data: Uint8Array }>('SELECT data FROM game_pbp WHERE game_id = ?', [id])[0];
  const pbp = pbpRow ? (JSON.parse(strFromU8(inflateSync(new Uint8Array(pbpRow.data)))) as number[][]) : null;
  const names: Record<number, string> = {};
  if (pbp) {
    const ids = [...new Set(pbp.flatMap((e) => [e[4]!, e[5]!]).filter((x) => x > 0))];
    if (ids.length) for (const r of db.rows<{ id: number; name: string }>(`SELECT id, name FROM player WHERE id IN (${ids.join(',')})`)) names[r.id] = r.name;
  }
  let series: Record<string, unknown> | null = null;
  if (g.series_id) series = db.rows('SELECT * FROM playoff_series WHERE id = ?', [g.series_id])[0] ?? null;
  return {
    game: g,
    teams: teams.map((t) => ({ club_id: t.club_id!, poss: t.poss!, line: toLine({ ...t, gp: 1 }) })),
    players,
    shots: decodeShots(db, id),
    pbp,
    names,
    series,
  };
}

export function leagueTable(db: Db, season: number, comp: number) {
  const table: StandingRow[] = standings(db, season, comp);
  const { teams } = teamTotals(db, season, comp, 'regular');
  return table.map((r) => {
    const t = teams.get(r.club_id);
    return { ...r, ortg: t ? ortg(t) : null, drtg: t ? drtg(t) : null, pace: t ? pace(t) : null, ff: t ? fourFactors(t) : null };
  });
}

export function playoffs(db: Db, season: number, comp: number) {
  return db.rows<{ id: number; round: number; slot: number; high: string; low: string; high_id: number; low_id: number; high_seed: number; low_seed: number; high_wins: number; low_wins: number; winner_id: number | null; best_of: number }>(
    `SELECT s.*, h.name AS high, l.name AS low FROM playoff_series s JOIN club h ON h.id = s.high_id JOIN club l ON l.id = s.low_id
     WHERE s.season = ? AND s.competition_id = ? ORDER BY s.round, s.slot`,
    [season, comp],
  );
}

export function history(db: Db) {
  return db.rows<{ season: number; competition: string; champion: string | null; runner_up: string | null; first: string | null }>(
    `SELECT r.season, k.name AS competition, c1.name AS champion, c2.name AS runner_up, c3.name AS first FROM season_result r
     JOIN competition k ON k.id = r.competition_id LEFT JOIN club c1 ON c1.id = r.champion_id LEFT JOIN club c2 ON c2.id = r.runner_up_id
     LEFT JOIN club c3 ON c3.id = r.regular_first_id ORDER BY r.season DESC, r.competition_id`,
  );
}

export { SUMS };
