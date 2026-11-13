import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { COMP, REGULAR_DAYS, advanceDay, chooseClub, createUniverse, getUniverse, roundRobin, startNewSeason, standings } from '../src/core/season';
import { Rng } from '../src/core/rng';
import { CUPO_RULES, cupoOf } from '../src/core/names';
import { gameDetail, home, leagueTable, playerDetail, playerLines, playoffs, shotZones, squad, teamTotals } from '../src/core/queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite3: any;
let db: Db;
const one = (sql: string, b?: unknown[]) => Number(Object.values(db.rows(sql, b)[0]!)[0]);

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  db = wrapDb(new sqlite3.oo1.DB(':memory:'));
  migrate(db);
});

describe('calendario', () => {
  it('doble vuelta: cada club juega una vez por jornada y contra todos en casa y fuera', () => {
    const ids = Array.from({ length: 18 }, (_, i) => i + 1);
    const g = roundRobin(ids, new Rng(4));
    expect(g.length).toBe(18 * 17);
    for (let d = 1; d <= 34; d++) {
      const t = g.filter((x) => x[0] === d).flatMap((x) => [x[1], x[2]]);
      expect(new Set(t).size).toBe(18);
    }
    const pairs = new Set(g.map((x) => `${x[1]}-${x[2]}`));
    expect(pairs.size).toBe(18 * 17);
    for (const id of ids) expect(g.filter((x) => x[1] === id).length).toBe(17);
  });
});

