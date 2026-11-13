import { describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { wrapDb } from '../src/db/adapter';
import { migrate } from '../src/core/schema';
import { simulateGame, type Intervention } from '../src/core/engine';
import { advanceDay, chooseClub, createUniverse, prepareLive } from '../src/core/season';

describe('partido en directo y guardado', () => {
  it('lo que se ve en directo es exactamente lo que se guarda', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = await sqlite3InitModule();
    const db = wrapDb(new s.oo1.DB(':memory:'));
    migrate(db);
    createUniverse(db, { name: 'L', seed: 8, id: 'l' });
    chooseClub(db, 5);
    const live = prepareLive(db)!;
    expect(live).not.toBeNull();
    const side = live.userSide;
    const mine = (side === 0 ? live.home : live.away).players.map((p) => p.id);
    const ivs: Intervention[] = [
      { at: 10, side, kind: 'timeout' },
      { at: 40, side, kind: 'plan', shot: { rim: 'mas', paint: 'normal', mid: 'menos', three: 'mas' } },
      { at: 50, side, kind: 'auto', on: false },
    ];
    const t = simulateGame(live.home, live.away, live.seed, { pbp: true, timeline: true, interventions: ivs });
    const court = t.timeline!.find((x) => x.i === 60)!.court[side];
    const bench = mine.find((id) => !court.includes(id))!;
    ivs.push({ at: 60, side, kind: 'sub', in: bench, out: court[0]! });
    const seen = simulateGame(live.home, live.away, live.seed, { pbp: true, timeline: true, interventions: ivs });
    advanceDay(db, { interventions: ivs });
    const g = db.rows<{ home_pts: number; away_pts: number }>('SELECT home_pts, away_pts FROM game WHERE id = ?', [live.game.id])[0]!;
    expect([g.home_pts, g.away_pts]).toEqual(seen.score);
  });
});
