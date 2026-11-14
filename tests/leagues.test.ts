import { beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'fs';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { advanceDay, chooseClub, createUniverse, getUniverse, standings, startNewSeason } from '../src/core/season';
import { FAST_COMPS, NBA, NCAA, LEAGUES } from '../src/core/leagues';
import { payroll } from '../src/core/market';
import { playerLines } from '../src/core/queries';

let db: Db;
const one = (sql: string, b?: unknown[]) => Number(Object.values(db.rows(sql, b)[0]!)[0]);
const ME = 4;

beforeAll(async () => {
  const sqlite3 = await sqlite3InitModule();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db = wrapDb(new (sqlite3 as any).oo1.DB(':memory:'));
  migrate(db);
  createUniverse(db, { name: 'ligas', seed: 33, id: 'lg' });
  chooseClub(db, ME);
});

describe('ligas extranjeras', () => {
  it('crea las ligas, los clubes y el calendario', () => {
    for (const L of LEAGUES) expect(one('SELECT COUNT(*) FROM club WHERE competition_id = ?', [L.id])).toBe(L.id === NBA ? 30 : L.id === NCAA ? 16 : L.id === 9 ? 18 : L.id === 11 ? 12 : 16);
    expect(one('SELECT COUNT(*) FROM game WHERE season = 2026 AND competition_id = ?', [NBA])).toBe(30 * 29);
    // Nadie juega dos veces el mismo día (ni con Europa).
    expect(one(`SELECT COUNT(*) FROM (SELECT c, d FROM (SELECT home_id AS c, COALESCE(date, day) AS d FROM game WHERE season = 2026 AND competition_id >= 4 UNION ALL SELECT away_id, COALESCE(date, day) FROM game WHERE season = 2026 AND competition_id >= 4) GROUP BY c, d HAVING COUNT(*) > 1)`)).toBe(0);
    // Los universitarios no tienen contrato; los de la NBA sí.
    expect(one(`SELECT COUNT(*) FROM contract k JOIN club c ON c.id = k.club_id WHERE c.competition_id = ${NCAA}`)).toBe(0);
    expect(one(`SELECT MIN(budget) FROM club WHERE competition_id = ${NBA}`)).toBeGreaterThan(20_000_000);
  });

  it('presupuestos ACB de media tabla entre 5 y 8 M€', () => {
    const b = db.rows<{ budget: number }>('SELECT budget FROM club WHERE competition_id = 1 ORDER BY budget').map((x) => x.budget);
    const mid = b[Math.floor(b.length / 2)]!;
    expect(mid).toBeGreaterThan(5_000_000);
    expect(mid).toBeLessThan(8_500_000);
    expect(payroll(db, ME)).toBeGreaterThan(3_000_000);
  });

  it('una temporada entera: se juegan todas las ligas, con estadísticas y campeones', () => {
    const t0 = Date.now();
    let guard = 0;
    while (getUniverse(db)!.phase !== 'fin' && guard++ < 400) advanceDay(db);
    expect(getUniverse(db)!.phase).toBe('fin');
    expect(one("SELECT COUNT(*) FROM game WHERE season = 2026 AND status = 'rapido'")).toBe(0);
    for (const c of FAST_COMPS) expect(one('SELECT champion_id FROM season_result WHERE season = 2026 AND competition_id = ?', [c])).toBeGreaterThan(0);
    const nba = playerLines(db, 2026, NBA, 'regular').filter((l) => l.gp >= 20);
    const top = nba.sort((a, b) => b.pts / b.gp - a.pts / a.gp)[0]!;
    expect(top.pts / top.gp).toBeGreaterThan(20);
    expect(top.pts / top.gp).toBeLessThan(40);
    const t = standings(db, 2026, NBA);
    expect(t[0]!.w + t[0]!.l).toBe(58);
    // La taquilla ha entrado en caja.
    expect(one('SELECT gate FROM club WHERE id = ?', [ME])).toBeGreaterThan(0);
    const dump: Record<string, unknown> = { secs: (Date.now() - t0) / 1000 };
    for (const c of [...FAST_COMPS, 1]) {
      const ls = playerLines(db, 2026, c, 'regular').filter((l) => l.gp >= 10);
      const per = (f: (l: (typeof ls)[number]) => number) => ls.map((l) => f(l) / l.gp).sort((a, b) => b - a).slice(0, 3).map((x) => Math.round(x * 10) / 10);
      dump[c] = { pts: per((l) => l.pts), reb: per((l) => l.orb + l.drb), ast: per((l) => l.ast), t3: per((l) => l.fga3), min: per((l) => l.sec / 60), team: Math.round(standings(db, 2026, c).reduce((a, r) => a + r.pf / Math.max(1, r.w + r.l), 0) / standings(db, 2026, c).length) };
    }
    writeFileSync('/tmp/leagues.json', JSON.stringify(dump));
  }, 300_000);

  it('verano: universitarios al mercado y a la NBA, novatos a la NCAA, dos ascensos', () => {
    const acb = standings(db, 2026, 1).slice(-2).map((r) => r.club_id);
    startNewSeason(db);
    for (const id of acb) expect(one('SELECT competition_id FROM club WHERE id = ?', [id])).toBe(2);
    expect(one("SELECT COUNT(*) FROM transfer WHERE kind = 'universidad' AND season = 2027")).toBeGreaterThan(5);
    expect(one("SELECT COUNT(*) FROM transfer WHERE kind = 'draft' AND season = 2027")).toBeGreaterThan(5);
    expect(one(`SELECT MIN(n) FROM (SELECT COUNT(*) AS n FROM player p JOIN club c ON c.id = p.club_id WHERE c.competition_id = ${NCAA} AND p.retired = 0 GROUP BY c.id)`)).toBeGreaterThanOrEqual(13);
    expect(one(`SELECT MAX(2027 - p.birth_year) FROM player p JOIN club c ON c.id = p.club_id WHERE c.competition_id = ${NCAA} AND p.retired = 0`)).toBeLessThanOrEqual(22);
    expect(one('SELECT COUNT(*) FROM game WHERE season = 2027 AND competition_id = ?', [NBA])).toBe(30 * 29);
  }, 120_000);
});
