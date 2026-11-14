import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { advanceDay, chooseClub, createUniverse, getUniverse, startNewSeason } from '../src/core/season';
import { requiredSalary, sellerWants } from '../src/core/transfers';
import { askSalary, buyPlayer, finances, marketInfo, marketValue, offersFor, payroll, releasePlayer, renewPlayer, sellPlayer, signFreeAgent } from '../src/core/market';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite3: any;
let db: Db;
const one = (sql: string, b?: unknown[]) => Number(Object.values(db.rows(sql, b)[0]!)[0]);
const ME = 10;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  db = wrapDb(new sqlite3.oo1.DB(':memory:'));
  migrate(db);
  createUniverse(db, { name: 'Mercado', seed: 99, id: 'm' });
  chooseClub(db, ME);
});

describe('economía', () => {
  it('sueldos y valores crecen con la media y bajan con la edad', () => {
    expect(askSalary({ ovr: 75, age: 27, potential_est: 75, morale: 70 })).toBeGreaterThan(askSalary({ ovr: 60, age: 27, potential_est: 60, morale: 70 }) * 3);
    expect(marketValue({ ovr: 70, age: 22, potential_est: 78, morale: 70 }, 3)).toBeGreaterThan(marketValue({ ovr: 70, age: 33, potential_est: 70, morale: 70 }, 3));
    expect(marketValue({ ovr: 70, age: 27, potential_est: 70, morale: 70 }, 0)).toBeLessThan(marketValue({ ovr: 70, age: 27, potential_est: 70, morale: 70 }, 2));
  });
  it('todos los clubes empiezan con presupuesto para su plantilla y algo de caja', () => {
    for (const c of db.rows<{ id: number; budget: number; cash: number }>('SELECT id, budget, cash FROM club WHERE competition_id IS NOT 13')) {
      expect(c.budget).toBeGreaterThanOrEqual(payroll(db, c.id));
      expect(c.cash).toBeGreaterThan(0);
    }
    expect(one('SELECT COUNT(*) FROM player WHERE club_id IS NULL AND retired = 0 AND youth = 0')).toBe(30);
    expect(db.rows<{ name: string }>('SELECT name FROM club WHERE id = 1')[0]!.name).toBe('Real Madrid');
  });
});

describe('operaciones', () => {
  it('fichar un agente libre respeta lo que pide y el presupuesto', () => {
    const fa = db.rows<{ id: number }>("SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id IS NULL AND p.youth = 0 AND p.nationality = 'ES' ORDER BY a.ovr ASC LIMIT 1")[0]!.id;
    const info = marketInfo(db, fa);
    expect(signFreeAgent(db, ME, fa, Math.round(info.ask * 0.5), 2).ok).toBe(false);
    db.exec('UPDATE club SET budget = budget + 500000 WHERE id = ?', [ME]);
    // Lo que pide depende del atractivo del club y de los años: se negocia con su cifra.
    const r = signFreeAgent(db, ME, fa, requiredSalary(db, fa, ME, 2, null), 2);
    expect(r.ok).toBe(true);
    expect(one('SELECT club_id FROM contract WHERE player_id = ?', [fa])).toBe(ME);
  });
  it('comprar: rechaza ofertas bajas y acepta por encima del valor', () => {
    const target = db.rows<{ id: number }>('SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id = 3 ORDER BY a.ovr ASC LIMIT 1')[0]!.id;
    const info = marketInfo(db, target);
    db.exec('UPDATE club SET cash = 50000000, budget = budget + 2000000 WHERE id = ?', [ME]);
    expect(buyPlayer(db, ME, target, Math.round(info.value * 0.5), info.ask, 2).ok).toBe(false);
    const cash3 = one('SELECT cash FROM club WHERE id = 3');
    const fee = sellerWants(db, target).wanted;
    const r = buyPlayer(db, ME, target, fee, requiredSalary(db, target, ME, 2, null), 2);
    expect(r.ok).toBe(true);
    expect(one('SELECT cash FROM club WHERE id = 3')).toBe(cash3 + fee);
    expect(one("SELECT COUNT(*) FROM transfer WHERE kind = 'traspaso'")).toBe(1);
  });
  it('vender, rescindir y renovar', () => {
    const mine = db.rows<{ id: number }>('SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id = ? ORDER BY a.ovr DESC', [ME]);
    const offers = offersFor(db, mine[2]!.id);
    if (offers.length) expect(sellPlayer(db, mine[2]!.id, offers[0]!.club_id).ok).toBe(true);
    const last = mine[mine.length - 1]!.id;
    const before = one('SELECT cash FROM club WHERE id = ?', [ME]);
    expect(releasePlayer(db, last).ok).toBe(true);
    expect(one('SELECT cash FROM club WHERE id = ?', [ME])).toBeLessThan(before);
    expect(one('SELECT club_id IS NULL FROM player WHERE id = ?', [last])).toBe(1);
    const exp = db.rows<{ player_id: number }>('SELECT player_id FROM contract WHERE club_id = ? AND until = 2026 LIMIT 1', [ME])[0]?.player_id ?? db.rows<{ player_id: number }>('SELECT player_id FROM contract WHERE club_id = ? LIMIT 1', [ME])[0]!.player_id;
    const i = marketInfo(db, exp);
    if (i.canRenew) expect(renewPlayer(db, exp, Math.round(i.ask * 1.2), 3).ok).toBe(true);
    expect(finances(db, ME).contracts.length).toBeGreaterThan(9);
  });
});

describe('varias temporadas con mercado, lesiones y moral', () => {
  it('las plantillas, las cuentas y el mercado se mantienen sanos', () => {
    for (let s = 0; s < 3; s++) {
      let over = false;
      while (!over) over = advanceDay(db).seasonOver;
      if (s === 0) {
        expect(one('SELECT COUNT(*) FROM news WHERE kind = ?', ['lesion'])).toBeGreaterThan(0);
        expect(one('SELECT MIN(morale) FROM player WHERE club_id IS NOT NULL')).toBeLessThan(70);
      }
      startNewSeason(db);
      const sizes = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE retired = 0 AND club_id IS NOT NULL GROUP BY club_id').map((x) => x.n);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(16);
      // Todo jugador con club tiene contrato vigente y viceversa.
      expect(one('SELECT COUNT(*) FROM player p LEFT JOIN contract c ON c.player_id = p.id WHERE p.club_id IS NOT NULL AND p.retired = 0 AND c.player_id IS NULL AND p.club_id NOT IN (SELECT id FROM club WHERE competition_id = 13)')).toBe(0);
      expect(one('SELECT COUNT(*) FROM contract c JOIN player p ON p.id = c.player_id WHERE p.club_id IS NOT c.club_id')).toBe(0);
      expect(one('SELECT COUNT(*) FROM contract WHERE until < (SELECT game_season FROM universe)')).toBe(0);
      const fa = one('SELECT COUNT(*) FROM player WHERE club_id IS NULL AND retired = 0 AND youth = 0');
      expect(fa).toBeGreaterThan(10);
      expect(fa).toBeLessThan(250);
    }
    expect(getUniverse(db)!.game_season).toBe(2029);
    expect(one('SELECT COUNT(*) FROM club_season_finance WHERE club_id <= 72')).toBe(72 * 3);
    // Nadie se arruina sin control.
    expect(one('SELECT MIN(cash) FROM club WHERE id <> ?', [ME])).toBeGreaterThan(-2_000_000);
  }, 180_000);
});
