/** Consultas de lectura para las pantallas. Devuelven objetos simples listos para pintar. */
import { inflateSync, strFromU8 } from 'fflate';
import { ATTR_KEYS, type Attrs, overallAt, type Pos, POSITIONS } from './attributes';
import { BOX_FIELDS, DEFAULT_TACTICS, type Tactics, shotTendencies } from './engine';
import { COMP, type StandingRow, getUniverse, standings } from './season';
import { type Db } from './schema';
import { askSalary, marketValue } from './market';
import { COMP_INFO } from './names';
import { FAST_COMPS } from './leagues';
import { promiseOf } from './promises';
import { dateOfDay, leagueRoundPlayed } from './calendar';
import { expectedRole } from './club';
import { archetype, archetypes } from './archetype';
import { cupoCounts, getTraining, groupStandings, scoutNoise, upgradeCost } from './world';
import { type League, type Line, type TeamTotals, winsAdded, astPct, drtg, efg, fourFactors, ortg, pace, pir, rebPct, tovPct, ts, usg, winShares } from './stats';

/** Fase de una competición; 'all' suma todas (útil en Copa y Europa). */
export type Stage = 'regular' | 'playoffs' | 'copa' | 'grupos' | 'eliminatoria' | 'all';
const SUMS = BOX_FIELDS.map((f) => `SUM(${f}) AS ${f}`).join(', ');
const toLine = (r: Record<string, unknown>): Line => {
  const o: Record<string, number> = {};
  for (const f of BOX_FIELDS) o[f] = Number(r[f] ?? 0);
  o.gp = Number(r.gp ?? 0);
  o.gs = Number(r.gs ?? 0);
  return o as unknown as Line;
};

export function compOfClub(db: Db, clubId: number): number {
  const c = db.rows<{ c: number | null }>('SELECT competition_id AS c FROM club WHERE id = ?', [clubId])[0]?.c;
  if (c) return c;
  // Clubes extranjeros: su competición europea.
  return db.rows<{ c: number }>('SELECT competition_id AS c FROM comp_group WHERE club_id = ? ORDER BY season DESC LIMIT 1', [clubId])[0]?.c ?? COMP.ACB;
}

/** Totales por equipo (y de su rival) y de la liga, para una temporada, competición y fase. */
export function teamTotals(db: Db, season: number, comp: number, stage: Stage): { teams: Map<number, TeamTotals>; league: League } {
  const rows = db.rows<Record<string, number>>(
    `SELECT t.club_id, COUNT(*) AS gp, SUM(t.poss) AS poss, ${BOX_FIELDS.map((f) => `SUM(t.${f}) AS ${f}`).join(', ')},
       SUM(o.poss) AS o_poss, ${BOX_FIELDS.map((f) => `SUM(o.${f}) AS o_${f}`).join(', ')}
     FROM game g JOIN game_team_box t ON t.game_id = g.id JOIN game_team_box o ON o.game_id = g.id AND o.club_id <> t.club_id
     WHERE g.season = ? AND g.competition_id = ? AND (? = 'all' OR g.stage = ?) AND g.status = 'jugado'
     GROUP BY t.club_id`,
    [season, comp, stage, stage],
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
  va: number;
}

/** Líneas de temporada de todos los jugadores de una competición, con estadísticas avanzadas. */
export function playerLines(db: Db, season: number, comp: number, stage: Stage, clubId?: number): PlayerLine[] {
  const { teams, league } = teamTotals(db, season, comp, stage);
  const rows = db.rows<Record<string, unknown>>(
    `SELECT s.player_id AS id, s.club_id, p.name, p.pos1, p.birth_year, c.short AS club, COALESCE(a.ovr, 0) AS ovr,
       SUM(s.gp) AS gp, SUM(s.gs) AS gs, ${BOX_FIELDS.map((f) => `SUM(s.${f}) AS ${f}`).join(', ')}
     FROM player_season_stats s JOIN player p ON p.id = s.player_id JOIN club c ON c.id = s.club_id
     LEFT JOIN player_attributes a ON a.player_id = s.player_id AND a.season = s.season
     WHERE s.season = ? AND s.competition_id = ? AND (? = 'all' OR s.stage = ?) AND s.source = 'sim'
     GROUP BY s.player_id, s.club_id`,
    [season, comp, stage, stage],
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
        va: t ? winsAdded(w.ws, l.sec, t.gp, t.sec) : 0,
      };
    });
}

export function tactics(db: Db, clubId: number): Tactics {
  const r = db.rows<{ data: string }>('SELECT data FROM tactics WHERE club_id = ?', [clubId])[0];
  if (!r) return DEFAULT_TACTICS;
  const t = JSON.parse(r.data) as Tactics;
  return { ...DEFAULT_TACTICS, ...t, shot: { ...DEFAULT_TACTICS.shot, ...t.shot }, defense: { ...DEFAULT_TACTICS.defense!, ...t.defense }, autoTimeout: { ...DEFAULT_TACTICS.autoTimeout!, ...t.autoTimeout } };
}

