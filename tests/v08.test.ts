import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { advanceDay, chooseClub, createUniverse, getUniverse, startNewSeason } from '../src/core/season';
import { ageSalaryFactor, askSalary, buyPlayer, marketInfo, moveCash, payroll, signFreeAgent } from '../src/core/market';
import { playerDecision, requiredSalary, sellerWants, clubDecision } from '../src/core/transfers';
import { allPlayers, playerDetail } from '../src/core/queries';
import { ARCHETYPES } from '../src/core/archetype';

let db: Db;
const one = (sql: string, b?: unknown[]) => Number(Object.values(db.rows(sql, b)[0]!)[0]);
const ME = 9;

beforeAll(async () => {
  const sqlite3 = await sqlite3InitModule();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db = wrapDb(new (sqlite3 as any).oo1.DB(':memory:'));
  migrate(db);
  createUniverse(db, { name: 'v08', seed: 21, id: 'v08' });
  chooseClub(db, ME);
});

describe('v0.8', () => {
  it('los veteranos piden menos: el sueldo baja un 9 % por año desde los 30', () => {
    expect(ageSalaryFactor(30)).toBe(1);
    expect(ageSalaryFactor(33)).toBeCloseTo(0.73);
    const base = { ovr: 70, potential_est: 70, morale: 70 };
    expect(askSalary({ ...base, age: 36 })).toBeLessThan(askSalary({ ...base, age: 30 }) * 0.6);
  });

  it('la negociación se mueve: el jugador baja su petición si la oferta no está lejos', () => {
    const fa = db.rows<{ id: number }>("SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id IS NULL AND p.youth = 0 AND p.nationality = 'ES' ORDER BY a.ovr DESC LIMIT 1")[0]!.id;
    const need = requiredSalary(db, fa, ME, 2, null);
    let offer = Math.round(need * 0.9);
    const r1 = playerDecision(db, fa, ME, { salary: offer, years: 2, clause: null });
    expect(r1.ok).toBe(false);
    expect(r1.counter!).toBeLessThan(need);
    // Ofreciendo lo que pide ahora, firma.
    db.exec('UPDATE club SET budget = budget + 3000000 WHERE id = ?', [ME]);
    offer = r1.counter!;
    expect(signFreeAgent(db, ME, fa, offer, 2).ok).toBe(true);
  });

  it('una oferta ofensiva no le hace bajar nada', () => {
    const fa = db.rows<{ id: number }>('SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id IS NULL AND p.youth = 0 ORDER BY a.ovr DESC LIMIT 1')[0]!.id;
    const need = requiredSalary(db, fa, ME, 2, null);
    const r = playerDecision(db, fa, ME, { salary: Math.round(need * 0.5), years: 2, clause: null });
    expect(r.counter).toBe(need);
  });

  it('el club vendedor también rebaja', () => {
    const target = db.rows<{ id: number }>('SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id = 3 ORDER BY a.ovr ASC LIMIT 1')[0]!.id;
    const wanted = sellerWants(db, target).wanted;
    const r = clubDecision(db, target, ME, Math.round(wanted * 0.85));
    expect(r.ok).toBe(false);
    expect(r.counter!).toBeLessThan(wanted);
    db.exec('UPDATE club SET cash = 20000000 WHERE id = ?', [ME]);
    const info = marketInfo(db, target);
    expect(info.sellerWants).toBe(r.counter);
    expect(buyPlayer(db, ME, target, r.counter!, requiredSalary(db, target, ME, 2, null) * 1.2, 2).ok).toBe(true);
    // La ficha muestra el club y el movimiento.
    const d = playerDetail(db, target);
    expect(d.moves.some((m) => m.kind === 'traspaso' && m.to_club === ME)).toBe(true);
  });

  it('la caja se puede pasar a salarios (solo esta temporada) y devolver', () => {
    const c0 = db.rows<{ cash: number; budget: number }>('SELECT cash, budget FROM club WHERE id = ?', [ME])[0]!;
    expect(moveCash(db, ME, 1_000_000).ok).toBe(true);
    const c1 = db.rows<{ cash: number; budget: number; budget_extra: number }>('SELECT cash, budget, budget_extra FROM club WHERE id = ?', [ME])[0]!;
    expect(c1.cash).toBe(c0.cash - 1_000_000);
    expect(c1.budget).toBe(c0.budget + 1_000_000);
    expect(c1.budget_extra).toBe(1_000_000);
    expect(moveCash(db, ME, -400_000).ok).toBe(true);
    expect(one('SELECT budget_extra FROM club WHERE id = ?', [ME])).toBe(600_000);
    expect(moveCash(db, ME, 999_000_000).ok).toBe(false);
  });

  it('todos los arquetipos nuevos existen en el universo', () => {
    const seen = new Set(allPlayers(db).flatMap((p) => p.archs));
    for (const k of ['pivotpasador', 'media', 'atleta', 'lider', 'cerrador'] as const) expect(seen.has(k)).toBe(true);
    expect(ARCHETYPES.length).toBe(17);
  });

  it('el verano cura las lesiones y el presupuesto nuevo no arrastra la caja pasada a salarios', () => {
    const p = db.rows<{ id: number }>('SELECT id FROM player WHERE club_id = ? LIMIT 1', [ME])[0]!.id;
    let guard = 0;
    while (getUniverse(db)!.phase !== 'fin' && guard++ < 400) {
      if (getUniverse(db)!.phase === 'playoffs') db.exec('UPDATE player SET injury_games = 30, injury = ? WHERE id = ?', ['Esguince', p]);
      advanceDay(db);
    }
    expect(getUniverse(db)!.phase).toBe('fin');
    expect(one('SELECT injury_games FROM player WHERE id = ?', [p])).toBe(0);
    const base = one('SELECT budget - budget_extra FROM club WHERE id = ?', [ME]);
    startNewSeason(db);
    const c = db.rows<{ budget: number; budget_extra: number }>('SELECT budget, budget_extra FROM club WHERE id = ?', [ME])[0]!;
    expect(c.budget_extra).toBe(0);
    expect(c.budget).toBeLessThanOrEqual(Math.round(base * 1.22 / 50_000) * 50_000 + 50_000);
    expect(payroll(db, ME)).toBeGreaterThan(0);
  }, 240_000);
});
