import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { chooseClub, convocados, createUniverse, getUniverse } from '../src/core/season';
import { ROOKIE_SALARY, releasePlayer, signFreeAgent } from '../src/core/market';
import { cupoCounts, getTraining, promoteYouth, releaseYouth, scoutNoise, setTraining, trainingBonus, upgradeClub, upgradeCost } from '../src/core/world';
import { CUPO_RULES, cupoOf } from '../src/core/names';
import { Rng } from '../src/core/rng';
import { generatePlayer } from '../src/core/attributes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite3: any;
let db: Db;
const one = (sql: string, b?: unknown[]) => Number(Object.values(db.rows(sql, b)[0]!)[0]);
const ME = 5;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  db = wrapDb(new sqlite3.oo1.DB(':memory:'));
  migrate(db);
  createUniverse(db, { name: 'Mundo', seed: 7, id: 'w' });
  chooseClub(db, ME);
});

describe('cupos', () => {
  it('clasifica nacionalidades', () => {
    expect(cupoOf('ES')).toBe('NAC');
    expect(cupoOf('FR')).toBe('COM');
    expect(cupoOf('UE')).toBe('COM');
    expect(cupoOf('US')).toBe('EXT');
    expect(cupoOf('RS')).toBe('EXT');
  });
  it('deja fichar un tercer extracomunitario, pero en la liga solo se convocan dos', () => {
    // Forzamos dos extracomunitarios en la plantilla.
    const ids = db.rows<{ id: number }>("SELECT id FROM player WHERE club_id = ? AND nationality <> 'ES' ORDER BY id", [ME]).map((x) => x.id);
    const ext = db.rows<{ id: number }>("SELECT id FROM player WHERE club_id = ? AND nationality = 'US'", [ME]).length;
    for (let i = 0; i < Math.max(0, CUPO_RULES.maxExt - ext) && i < ids.length; i++) db.exec("UPDATE player SET nationality = 'US' WHERE id = ?", [ids[i]]);
    expect(cupoCounts(db, ME).EXT).toBeGreaterThanOrEqual(CUPO_RULES.maxExt);
    db.exec('UPDATE club SET cash = 50000000, budget = 50000000 WHERE id = ?', [ME]);
    const fa = db.rows<{ id: number }>('SELECT id FROM player WHERE club_id IS NULL AND youth = 0 AND retired = 0 LIMIT 1')[0]!.id;
    db.exec("UPDATE player SET nationality = 'US' WHERE id = ?", [fa]);
    const r = signFreeAgent(db, ME, fa, 9_000_000, 1);
    expect(r.ok).toBe(true);
    expect(cupoCounts(db, ME).EXT).toBeGreaterThan(CUPO_RULES.maxExt);
    const nat = (rows: Record<string, unknown>[]) => rows.filter((x) => cupoOf(String(x.nationality)) === 'EXT').length;
    expect(nat(convocados(db, ME, getUniverse(db)!.game_season, 1))).toBe(CUPO_RULES.maxExt);
    expect(nat(convocados(db, ME, getUniverse(db)!.game_season, 4))).toBeGreaterThan(CUPO_RULES.maxExt);
  });
  it('no deja bajar del mínimo de nacionales', () => {
    const nac = db.rows<{ id: number }>("SELECT id FROM player WHERE club_id = ? AND nationality = 'ES' ORDER BY id", [ME]).map((x) => x.id);
    // Dejamos exactamente el mínimo.
    for (const id of nac.slice(CUPO_RULES.minNac)) db.exec("UPDATE player SET nationality = 'FR' WHERE id = ?", [id]);
    expect(cupoCounts(db, ME).NAC).toBe(CUPO_RULES.minNac);
    const r = releasePlayer(db, nac[0]!);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/nacional/i);
  });
});

describe('cantera', () => {
  it('cada club español tiene juveniles y puedo subirlos o liberarlos', () => {
    const mine = db.rows<{ id: number; nationality: string }>('SELECT id, nationality FROM player WHERE youth = ? AND retired = 0', [ME]);
    expect(mine.length).toBeGreaterThanOrEqual(3);
    // Hago hueco en la plantilla si hace falta.
    const n = one('SELECT COUNT(*) FROM player WHERE club_id = ?', [ME]);
    expect(n).toBeLessThan(16);
    const y = mine.find((x) => x.nationality === 'ES') ?? mine[0]!;
    db.exec("UPDATE player SET nationality = 'ES' WHERE id = ?", [y.id]);
    const r = promoteYouth(db, y.id, ME);
    expect(r.ok).toBe(true);
    expect(one('SELECT club_id FROM player WHERE id = ?', [y.id])).toBe(ME);
    expect(one('SELECT youth FROM player WHERE id = ?', [y.id])).toBe(0);
    expect(one('SELECT salary FROM contract WHERE player_id = ?', [y.id])).toBe(ROOKIE_SALARY);
    const other = mine.find((x) => x.id !== y.id)!;
    expect(releaseYouth(db, other.id, ME).ok).toBe(true);
    expect(promoteYouth(db, other.id, ME).ok).toBe(false);
  });
  it('mejores ojeadores estiman mejor', () => {
    expect(scoutNoise(5)).toBeLessThan(scoutNoise(1));
    expect(scoutNoise(1)).toBe(8);
  });
});

describe('entrenamiento e instalaciones', () => {
  it('el foco mejora sus atributos y la intensidad lo escala', () => {
    const rng = new Rng(3);
    const p = generatePlayer(rng, { pos: 'SG', quality: 55, age: 20, season: 2026, nationality: 'ES', name: 'X' });
    const sum = (t: Parameters<typeof trainingBonus>[2], f: number) => {
      let s = 0;
      for (let i = 0; i < 200; i++) {
        const a = trainingBonus(p.attrs, 20, t, f, new Rng(i));
        s += a.sht3 - p.attrs.sht3;
      }
      return s / 200;
    };
    const suave = sum({ focus: 'tiro', intensity: 'suave' }, 3);
    const duro = sum({ focus: 'tiro', intensity: 'duro' }, 3);
    const otro = sum({ focus: 'defensa', intensity: 'duro' }, 3);
    expect(duro).toBeGreaterThan(suave);
    expect(otro).toBe(0);
    expect(sum({ focus: 'tiro', intensity: 'normal' }, 5)).toBeGreaterThan(sum({ focus: 'tiro', intensity: 'normal' }, 1));
  });
  it('guarda la configuración y cobra las mejoras', () => {
    setTraining(db, ME, { focus: 'defensa', intensity: 'duro' });
    expect(getTraining(db, ME)).toEqual({ focus: 'defensa', intensity: 'duro' });
    const before = one('SELECT cash FROM club WHERE id = ?', [ME]);
    const lvl = one('SELECT facilities FROM club WHERE id = ?', [ME]);
    expect(upgradeClub(db, ME, 'facilities').ok).toBe(true);
    expect(one('SELECT facilities FROM club WHERE id = ?', [ME])).toBe(lvl + 1);
    expect(one('SELECT cash FROM club WHERE id = ?', [ME])).toBe(before - upgradeCost('facilities', lvl));
  });
});