/** Plantilla con la media de cada jugador en cada hueco, para elegir quinteto y roles. */
export function lineup(db: Db, clubId: number) {
  const u = getUniverse(db)!;
  const comp = compOfClub(db, clubId);
  const lines = new Map(playerLines(db, u.game_season, comp, 'regular', clubId).map((l) => [l.id, l]));
  const rows = db.rows<Record<string, unknown>>(
    `SELECT p.id, p.name, p.number, p.pos1, p.pos2, p.height_cm, p.birth_year, p.nationality, p.origin, p.injury_games, p.morale, p.mood_note, p.fatigue, (SELECT colors FROM club WHERE id = p.club_id) AS colors, a.*, l.slot, l.role, l.shoot, l.minutes
     FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     LEFT JOIN lineup l ON l.player_id = p.id AND l.club_id = p.club_id
     WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC`,
    [u.game_season, clubId],
  );
  return rows.map((r) => {
    const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs;
    const who = { pos1: r.pos1 as Pos, pos2: (r.pos2 as Pos | null) ?? null, height_cm: Number(r.height_cm) };
    const l = lines.get(Number(r.player_id));
    return {
      id: Number(r.player_id), name: String(r.name), number: r.number as number | null, pos1: who.pos1, pos2: who.pos2,
      age: u.game_season - Number(r.birth_year), ovr: Number(r.ovr), nationality: String(r.nationality), origin: String(r.origin), colors: (r.colors as string | null) ?? null,
      injury: Number(r.injury_games) > 0, archetype: archetype(attrs, who.pos1, who.height_cm),
      atPos: POSITIONS.map((p) => overallAt(attrs, who, p)),
      slot: r.slot === null || r.slot === undefined ? null : Number(r.slot),
      role: (r.role as string | null) ?? 'rot',
      shoot: (r.shoot as string | null) ?? 'normal',
      tend: shotTendencies(attrs, Number(r.height_cm)),
      min: l && l.gp ? l.sec / 60 / l.gp : null,
      gp: l?.gp ?? 0,
      target: r.minutes === null || r.minutes === undefined ? null : Number(r.minutes),
      morale: Number(r.morale), mood: (r.mood_note as string | null) ?? null, fatigue: Number(r.fatigue ?? 0),
    };
  }).map((p, rank, all) => ({ ...p, expected: expectedRole(all.filter((x) => x.ovr > p.ovr).length, p.age) }));
}

/** Todos los jugadores en activo (con club o libres), con su temporada y su situación de mercado. */
export function allPlayers(db: Db) {
  const u = getUniverse(db)!;
  const lines = new Map<number, PlayerLine>();
  for (const comp of [COMP.ACB, COMP.FEB]) {
    for (const l of playerLines(db, u.game_season, comp, 'regular')) {
      const prev = lines.get(l.id);
      if (!prev || l.gp > prev.gp) lines.set(l.id, l);
    }
  }
  // Ligas extranjeras, NBA y NCAA (simulación rápida): su liga regular.
  for (const comp of FAST_COMPS) for (const l of playerLines(db, u.game_season, comp, 'regular')) if (!lines.has(l.id)) lines.set(l.id, l);
  // Jugadores de clubes extranjeros sin partidos de liga todavía: sus números en Europa.
  for (const comp of [4, 5, 6]) for (const l of playerLines(db, u.game_season, comp, 'all')) if (!lines.has(l.id)) lines.set(l.id, l);
  const rows = db.rows<{ id: number; name: string; club_id: number | null; club: string | null; comp: number | null; country: string | null; pos1: string; pos2: string | null; birth_year: number; height_cm: number; nationality: string; potential_est: number; morale: number; injury_games: number; ovr: number; salary: number | null; until: number | null }>(
    `SELECT p.id, p.name, p.club_id, c.short AS club, c.competition_id AS comp, c.country, p.pos1, p.pos2, p.birth_year, p.height_cm, p.nationality, p.potential_est, p.morale, p.injury_games,
       k.salary, k.until, k.clause, (w.player_id IS NOT NULL) AS watched, a.*
     FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? LEFT JOIN club c ON c.id = p.club_id LEFT JOIN contract k ON k.player_id = p.id
     LEFT JOIN watch w ON w.player_id = p.id
     WHERE p.retired = 0 AND p.youth = 0`,
    [u.game_season],
  );
  return rows.map((r0) => {
    const r = r0 as typeof r0 & Record<string, number> & { clause: number | null; watched: number };
    const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs;
    const econ = { ovr: r.ovr, age: u.game_season - r.birth_year, potential_est: r.potential_est, morale: r.morale };
    return {
      id: r.id, name: r.name, club_id: r.club_id, club: r.club, comp: r.comp, country: r.country, pos1: r.pos1, pos2: r.pos2, birth_year: r.birth_year,
      height_cm: r.height_cm, nationality: r.nationality, potential_est: r.potential_est, morale: r.morale, injury_games: r.injury_games, ovr: r.ovr,
      salary: r.salary, until: r.until, clause: r.clause, watched: !!r.watched,
      archetype: archetype(attrs, r.pos1 as Pos, r.height_cm).label,
      archs: archetypes(attrs, r.pos1 as Pos, r.height_cm).map((x) => x.key),
      attrs,
      age: econ.age, ask: askSalary(econ), value: marketValue(econ, r.until === null ? 0 : r.until - u.game_season), line: lines.get(r.id) ?? null,
    };
  });
}

