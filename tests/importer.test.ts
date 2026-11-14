import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { zipSync, strToU8 } from 'fflate';
import { wrapDb } from '../src/db/adapter';
import { migrate, type Db } from '../src/core/schema';
import { createRealUniverse, parseCsv, readSuperManagerZip, realSummary } from '../src/core/importer';
import { advanceDay, chooseClub } from '../src/core/season';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite3: any;
let db: Db;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  db = wrapDb(new sqlite3.oo1.DB(':memory:'));
  migrate(db);
});

// Datos de ejemplo con el mismo formato que SuperManagerLab (inventados).
const actas = ['jornada,partido,equipo,rival,local,jugador,minutos,val,gana,tanteo,tanteo_rival,edicion,puntos,k'];
const vals = ['jornada,jugador,corto,equipo,posicion,cupo,puntos,min_jornada,precio'];
const teams = [['Club Uno', 'UNO'], ['Club Dos', 'DOS']];
teams.forEach(([t, code], ti) => {
  for (let i = 0; i < 12; i++) {
    const short = `${'ABCDEFGHIJKL'[i]}. Jugador${ti}${i}`;
    vals.push(`3,Nombre Jugador${ti}${i},${short},${code},${['Base', 'Alero', 'Pivot'][i % 3]},${i % 4 ? 'nacional' : 'extracomunitario'},10,,500000`);
    for (let d = 1; d <= 3; d++) actas.push(`${d},${d * 10 + ti},${t},${teams[1 - ti]![0]},${ti ? 'False' : 'True'},${short},${30 - i * 2},${(20 - i * 1.6).toFixed(1)},True,80,70,0,${20 - i},x`);
  }
});
const hist = ['jornada,partido,equipo,rival,local,jugador,minutos,val,gana,tanteo,tanteo_rival,edicion,puntos,k', '1,1,Club Uno 4 oct 2025,Otro,True,A. Jugador00,25,15,True,80,70,90,15,a jugador00|club uno'];
const zip = zipSync({ 'datos/actas_temporada.csv': strToU8(actas.join('\n')), 'datos/valoraciones.csv': strToU8(vals.join('\n')), 'datos/historico_acb_v3.csv': strToU8(hist.join('\n')) });

describe('importador de SuperManagerLab', () => {
  it('lee CSV con comillas', () => {
    expect(parseCsv('a,b\n"x, y",2\n')).toEqual([{ a: 'x, y', b: '2' }]);
  });
  it('cruza ficheros, crea la liga real y la marca como real/estimada', async () => {
    const data = await readSuperManagerZip(zip);
    expect(data.teams.length).toBe(2);
    expect(data.unmatched).toEqual([]);
    expect(data.prevMatched).toBe(1);
    createRealUniverse(db, data, { name: 'Real', seed: 3, id: 'r', fileName: 'datos.zip' });
    const one = (sql: string) => Number(Object.values(db.rows(sql)[0]!)[0]);
    expect(one("SELECT COUNT(*) FROM player WHERE origin = 'real'")).toBe(24);
    expect(one("SELECT COUNT(*) FROM club WHERE competition_id = 2")).toBe(18);
    expect(one('SELECT COUNT(*) FROM real_game_line')).toBe(24 * 3 + 1);
    // Más minutos y valoración = mejor jugador.
    const ovr = (n: string) => db.rows<{ ovr: number }>('SELECT a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id WHERE p.name = ?', [n])[0]!.ovr;
    for (const t of [0, 1]) expect(ovr(`Nombre Jugador${t}0`)).toBeGreaterThan(ovr(`Nombre Jugador${t}11`) + 8);
    const s = realSummary(db, db.rows<{ id: number }>("SELECT id FROM player WHERE name = 'Nombre Jugador00'")[0]!.id);
    expect(s.seasons.length).toBe(2);
    chooseClub(db, 1);
    advanceDay(db); // con dos clubes reales, la jornada 1 tiene un partido ACB y nueve FEB
    expect(one("SELECT COUNT(*) FROM game WHERE status = 'jugado' AND competition_id <= 2")).toBe(10);
    // Lo simulado no toca lo real.
    expect(one('SELECT COUNT(*) FROM real_game_line')).toBe(24 * 3 + 1);
  });
  it('rechaza un zip que no es de SuperManagerLab', async () => {
    await expect(readSuperManagerZip(zipSync({ 'x.txt': strToU8('hola') }))).rejects.toThrow(/actas_temporada/);
  });
});
