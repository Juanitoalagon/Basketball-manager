import { describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, setSetting } from '../src/core/schema';
import { advanceDay, chooseClub, createUniverse } from '../src/core/season';
import { migrateCalendar, seasonCalendar } from '../src/core/calendar';

describe('calendario', () => {
  it('fechas ordenadas, sin choques y con la Copa en su semana', () => {
    const c = seasonCalendar(2026);
    expect(c.league.length).toBe(35);
    expect(c.euro.length).toBe(15);
    expect(c.copa.length).toBe(3);
    const dates = c.slots.map((s) => s.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);
    expect(c.slots[c.league[1]! - 1]!.date).toBe('2026-10-03');
    expect(c.copa[0]).toBeGreaterThan(c.league[17]!);
    expect(c.copa[2]).toBeLessThan(c.league[18]!);
    expect(c.playoffs[0]).toBeGreaterThan(c.league[34]!);
  });
  it('recoloca una partida antigua sin perder el orden', async () => {
    const sqlite3 = await sqlite3InitModule();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = wrapDb(new (sqlite3 as any).oo1.DB(':memory:'));
    migrate(db);
    createUniverse(db, { name: 'C', seed: 5, id: 'c' });
    chooseClub(db, 3);
    // Simula el calendario viejo: liga en el día = jornada y Europa en días pares.
    db.exec("UPDATE game SET day = round WHERE stage = 'regular' AND competition_id <= 2");
    db.exec("UPDATE game SET day = round * 2 WHERE stage = 'grupos'");
    setSetting(db, 'calendar', '1');
    migrateCalendar(db);
    const clash = db.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM (SELECT day, c, COUNT(*) k FROM (SELECT day, home_id AS c FROM game WHERE competition_id <= 6 UNION ALL SELECT day, away_id FROM game WHERE competition_id <= 6) GROUP BY day, c HAVING k > 1)`)[0]!.n;
    expect(clash).toBe(0);
    for (let i = 0; i < 6; i++) advanceDay(db);
    expect(db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE status = 'jugado'")[0]!.n).toBeGreaterThan(0);
  });
});