export function news(db: Db, clubId: number | null, limit = 15) {
  return db.rows<{ id: number; season: number; day: number; club_id: number | null; player_id: number | null; kind: string; text: string }>(
    'SELECT * FROM news WHERE (? IS NULL OR club_id = ? OR kind IN (\'fichaje\', \'venta\') AND club_id IS NOT NULL) ORDER BY id DESC LIMIT ?',
    [clubId, clubId, limit],
  );
}

export function listClubs(db: Db) {
  const season = getUniverse(db)?.game_season ?? 0;
  return db.rows<{ id: number; name: string; short: string; city: string; country: string; colors: string | null; competition_id: number | null; reputation: number; budget: number; level: number; euro: number | null }>(
    `SELECT c.id, c.name, c.short, c.city, c.country, c.colors, c.competition_id, c.reputation, c.budget,
       (SELECT competition_id FROM comp_group g WHERE g.club_id = c.id AND g.season = ?) AS euro,
       (SELECT ROUND(AVG(ovr)) FROM (SELECT a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
          WHERE p.club_id = c.id AND p.retired = 0 ORDER BY a.ovr DESC LIMIT 8)) AS level
     FROM club c ORDER BY c.competition_id IS NULL, c.competition_id, level DESC`,
    [season, season],
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
  return {
    universe: u, club, position: pos, table, next, last, nextDay, result,
    round: leagueRoundPlayed(db, u.game_season),
    nextDate: next ? dateOfDay(u.game_season, next.day) : null,
    today: u.game_day ? dateOfDay(u.game_season, u.game_day) : null,
  };
}

export interface GameListRow {
  id: number; season: number; day: number; stage: string; competition_id: number; home_id: number; away_id: number;
  home: string; away: string; home_short: string; away_short: string; home_pts: number | null; away_pts: number | null;
  ot: number; status: string; series_id: number | null; round: number | null;
}
const GAME_LIST_SQL = `SELECT g.id, g.season, g.day, g.stage, g.competition_id, g.home_id, g.away_id, h.name AS home, a.name AS away,
  h.short AS home_short, a.short AS away_short, g.home_pts, g.away_pts, g.ot, g.status, g.series_id, g.round, g.date AS gdate
  FROM game g JOIN club h ON h.id = g.home_id JOIN club a ON a.id = g.away_id`;

export function clubSchedule(db: Db, clubId: number, season: number): (GameListRow & { date: string | null })[] {
  return db.rows<GameListRow>(GAME_LIST_SQL + ' WHERE g.season = ? AND (g.home_id = ? OR g.away_id = ?) ORDER BY g.day', [season, clubId, clubId]).map((g) => ({ ...g, date: (g as { gdate?: string | null }).gdate ?? dateOfDay(season, g.day) }));
}

export function dayGames(db: Db, season: number, comp: number, day: number): GameListRow[] {
  return db.rows<GameListRow>(GAME_LIST_SQL + ' WHERE g.season = ? AND g.competition_id = ? AND g.day = ? ORDER BY g.id', [season, comp, day]);
}

export function compDays(db: Db, season: number, comp: number): { day: number; stage: string; played: number; total: number; round: number | null; date: string | null }[] {
  return db.rows<{ day: number; stage: string; played: number; total: number; round: number | null }>(
    "SELECT day, MIN(stage) AS stage, SUM(status = 'jugado') AS played, COUNT(*) AS total, MIN(round) AS round, MIN(date) AS gdate FROM game WHERE season = ? AND competition_id = ? GROUP BY day ORDER BY day",
    [season, comp],
  ).map((d) => ({ ...d, round: d.stage === 'regular' || d.stage === 'grupos' ? d.round : null, date: (d as { gdate?: string | null }).gdate ?? dateOfDay(season, d.day) }));
}

export function squad(db: Db, clubId: number, season: number) {
  const comp = compOfClub(db, clubId);
  const lines = new Map(playerLines(db, season, comp, 'regular', clubId).map((l) => [l.id, l]));
  const players = db.rows<{ id: number; name: string; number: number | null; nationality: string; birth_year: number; youth: number; origin: string; height_cm: number; pos1: Pos; pos2: Pos | null; potential_est: number; ovr: number; morale: number; injury_games: number; injury: string | null; salary: number | null; until: number | null; wants_out: number; listed: number }>(
    `SELECT p.id, p.name, p.number, p.nationality, p.birth_year, p.youth, p.origin, a.*, p.height_cm, p.pos1, p.pos2, p.potential_est, a.ovr, p.morale, p.injury_games, p.injury, k.salary, k.until, p.wants_out, p.listed
     FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? LEFT JOIN contract k ON k.player_id = p.id
     WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC`,
    [season, clubId],
  );
  const club = db.rows<{ id: number; name: string; short: string; comp: string; competition_id: number; country: string; colors: string | null }>(
    'SELECT c.id, c.name, c.short, COALESCE(k.name, ?) AS comp, COALESCE(c.competition_id, ?) AS competition_id, c.country, c.colors FROM club c LEFT JOIN competition k ON k.id = c.competition_id WHERE c.id = ?',
    [COMP_INFO[comp]?.name ?? '', comp, clubId],
  )[0]!;
  return {
    club, season, cupo: cupoCounts(db, clubId),
    players: players.map((p) => {
      const r = p as unknown as Record<string, number>;
      const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs;
      const o: Record<string, unknown> = { id: p.id, name: p.name, number: p.number, nationality: p.nationality, birth_year: p.birth_year, youth: p.youth, origin: p.origin, height_cm: p.height_cm, pos1: p.pos1, pos2: p.pos2, potential_est: p.potential_est, ovr: p.ovr, morale: p.morale, injury_games: p.injury_games, injury: p.injury, salary: p.salary, until: p.until, wants_out: p.wants_out, listed: p.listed };
      return { ...(o as typeof p), age: season - p.birth_year, archetype: archetype(attrs, p.pos1, p.height_cm), line: lines.get(p.id) ?? null };
    }),
  };
}

export function playerDetail(db: Db, id: number) {
  const u = getUniverse(db)!;
  const p = db.rows<Record<string, unknown>>(
    `SELECT p.*, c.name AS club, c.short AS club_short, c.competition_id, c.colors AS club_colors, y.name AS youth_club FROM player p LEFT JOIN club y ON y.id = p.youth LEFT JOIN club c ON c.id = p.club_id WHERE p.id = ?`,
    [id],
  )[0];
  if (!p) throw new Error('Jugador no encontrado.');
  const attrRows = db.rows<Record<string, number>>('SELECT * FROM player_attributes WHERE player_id = ? ORDER BY season', [id]);
  const toAttrs = (r: Record<string, number>) => Object.fromEntries(ATTR_KEYS.map((k) => [k, r[k]])) as Attrs;
  const current = attrRows[attrRows.length - 1]!;
  const previous = attrRows.length > 1 ? attrRows[attrRows.length - 2]! : null;
  const attrs = toAttrs(current);
  const posOvr = POSITIONS.map((pos) => ({ pos, ovr: Math.max(1, overallAt(attrs, { pos1: p.pos1 as Pos, pos2: (p.pos2 as Pos | null) ?? null, height_cm: Number(p.height_cm) }, pos)) }));

  // Temporadas: una fila por temporada, competición, fase y club.
  const seasonsRows = db.rows<{ season: number; competition_id: number; stage: Stage; club_id: number }>(
    'SELECT DISTINCT season, competition_id, stage, club_id FROM player_season_stats WHERE player_id = ? ORDER BY season, stage DESC',
    [id],
  );
  const career = seasonsRows.map((s) => {
    const l = playerLines(db, s.season, s.competition_id, s.stage, s.club_id).find((x) => x.id === id)!;
    const comp = db.rows<{ short: string }>('SELECT short FROM competition WHERE id = ?', [s.competition_id])[0]!.short;
    const club = db.rows<{ name: string; short: string; colors: string | null }>('SELECT name, short, colors FROM club WHERE id = ?', [s.club_id])[0];
    return { season: s.season, comp, competition_id: s.competition_id, stage: s.stage, source: 'sim' as const, line: l, club_id: s.club_id, club: club?.name ?? '¿?', club_short: club?.short ?? '', club_colors: club?.colors ?? null };
  });
  // Trayectoria: cada movimiento registrado (fichajes, traspasos, cesiones, rescisiones, renovaciones).
  const moves = db.rows<{ season: number; day: number; kind: string; fee: number; from_club: number | null; to_club: number | null; from_name: string | null; to_name: string | null }>(
    `SELECT t.season, t.day, t.kind, t.fee, t.from_club, t.to_club, cf.name AS from_name, ct.name AS to_name FROM transfer t
     LEFT JOIN club cf ON cf.id = t.from_club LEFT JOIN club ct ON ct.id = t.to_club WHERE t.player_id = ? ORDER BY t.id`,
    [id],
  );
  const gameLog = db.rows<Record<string, unknown>>(
    `SELECT g.id AS game_id, g.day, g.stage, g.home_id, g.away_id, g.home_pts, g.away_pts, h.short AS home_short, a.short AS away_short, b.*
     FROM game_player_box b JOIN game g ON g.id = b.game_id JOIN club h ON h.id = g.home_id JOIN club a ON a.id = g.away_id
     WHERE b.player_id = ? AND g.season = ? ORDER BY g.day DESC`,
    [id, u.game_season],
  ).map((r) => ({ ...r, line: { ...toLine({ ...r, gp: 1 }) } }));
  // Tendencias: reparto natural según atributos y reparto real de sus tiros esta temporada.
  const areaOf = (z: number) => (z === 0 ? 'rim' : z <= 3 ? 'paint' : z <= 8 ? 'mid' : 'three');
  const real: Record<string, number> = { rim: 0, paint: 0, mid: 0, three: 0 };
  for (const z of db.rows<{ zone: number; fga: number }>('SELECT zone, SUM(fga) AS fga FROM shot_zone_stats WHERE player_id = ? AND season = ? GROUP BY zone', [id, u.game_season])) real[areaOf(z.zone)]! += z.fga;
  const realTotal = Object.values(real).reduce((a, b) => a + b, 0);
  return {
    archetypes: archetypes(attrs, p.pos1 as Pos, Number(p.height_cm)),
    watched: db.rows('SELECT 1 FROM watch WHERE player_id = ?', [id]).length > 0,
    promise: promiseOf(db, id),
    mine: p.club_id !== null && Number(p.club_id) === u.user_club_id,
    awards: db.rows<{ season: number; competition_id: number; award: string; rank: number }>('SELECT season, competition_id, award, rank FROM award WHERE player_id = ? ORDER BY season DESC', [id]),
    tendencies: { natural: shotTendencies(attrs, Number(p.height_cm)), real: realTotal ? Object.fromEntries(Object.entries(real).map(([k, v]) => [k, v / realTotal])) : null, shots: realTotal },
    player: p,
    season: u.game_season,
    age: u.game_season - Number(p.birth_year),
    ovr: current.ovr,
    prevOvr: previous?.ovr ?? null,
    attrs,
    prevAttrs: previous ? toAttrs(previous) : null,
    posOvr,
    career,
    moves,
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
  const g = db.rows<GameListRow & { comp: string }>(GAME_LIST_SQL.replace('FROM game g', ', k.short AS comp FROM game g JOIN competition k ON k.id = g.competition_id') + ' WHERE g.id = ?', [id])[0] as (GameListRow & { comp: string; date?: string | null }) | undefined;
  if (!g) throw new Error('Partido no encontrado.');
  g.date = (g as { gdate?: string | null }).gdate ?? dateOfDay(g.season, g.day);
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

/** Resumen de una competición: grupos (Europa), cruces y campeón. */
export function competitionView(db: Db, season: number, comp: number) {
  const groups: Record<string, StandingRow[]> = {};
  for (const g of db.rows<{ grp: string }>('SELECT DISTINCT grp FROM comp_group WHERE season = ? AND competition_id = ? ORDER BY grp', [season, comp])) {
    groups[g.grp] = groupStandings(db, season, comp, g.grp);
  }
  const champion = db.rows<{ champion: string | null; runner: string | null }>(
    'SELECT c1.name AS champion, c2.name AS runner FROM season_result r LEFT JOIN club c1 ON c1.id = r.champion_id LEFT JOIN club c2 ON c2.id = r.runner_up_id WHERE r.season = ? AND r.competition_id = ?',
    [season, comp],
  )[0] ?? null;
  const games = db.rows<{ series_id: number; id: number; home_id: number; home_pts: number | null; away_pts: number | null; status: string; day: number }>(
    'SELECT series_id, id, home_id, home_pts, away_pts, status, day FROM game WHERE season = ? AND competition_id = ? AND series_id IS NOT NULL ORDER BY day',
    [season, comp],
  );
  const series = playoffs(db, season, comp).map((s) => ({ ...s, games: games.filter((g) => g.series_id === s.id) }));
  return { comp, info: COMP_INFO[comp]!, groups, series, champion };
}

/** Competiciones en las que juega un club esta temporada (para el selector de Liga y la portada). */
export function clubCompetitions(db: Db, clubId: number, season: number): number[] {
  return db.rows<{ c: number }>(
    'SELECT DISTINCT competition_id AS c FROM game WHERE season = ? AND (home_id = ? OR away_id = ?) ORDER BY competition_id',
    [season, clubId, clubId],
  ).map((r) => r.c);
}

/** Despacho del club: entrenamiento, instalaciones, ojeadores, cupos y cantera. */
export function office(db: Db, clubId: number) {
  const u = getUniverse(db)!;
  const c = db.rows<{ id: number; name: string; cash: number; facilities: number; scouting: number; colors: string | null }>(
    'SELECT id, name, cash, facilities, scouting, colors FROM club WHERE id = ?',
    [clubId],
  )[0]!;
  const youth = db.rows<{ id: number; name: string; nationality: string; birth_year: number; height_cm: number; pos1: Pos; pos2: Pos | null; potential_est: number; ovr: number }>(
    `SELECT p.id, p.name, p.nationality, p.birth_year, p.height_cm, p.pos1, p.pos2, p.potential_est, a.ovr
     FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     WHERE p.youth = ? AND p.retired = 0 ORDER BY p.potential_est DESC`,
    [u.game_season, clubId],
  ).map((y) => ({ ...y, age: u.game_season - y.birth_year }));
  return {
    club: c,
    season: u.game_season,
    training: getTraining(db, clubId),
    cupo: cupoCounts(db, clubId),
    roster: db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [clubId])[0]!.n,
    upgrade: {
      facilities: c.facilities < 5 ? upgradeCost('facilities', c.facilities) : null,
      scouting: c.scouting < 5 ? upgradeCost('scouting', c.scouting) : null,
    },
    scoutError: scoutNoise(c.scouting),
    youth,
  };
}

/** Informe previo de un partido: cómo llegan los dos equipos, sus mejores jugadores y cómo juegan. */
export function preview(db: Db, gameId?: number) {
  const u = getUniverse(db)!;
  const g = gameId
    ? db.rows<GameListRow>(GAME_LIST_SQL + ' WHERE g.id = ?', [gameId])[0]
    : db.rows<GameListRow>(GAME_LIST_SQL + " WHERE g.season = ? AND g.status = 'pendiente' AND (g.home_id = ? OR g.away_id = ?) ORDER BY g.day, g.competition_id LIMIT 1", [u.game_season, u.user_club_id, u.user_club_id])[0];
  if (!g) return null;
  const team = (clubId: number) => {
    const comp = compOfClub(db, clubId);
    // Muestra: su liga (o su competición europea si es extranjero), toda la temporada.
    const stage: Stage = 'all';
    const { teams, league } = teamTotals(db, u.game_season, comp, stage);
    const t = teams.get(clubId);
    const lg = [...teams.values()];
    const lgAvg = (f: (x: TeamTotals) => number | null) => {
      const xs = lg.map(f).filter((x): x is number => x !== null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const lines = playerLines(db, u.game_season, comp, stage, clubId);
    const roster = db.rows<{ id: number; name: string; pos1: Pos; pos2: Pos | null; height_cm: number; ovr: number; injury_games: number; injury: string | null; nationality: string; birth_year: number; origin: string } & Record<string, number>>(
      `SELECT p.id, p.name, p.pos1, p.pos2, p.height_cm, p.injury_games, p.injury, p.nationality, p.birth_year, p.origin, a.* FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
       WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC`,
      [u.game_season, clubId],
    );
    const byId = new Map(roster.map((r) => [r.id, r]));
    const per = (l: PlayerLine, k: 'pts' | 'ast') => (l.gp ? l[k] / l.gp : 0);
    const rebPg = (l: PlayerLine) => (l.gp ? (l.orb + l.drb) / l.gp : 0);
    const played = lines.filter((l) => l.gp >= 1 && byId.has(l.id));
    const top = (played.length >= 3
      ? [...played].sort((a, b) => b.pir / b.gp - a.pir / a.gp).slice(0, 3).map((l) => l.id)
      : roster.slice(0, 3).map((r) => r.id)
    ).map((id) => {
      const r = byId.get(id)!;
      const l = lines.find((x) => x.id === id) ?? null;
      const attrs = Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs;
      return {
        id, name: r.name, pos1: r.pos1, ovr: r.ovr, nationality: r.nationality, age: u.game_season - r.birth_year, origin: r.origin,
        archetype: archetype(attrs, r.pos1, r.height_cm).label,
        gp: l?.gp ?? 0, pts: l ? per(l, 'pts') : null, reb: l ? rebPg(l) : null, ast: l ? per(l, 'ast') : null, ts: l?.ts ?? null, injured: r.injury_games > 0,
      };
    });
    const leader = (f: (l: PlayerLine) => number) => {
      const l = [...played].sort((a, b) => f(b) - f(a))[0];
      return l ? { id: l.id, name: l.name, value: f(l) } : null;
    };
    const ff = t ? fourFactors(t) : null;
    const club = db.rows<{ id: number; name: string; short: string; colors: string | null }>('SELECT id, name, short, colors FROM club WHERE id = ?', [clubId])[0]!;
    const recent = db.rows<{ home_id: number; home_pts: number; away_pts: number }>(
      "SELECT home_id, home_pts, away_pts FROM game WHERE season = ? AND status = 'jugado' AND (home_id = ? OR away_id = ?) ORDER BY day DESC, id DESC LIMIT 5",
      [u.game_season, clubId, clubId],
    ).map((x) => ((x.home_id === clubId) === (x.home_pts > x.away_pts) ? 'G' : 'P'));
    const st = standings(db, u.game_season, comp);
    const pos = st.findIndex((r) => r.club_id === clubId);
    return {
      club,
      compName: COMP_INFO[comp]?.name ?? '',
      record: pos >= 0 ? { w: st[pos]!.w, l: st[pos]!.l, pos: pos + 1 } : null,
      recent,
      stats: t
        ? {
            ortg: ortg(t), drtg: drtg(t), pace: pace(t), efg: ff?.efg ?? null, tov: ff?.tov ?? null, orb: ff?.orb ?? null, ftr: ff?.ftr ?? null,
            threeRate: t.fga2 + t.fga3 > 0 ? t.fga3 / (t.fga2 + t.fga3) : null,
            ppg: t.gp ? t.pts / t.gp : null, oppg: t.gp ? t.opp.pts / t.gp : null,
          }
        : null,
      league: {
        ortg: lgAvg(ortg), drtg: lgAvg(drtg), pace: lgAvg(pace), threeRate: lgAvg((x) => (x.fga2 + x.fga3 > 0 ? x.fga3 / (x.fga2 + x.fga3) : null)),
        efg: lgAvg((x) => fourFactors(x).efg), tov: lgAvg((x) => fourFactors(x).tov), orb: lgAvg((x) => fourFactors(x).orb),
      },
      teamGames: league.teamGames,
      top,
      leaders: { pts: leader((l) => per(l, 'pts')), reb: leader(rebPg), ast: leader((l) => per(l, 'ast')) },
      injured: roster.filter((r) => r.injury_games > 0).map((r) => ({ id: r.id, name: r.name, games: r.injury_games, injury: r.injury })),
    };
  };
  const h2h = db.rows<{ id: number; home_id: number; home_pts: number; away_pts: number; day: number }>(
    "SELECT id, home_id, home_pts, away_pts, day FROM game WHERE season = ? AND status = 'jugado' AND ((home_id = ? AND away_id = ?) OR (home_id = ? AND away_id = ?)) ORDER BY day",
    [u.game_season, g.home_id, g.away_id, g.away_id, g.home_id],
  );
  return { game: g, compName: COMP_INFO[g.competition_id]?.name ?? '', userSide: g.home_id === u.user_club_id ? 0 : g.away_id === u.user_club_id ? 1 : null, home: team(g.home_id), away: team(g.away_id), h2h };
}

/** Análisis ofensivo y defensivo de un jugador en una temporada (todas las competiciones). */
export function playerAnalysis(db: Db, id: number, season: number) {
  const sums = db.rows<Record<string, number>>(`SELECT SUM(gp) AS gp, ${SUMS} FROM player_season_stats WHERE player_id = ? AND season = ? AND source = 'sim'`, [id, season])[0] ?? {};
  const line = toLine(sums);
  const lg = db.rows<Record<string, number>>(`SELECT SUM(gp) AS gp, ${SUMS} FROM player_season_stats WHERE season = ? AND source = 'sim' AND competition_id IN (1, 2)`, [season])[0] ?? {};
  const L = toLine(lg);
  const areaOf = (z: number) => (z === 0 ? 'aro' : z <= 3 ? 'pintura' : z <= 8 ? 'media' : 'triple');
  const area: Record<string, { fga: number; fgm: number; lga: number; lgm: number }> = { aro: { fga: 0, fgm: 0, lga: 0, lgm: 0 }, pintura: { fga: 0, fgm: 0, lga: 0, lgm: 0 }, media: { fga: 0, fgm: 0, lga: 0, lgm: 0 }, triple: { fga: 0, fgm: 0, lga: 0, lgm: 0 } };
  for (const z of db.rows<{ zone: number; fga: number; fgm: number }>('SELECT zone, SUM(fga) AS fga, SUM(fgm) AS fgm FROM shot_zone_stats WHERE player_id = ? AND season = ? GROUP BY zone', [id, season])) {
    area[areaOf(z.zone)]!.fga += z.fga;
    area[areaOf(z.zone)]!.fgm += z.fgm;
  }
  for (const z of db.rows<{ zone: number; fga: number; fgm: number }>('SELECT zone, SUM(fga) AS fga, SUM(fgm) AS fgm FROM shot_zone_stats WHERE season = ? GROUP BY zone', [season])) {
    area[areaOf(z.zone)]!.lga += z.fga;
    area[areaOf(z.zone)]!.lgm += z.fgm;
  }
  // Canastas asistidas: se leen los tiros de sus partidos de la temporada.
  let made = 0;
  let assisted = 0;
  let putbacks = 0;
  for (const g of db.rows<{ game_id: number }>('SELECT b.game_id FROM game_player_box b JOIN game g ON g.id = b.game_id WHERE b.player_id = ? AND g.season = ?', [id, season])) {
    for (const sh of decodeShots(db, g.game_id)) {
      if (sh.player !== id || !sh.made) continue;
      made++;
      if (sh.assisted) assisted++;
    }
  }
  void putbacks;
  const fga = line.fga2 + line.fga3;
  const min = line.sec / 60;
  const per36 = (x: number) => (min > 0 ? (x * 36) / min : null);
  return {
    gp: line.gp,
    min,
    offense: {
      area,
      assistedShare: made ? assisted / made : null,
      ftRate: fga ? line.fta / fga : null,
      ptsPerShot: fga ? (line.pts - line.ftm) / fga : null,
      lgPtsPerShot: L.fga2 + L.fga3 ? (L.pts - L.ftm) / (L.fga2 + L.fga3) : null,
      tovPer36: per36(line.tov),
      astPer36: per36(line.ast),
      ptsPer36: per36(line.pts),
      astTov: line.tov ? line.ast / line.tov : null,
    },
    defense: {
      dfga: line.dfga,
      dfgm: line.dfgm,
      oppPct: line.dfga ? line.dfgm / line.dfga : null,
      lgOppPct: L.dfga ? L.dfgm / L.dfga : null,
      stlPer36: per36(line.stl),
      blkPer36: per36(line.blk),
      drbPer36: per36(line.drb),
      pfPer36: per36(line.pf),
      lgStl36: L.sec ? (L.stl * 36 * 60) / L.sec : null,
      lgBlk36: L.sec ? (L.blk * 36 * 60) / L.sec : null,
      lgDrb36: L.sec ? (L.drb * 36 * 60) / L.sec : null,
    },
  };
}

/** Evolución: media y grupos de atributos por temporada, y estadísticas básicas (sin las avanzadas, para ir rápido). */
export function playerEvolution(db: Db, id: number) {
  const p = db.rows<{ pos1: Pos; pos2: Pos | null; height_cm: number }>('SELECT pos1, pos2, height_cm FROM player WHERE id = ?', [id])[0]!;
  const attrs = db.rows<Record<string, number>>('SELECT * FROM player_attributes WHERE player_id = ? ORDER BY season', [id]).map((r) => {
    const a = Object.fromEntries(ATTR_KEYS.map((k) => [k, r[k]!])) as Attrs;
    const g = (keys: string[]) => keys.reduce((x, k) => x + a[k as keyof Attrs], 0) / keys.length;
    return {
      season: r.season!, ovr: r.ovr!,
      off: g(['drive', 'fin', 'sht2', 'sht3', 'ft', 'hdl', 'vis', 'pas', 'cre', 'post', 'offb', 'oreb']),
      def: g(['perd', 'intd', 'hlpd', 'ant', 'stl', 'blk', 'dreb', 'pnr', 'intim']),
      fis: g(['str', 'spd', 'agi', 'jmp', 'sta']),
    };
  });
  void p;
  const stats = db.rows<Record<string, number | string>>(
    `SELECT s.season, GROUP_CONCAT(DISTINCT c.short) AS clubs, SUM(s.gp) AS gp, ${BOX_FIELDS.map((f) => `SUM(s.${f}) AS ${f}`).join(', ')}
     FROM player_season_stats s JOIN club c ON c.id = s.club_id WHERE s.player_id = ? AND s.source = 'sim' GROUP BY s.season ORDER BY s.season DESC`,
    [id],
  ).map((r) => ({ season: Number(r.season), clubs: String(r.clubs), line: toLine(r as Record<string, number>) }));
  return { attrs, stats };
}

/** Bandeja de entrada del club: mensajes con su enlace y cuántos quedan sin leer. */
export function inbox(db: Db, clubId: number, limit = 80) {
  const rows = db.rows<{ id: number; season: number; day: number; kind: string; text: string; read: number; action: string | null; player_id: number | null }>(
    'SELECT id, season, day, kind, text, read, action, player_id FROM news WHERE club_id = ? ORDER BY id DESC LIMIT ?',
    [clubId, limit],
  ).map((r) => ({ ...r, action: r.action ? (JSON.parse(r.action) as { type: string; id?: number }) : null, date: dateOfDay(r.season, r.day) }));
  const unread = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM news WHERE club_id = ? AND read = 0', [clubId])[0]!.n;
  return { rows, unread };
}

export { SUMS };