describe('temporada completa', () => {
  it('crea el universo, simula liga y playoffs, y empieza la siguiente', () => {
    createUniverse(db, { name: 'Prueba', seed: 2024, id: 'u-1' });
    expect(one("SELECT COUNT(*) FROM club WHERE country = 'ES'")).toBe(36);
    expect(one('SELECT COUNT(*) FROM club')).toBe(72);
    expect(one('SELECT COUNT(*) FROM player WHERE club_id IS NOT NULL')).toBe(72 * 12);
    expect(one('SELECT COUNT(*) FROM contract')).toBe(72 * 12);
    expect(one('SELECT COUNT(*) FROM game WHERE competition_id <= 2')).toBe(2 * 18 * 17);
    // Europa: 3 competiciones × 2 grupos de 8 × doble vuelta.
    expect(one('SELECT COUNT(*) FROM game WHERE competition_id >= 4')).toBe(3 * 2 * 8 * 7);
    // Cupos: todos los clubes españoles cumplen.
    for (const c of db.rows<{ id: number }>("SELECT id FROM club WHERE country = 'ES'")) {
      const nat = db.rows<{ nationality: string }>('SELECT nationality FROM player WHERE club_id = ?', [c.id]).map((x) => cupoOf(x.nationality));
      expect(nat.filter((x) => x === 'NAC').length).toBeGreaterThanOrEqual(CUPO_RULES.minNac);
      expect(nat.filter((x) => x === 'EXT').length).toBeLessThanOrEqual(CUPO_RULES.maxExt);
    }
    expect(() => advanceDay(db)).toThrow(/elige tu club/);
    chooseClub(db, 7);
    let reports = 0;
    let over = false;
    while (!over && reports < 80) {
      const r = advanceDay(db);
      reports++;
      if (r.day <= REGULAR_DAYS) expect(r.userGame).not.toBeNull();
      over = r.seasonOver;
    }
    expect(over).toBe(true);
    const u = getUniverse(db)!;
    expect(u.phase).toBe('fin');
    expect(one("SELECT COUNT(*) FROM game WHERE status <> 'jugado'")).toBe(0);
    // ACB, Primera FEB, Copa, EuroLeague, EuroCup y BCL con campeón.
    expect(one('SELECT COUNT(*) FROM season_result WHERE champion_id IS NOT NULL')).toBe(6);
    // Copa: 4 + 2 + 1 eliminatorias a partido único, ocho equipos ACB.
    expect(one('SELECT COUNT(*) FROM game WHERE competition_id = 3')).toBe(7);
    for (const comp of [4, 5, 6]) expect(one("SELECT COUNT(*) FROM playoff_series WHERE season = 2026 AND competition_id = ? AND winner_id IS NOT NULL", [comp])).toBe(7);
    const series = playoffs(db, 2026, COMP.ACB);
    expect(series.length).toBe(7);
    expect(series.every((s) => s.winner_id)).toBe(true);
    for (const s of series) expect(Math.max(s.high_wins, s.low_wins)).toBe(Math.ceil(s.best_of / 2));

    // Agregados = suma de hojas de partido.
    expect(one('SELECT SUM(pts) FROM player_season_stats')).toBe(one('SELECT SUM(pts) FROM game_player_box'));
    expect(one('SELECT SUM(pts) FROM game_team_box')).toBe(one('SELECT SUM(home_pts + away_pts) FROM game'));
    expect(one('SELECT SUM(fga) FROM shot_zone_stats')).toBe(one('SELECT SUM(fga2 + fga3) FROM game_player_box'));
    // Clasificación: 34 partidos por club y victorias = derrotas en total.
    const t = standings(db, 2026, COMP.ACB);
    expect(t.every((r) => r.gp === 34)).toBe(true);
    expect(t.reduce((a, r) => a + r.w, 0)).toBe(t.reduce((a, r) => a + r.l, 0));

    // Win Shares de cada equipo cerca de sus victorias.
    const lines = playerLines(db, 2026, COMP.ACB, 'regular');
    const errs = t.map((r) => lines.filter((l) => l.club_id === r.club_id).reduce((a, l) => a + l.ws, 0) - r.w);
    console.log('errores WS', errs.map((e) => e.toFixed(1)).join(' '));
    expect(Math.max(...errs.map(Math.abs))).toBeLessThan(6);
    expect(errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length).toBeLessThan(2.5);
    // Las pantallas responden.
    expect(home(db)!.club!.id).toBe(7);
    expect(squad(db, 7, 2026).players.length).toBe(12);
    expect(leagueTable(db, 2026, COMP.ACB)[0]!.ortg).toBeGreaterThan(80);
    const pid = squad(db, 7, 2026).players[0]!.id;
    const pd = playerDetail(db, pid);
    expect(pd.career.length).toBeGreaterThan(0);
    expect(shotZones(db, pid, 2026).mine.length).toBeGreaterThan(0);
    expect(shotZones(db, pid, 2026, 5).mine.reduce((a, z) => a + z.fga, 0)).toBeGreaterThan(0);
    const gid = one('SELECT id FROM game WHERE home_id = 7 LIMIT 1');
    const gd = gameDetail(db, gid);
    expect(gd.pbp!.length).toBeGreaterThan(300);
    expect(gd.shots.length).toBe(gd.teams.reduce((a, x) => a + x.line.fga2 + x.line.fga3, 0));
    expect(teamTotals(db, 2026, COMP.ACB, 'regular').league.teamGames).toBe(18 * 34);

    const ns = startNewSeason(db);
    expect(ns.season).toBe(2027);
    expect(getUniverse(db)!.phase).toBe('regular');
    expect(one('SELECT COUNT(*) FROM club WHERE competition_id = 1')).toBe(18);
    expect(one("SELECT COUNT(*) FROM game WHERE season = 2027 AND status = 'pendiente' AND competition_id <= 2")).toBe(2 * 18 * 17);
    expect(one("SELECT COUNT(*) FROM game WHERE season = 2027 AND competition_id >= 4")).toBe(3 * 2 * 8 * 7);
    // Cantera: cada club español tiene canteranos sin ficha profesional.
    expect(one("SELECT COUNT(DISTINCT youth) FROM player WHERE youth > 0 AND club_id IS NULL AND retired = 0")).toBe(36);
    const sizes = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE retired = 0 AND club_id IS NOT NULL GROUP BY club_id');
    expect(sizes.every((s) => s.n >= 12)).toBe(true);
    expect(one('SELECT COUNT(*) FROM player_attributes WHERE season = 2027')).toBe(one('SELECT COUNT(*) FROM player WHERE retired = 0'));
    advanceDay(db);
    expect(getUniverse(db)!.game_day).toBe(1);
  }, 120_000);
});
