import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { advanceDay, chooseClub, createUniverse, startNewSeason } from '../src/core/season';
import { awardsView, clubHistory, records, scoutPlayer, signYouth, youthReport, SCOUT_COST } from '../src/core/awards';

let db: Db;
const one = (sql: string, b?: unknown[]) => Number(Object.values(db.rows(sql, b)[0]!)[0]);
const ME = 4;

beforeAll(async () => {
  const sqlite3 = await sqlite3InitModule();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db = wrapDb(new (sqlite3 as any).oo1.DB(':memory:'));
  migrate(db);
  createUniverse(db, { name: 'Premios', seed: 31, id: 'p' });
  chooseClub(db, ME);
  let over = false;
  while (!over) over = advanceDay(db).seasonOver;
}, 120_000);

describe('premios y seguimiento', () => {
  it('reparte los premios al acabar la temporada', () => {
    const a = awardsView(db, 2026);
    for (const comp of [1, 2]) {
      expect(a.filter((r) => r.competition_id === comp && r.award === 'mvp').length).toBe(3);
      expect(a.filter((r) => r.competition_id === comp && r.award === 'quinteto').length).toBe(5);
      const five = a.filter((r) => r.competition_id === comp && r.award === 'quinteto').map((r) => r.pos1);
      expect(five.filter((p) => p === 'C').length).toBe(1);
    }
    expect(a.filter((r) => r.award === 'mvp_final').length).toBeGreaterThanOrEqual(4);
    // El MVP de la ACB juega en un club de la ACB.
    const mvp = a.find((r) => r.competition_id === 1 && r.award === 'mvp' && r.rank === 1)!;
    expect(one('SELECT COUNT(*) FROM game WHERE season = 2026 AND competition_id = 1 AND (home_id = ? OR away_id = ?)', [mvp.club_id, mvp.club_id])).toBeGreaterThan(0);
  });
  it('récords e historia del club', () => {
    const r = records(db);
    expect(r.game.pts.length).toBe(10);
    expect(r.game.pts[0]!.v).toBeGreaterThanOrEqual(r.game.pts[9]!.v);
    expect(r.career.pts[0]!.v).toBeGreaterThan(300);
    const h = clubHistory(db, ME);
    expect(h.seasons.length).toBe(1);
    expect(h.seasons[0]!.w + h.seasons[0]!.l).toBe(34);
    expect(h.seasons[0]!.pos).toBeGreaterThan(0);
  });
  it('informe de jóvenes, ojeo y fichaje de un juvenil ajeno', () => {
    const rep = youthReport(db, 21);
    expect(rep.rows.length).toBeGreaterThan(20);
    expect(rep.rows.every((r) => r.age <= 21)).toBe(true);
    const target = rep.rows.find((r) => r.club_id !== null && r.club_id !== ME)!;
    db.exec('UPDATE club SET cash = 5000000 WHERE id = ?', [ME]);
    expect(scoutPlayer(db, target.id, ME).ok).toBe(true);
    expect(one('SELECT cash FROM club WHERE id = ?', [ME])).toBe(5_000_000 - SCOUT_COST);
    expect(Math.abs(one('SELECT potential_est - potential FROM player WHERE id = ?', [target.id]))).toBeLessThanOrEqual(2);
    expect(scoutPlayer(db, target.id, ME).ok).toBe(false);
    const other = db.rows<{ id: number }>('SELECT id FROM player WHERE youth > 0 AND youth <> ? AND club_id IS NULL AND retired = 0 LIMIT 1', [ME])[0]!.id;
    expect(signYouth(db, other, ME).ok).toBe(true); // la temporada ha terminado: es verano
    expect(one('SELECT youth FROM player WHERE id = ?', [other])).toBe(ME);
    startNewSeason(db);
    expect(awardsView(db, 2026).length).toBeGreaterThan(20);
  });
});
