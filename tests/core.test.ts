import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { Rng, mixSeed } from '../src/core/rng';
import { buildSave, readSave, sha256Hex } from '../src/core/savefile';
import { SCHEMA_VERSION, migrate, schemaVersion, type Db } from '../src/core/schema';
import { createUniverse } from '../src/core/season';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite3: any;
export const fresh = (): { db: Db; raw: any } => {
  const raw = new sqlite3.oo1.DB(':memory:');
  const db = wrapDb(raw);
  migrate(db);
  return { db, raw };
};
const one = (db: Db, sql: string) => Number(Object.values(db.rows(sql)[0]!)[0]);

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

describe('semillas', () => {
  it('la misma semilla da la misma secuencia', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const xs = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c.next())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mixSeed(1, 2)).toBe(mixSeed(1, 2));
    expect(mixSeed(1, 2)).not.toBe(mixSeed(2, 1));
  });
});

describe('esquema', () => {
  it('migra una base vacía y es idempotente', () => {
    const { db } = fresh();
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(one(db, 'SELECT COUNT(*) FROM schema_migrations')).toBe(SCHEMA_VERSION);
  });
  it('rechaza una partida de una versión más nueva', () => {
    const { db } = fresh();
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/Actualiza la app/);
  });
});

describe('fichero de partida', () => {
  const info = { schemaVersion: SCHEMA_VERSION, engineVersion: 'x', universeId: 'u-9', universeName: 'P', revision: 4, gameSeason: 2026, gameDay: 4, tables: { club: 36 } };
  const makeDb = () => {
    const { db, raw } = fresh();
    createUniverse(db, { name: 'P', seed: 1, id: 'u-9' });
    return sqlite3.capi.sqlite3_js_db_export(raw) as Uint8Array;
  };
  it('exportar e importar devuelve una base idéntica', async () => {
    const bytes = makeDb();
    const { manifest, dbBytes } = await readSave(await buildSave(bytes, info));
    expect(manifest.universeId).toBe('u-9');
    expect(manifest.revision).toBe(4);
    expect(await sha256Hex(dbBytes)).toBe(await sha256Hex(bytes));
  });
  it('rechaza ficheros dañados, incompletos o de un formato más nuevo', async () => {
    const { zipSync, unzipSync, strToU8, strFromU8 } = await import('fflate');
    const good = await buildSave(makeDb(), info);
    await expect(readSave(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/no es una partida válida/);
    const parts = unzipSync(good);
    const tampered = new Uint8Array(parts['universe.sqlite']!);
    tampered[2000]! ^= 0xff;
    await expect(readSave(zipSync({ ...parts, 'universe.sqlite': tampered }))).rejects.toThrow(/suma de verificación/);
    await expect(readSave(zipSync({ 'manifest.json': parts['manifest.json']! }))).rejects.toThrow(/faltan partes/);
    const mf = JSON.parse(strFromU8(parts['manifest.json']!));
    mf.format = 99;
    await expect(readSave(zipSync({ ...parts, 'manifest.json': strToU8(JSON.stringify(mf)) }))).rejects.toThrow(/formato más nuevo/);
  });
});
