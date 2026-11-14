import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { advanceDay, chooseClub, createUniverse, getUniverse, startNewSeason } from '../src/core/season';
import { individualBonus, loanIn, loanOptions, loanOut, loansOf, objectiveOf, recallLoan, setIndividualPlan, trainingOverview } from '../src/core/club';
import { payroll } from '../src/core/market';
import { Rng } from '../src/core/rng';
import { generatePlayer } from '../src/core/attributes';

let db: Db;
const one = (sql: string, b?: unknown[]) => Number(Object.values(db.rows(sql, b)[0]!)[0]);
const ME = 9;

beforeAll(async () => {
  const sqlite3 = await sqlite3InitModule();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db = wrapDb(new (sqlite3 as any).oo1.DB(':memory:'));
  migrate(db);
  createUniverse(db, { name: 'Club', seed: 12, id: 'cl' });
  chooseClub(db, ME);
});

describe('club', () => {
  it('objetivos, química y tácticas de la IA desde el principio', () => {
    expect(objectiveOf(db, 2026, ME)).not.toBeNull();
    expect(one('SELECT COUNT(*) FROM objective WHERE season = 2026')).toBe(36);
    expect(one("SELECT COUNT(*) FROM tactics WHERE club_id <> ?", [ME])).toBeGreaterThan(60);
    expect(one('SELECT MIN(chemistry) FROM club')).toBeGreaterThan(10);
  });
  it('cesión: sale, cuenta medio sueldo en cada club y vuelve', () => {
    db.exec('UPDATE club SET budget = budget + 3000000 WHERE id = ?', [ME]);
    const young = db.rows<{ id: number }>('SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id = ? ORDER BY a.ovr ASC LIMIT 1', [ME])[0]!.id;
    const opts = loanOptions(db, young);
    expect(opts.length).toBeGreaterThan(0);
    const before = payroll(db, ME);
    const r = loanOut(db, young, opts[0]!.club_id);
    expect(r.ok).toBe(true);
    expect(one('SELECT club_id FROM player WHERE id = ?', [young])).toBe(opts[0]!.club_id);
    expect(payroll(db, ME)).toBeLessThan(before);
    expect(loansOf(db, ME).length).toBe(1);
    expect(recallLoan(db, young).ok).toBe(true);
    expect(one('SELECT club_id FROM player WHERE id = ?', [young])).toBe(ME);
    // Pedir cedido a alguien que no juega en su club.
    const other = db.rows<{ id: number }>("SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id = 2 AND p.nationality = 'ES' ORDER BY a.ovr ASC LIMIT 1")[0]!.id;
    expect(loanIn(db, other, 0.3).ok).toBe(false);
    const li = loanIn(db, other, 0.6);
    expect(li.ok).toBe(true);
    loanOut(db, young, loanOptions(db, young)[0]!.club_id);
  });
  it('entrenamiento individual: plazas limitadas y efecto mayor en los jóvenes', () => {
    const t = trainingOverview(db, ME);
    expect(t.slots).toBeGreaterThanOrEqual(3);
    const ids = t.players.map((p) => p.id);
    for (let i = 0; i < t.slots; i++) expect(setIndividualPlan(db, ids[i]!, ME, 'attr:sht3').ok).toBe(true);
    expect(setIndividualPlan(db, ids[t.slots]!, ME, 'attr:sht3').ok).toBe(false);
    const p = generatePlayer(new Rng(2), { pos: 'SG', quality: 50, age: 18, season: 2026, nationality: 'ES', name: 'J' });
    const young = individualBonus(p.attrs, 'attr:sht3', 18, 1, new Rng(1)).sht3 - p.attrs.sht3;
    const old = individualBonus(p.attrs, 'attr:sht3', 31, 1, new Rng(1)).sht3 - p.attrs.sht3;
    expect(young).toBeGreaterThan(old);
  });
  it('una temporada: cansancio, moral por minutos, objetivos evaluados y cesiones terminadas', () => {
    let over = false;
    while (!over) over = advanceDay(db).seasonOver;
    expect(one('SELECT MAX(fatigue) FROM player')).toBeGreaterThan(0);
    expect(one('SELECT COUNT(*) FROM player WHERE mood_note IS NOT NULL')).toBeGreaterThan(100);
    expect(one('SELECT COUNT(*) FROM objective WHERE season = 2026 AND result IS NOT NULL')).toBe(36);
    expect(one('SELECT COUNT(*) FROM news WHERE club_id = ? AND kind = ?', [ME, 'directiva'])).toBe(1);
    const budget = one('SELECT budget FROM club WHERE id = ?', [ME]);
    startNewSeason(db);
    expect(getUniverse(db)!.game_season).toBe(2027);
    expect(one('SELECT COUNT(*) FROM loan')).toBe(0);
    expect(one('SELECT budget FROM club WHERE id = ?', [ME])).not.toBe(budget);
    expect(one('SELECT MAX(fatigue) FROM player')).toBe(0);
  }, 120_000);
});
