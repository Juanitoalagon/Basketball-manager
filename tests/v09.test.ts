import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { advanceDay, chooseClub, convocados, createUniverse, getUniverse } from '../src/core/season';
import { signFreeAgent, rescaleEconomy, salaryForOvr } from '../src/core/market';
import { requiredSalary } from '../src/core/transfers';
import { handleRequest, reviewPromises, promiseOf } from '../src/core/promises';
import { applyAdvice, applyPreset, lineupUnits, presets, savePreset, scoutRival } from '../src/core/scouting';
import { tactics } from '../src/core/queries';
import { seasonSummary } from '../src/core/summary';
import { cupoOf } from '../src/core/names';

let db: Db;
const one = (sql: string, b?: unknown[]) => Number(Object.values(db.rows(sql, b)[0]!)[0]);
const ME = 4;

beforeAll(async () => {
  const sqlite3 = await sqlite3InitModule();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db = wrapDb(new (sqlite3 as any).oo1.DB(':memory:'));
  migrate(db);
  createUniverse(db, { name: 'v09', seed: 77, id: 'v09' });
  chooseClub(db, ME);
});

describe('v0.9', () => {
  it('escala de sueldos nueva y partidas antiguas ya convertidas', () => {
    expect(salaryForOvr(70)).toBeGreaterThan(1_000_000);
    expect(salaryForOvr(45)).toBe(72_000);
    const before = one('SELECT SUM(salary) FROM contract');
    rescaleEconomy(db); // una partida nueva ya está en la escala nueva: no cambia nada
    expect(one('SELECT SUM(salary) FROM contract')).toBe(before);
  });

  it('una promesa abarata el fichaje y, si no se cumple, el jugador pide salir', () => {
    const fa = db.rows<{ id: number }>("SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.club_id IS NULL AND p.youth = 0 AND p.nationality = 'ES' ORDER BY a.ovr DESC LIMIT 1")[0]!.id;
    const plain = requiredSalary(db, fa, ME, 2, null);
    const promised = requiredSalary(db, fa, ME, 2, null, false, { kind: 'titular', minutes: 0 });
    expect(promised).toBeLessThan(plain);
    db.exec('UPDATE club SET budget = budget + 5000000 WHERE id = ?', [ME]);
    expect(signFreeAgent(db, ME, fa, promised, 2, null, { kind: 'titular', minutes: 0 }).ok).toBe(true);
    expect(promiseOf(db, fa)?.minutes).toBe(25);
    // Cinco revisiones sin minutos: promesa rota y pide salir.
    for (let k = 0; k < 5; k++) reviewPromises(db, ME, new Map([[fa, 3]]), new Set());
    expect(promiseOf(db, fa)?.broken).toBe(1);
    expect(one('SELECT wants_out FROM player WHERE id = ?', [fa])).toBe(1);
    // Ya no se fía: prometer otra vez no sirve; ponerlo en venta, sí.
    expect(handleRequest(db, fa, 'prometer', 20).ok).toBe(false);
    expect(handleRequest(db, fa, 'vender').ok).toBe(true);
    expect(one('SELECT listed FROM player WHERE id = ?', [fa])).toBe(1);
    expect(requiredSalary(db, fa, ME, 2, null, true, { kind: 'titular', minutes: 0 })).toBe(requiredSalary(db, fa, ME, 2, null, true));
  });

  it('extracomunitarios: se pueden fichar más de dos, pero en ACB solo se convocan dos', () => {
    const exts = db.rows<{ id: number }>("SELECT id FROM player WHERE club_id IS NULL AND youth = 0 AND retired = 0 AND nationality IN ('US','AR','RS','BR','CA','ME') LIMIT 3").map((x) => x.id);
    db.exec(`UPDATE player SET club_id = ? WHERE id IN (${exts.join(',')})`, [ME]);
    const total = db.rows<{ nationality: string }>('SELECT nationality FROM player WHERE club_id = ? AND retired = 0', [ME]).filter((p) => cupoOf(p.nationality) === 'EXT').length;
    expect(total).toBeGreaterThan(2);
    const season = getUniverse(db)!.game_season;
    const acb = convocados(db, ME, season, 1).filter((r) => cupoOf(String(r.nationality)) === 'EXT').length;
    const euro = convocados(db, ME, season, 5).filter((r) => cupoOf(String(r.nationality)) === 'EXT').length;
    expect(acb).toBeLessThanOrEqual(2);
    expect(euro).toBeGreaterThan(acb);
  });

  it('informe del rival con consejos aplicables, planes guardados y quintetos', () => {
    const g = db.rows<{ id: number }>("SELECT id FROM game WHERE status = 'pendiente' AND (home_id = ? OR away_id = ?) ORDER BY day LIMIT 1", [ME, ME])[0]!.id;
    const r = scoutRival(db, g)!;
    expect(r.danger.name.length).toBeGreaterThan(0);
    const m = r.advice.find((a) => a.advice.kind === 'matchup')!;
    expect(m).toBeDefined();
    applyAdvice(db, ME, m.advice);
    if (m.advice.kind === 'matchup') expect(tactics(db, ME).defense?.matchups?.[m.advice.attacker]).toBe(m.advice.defender);
    savePreset(db, ME, 0, 'Contra grandes', { ...tactics(db, ME), pace: 'lento' });
    expect(presets(db, ME)[0]!.name).toBe('Contra grandes');
    expect(applyPreset(db, ME, 0)!.pace).toBe('lento');
    for (let k = 0; k < 8; k++) advanceDay(db);
    const units = lineupUnits(db, ME, getUniverse(db)!.game_season);
    expect(units.length).toBeGreaterThan(0);
    expect(units[0]!.players.length).toBe(5);
  }, 120_000);

  it('resumen de la temporada', () => {
    let guard = 0;
    while (getUniverse(db)!.phase !== 'fin' && guard++ < 400) advanceDay(db);
    const s = seasonSummary(db);
    expect(s.pos).toBeGreaterThan(0);
    expect(s.money.gate).toBeGreaterThan(0);
    expect(s.money.nextBudget).toBeGreaterThan(1_000_000);
    expect(s.objective?.result).toBeTruthy();
    expect(s.leaders.pts).not.toBeNull();
  }, 300_000);
});
