import { describe, expect, it } from 'vitest';
import { BOX_FIELDS, DEFAULT_TACTICS, EV, simulateGame, type EngineTeam, type Tactics } from '../src/core/engine';
import { makeLeague } from './calib';

const F = Object.fromEntries(BOX_FIELDS.map((f, i) => [f, i])) as Record<string, number>;
const teams = makeLeague(21);
const N = 160;
const withT = (t: EngineTeam, tac: Partial<Tactics>, extra: Partial<EngineTeam> = {}): EngineTeam => ({ ...t, ...extra, tactics: { ...DEFAULT_TACTICS, ...tac } });
function run(home: EngineTeam, away: EngineTeam, fn: (r: ReturnType<typeof simulateGame>) => void) {
  for (let g = 0; g < N; g++) fn(simulateGame(home, away, 5000 + g, { pbp: true }));
}
const sum = (r: ReturnType<typeof simulateGame>, side: 0 | 1, f: string) => [...r.box].filter(([id]) => r.side.get(id) === side).reduce((a, [, b]) => a + b[F[f]!]!, 0);

describe('tácticas', () => {
  it('Pace & Space tira más triples; juego al poste, menos', () => {
    let pace = 0, post = 0, fgaP = 0, fgaQ = 0;
    run(withT(teams[0]!, { offense: 'pacespace' }), teams[1]!, (r) => { pace += sum(r, 0, 'fga3'); fgaP += sum(r, 0, 'fga2') + sum(r, 0, 'fga3'); });
    run(withT(teams[0]!, { offense: 'poste' }), teams[1]!, (r) => { post += sum(r, 0, 'fga3'); fgaQ += sum(r, 0, 'fga2') + sum(r, 0, 'fga3'); });
    expect(pace / fgaP).toBeGreaterThan(post / fgaQ + 0.05);
  });
  it('ritmo rápido = más posesiones', () => {
    let fast = 0, slow = 0;
    run(withT(teams[2]!, { pace: 'rapido' }), withT(teams[3]!, { pace: 'rapido' }), (r) => { fast += r.poss[0] + r.poss[1]; });
    run(withT(teams[2]!, { pace: 'lento' }), withT(teams[3]!, { pace: 'lento' }), (r) => { slow += r.poss[0] + r.poss[1]; });
    expect(fast).toBeGreaterThan(slow * 1.12);
  });
  it('dos contra uno apaga a la estrella, pero liberan a los demás', () => {
    const star = [...teams[4]!.players].sort((a, b) => b.attrs.cre - a.attrs.cre)[0]!.id;
    let base = 0, dbl = 0, othersBase = 0, othersDbl = 0;
    const away = { ...teams[5]!, lineup: { starters: [null, null, null, null, null], roles: {} } };
    run(teams[4]!, withT(away, {}), (r) => { base += r.box.get(star)![F.pts]!; othersBase += sum(r, 0, 'pts') - r.box.get(star)![F.pts]!; });
    run(teams[4]!, withT(away, { defense: { ...DEFAULT_TACTICS.defense!, special: { id: star, mode: 'dos' } } }), (r) => { dbl += r.box.get(star)![F.pts]!; othersDbl += sum(r, 0, 'pts') - r.box.get(star)![F.pts]!; });
    expect(dbl).toBeLessThan(base * 0.8);
    expect(othersDbl).toBeGreaterThan(othersBase);
  });
  it('emparejamiento manual: el elegido defiende al rival indicado', () => {
    const att = teams[6]!.players[0]!.id;
    const def = teams[7]!.players[3]!.id;
    const away = withT({ ...teams[7]!, lineup: { starters: [null, null, null, null, null], roles: {} } }, { defense: { ...DEFAULT_TACTICS.defense!, matchups: { [att]: def } } });
    const r = simulateGame(teams[6]!, away, 77, { timeline: true });
    const both = r.timeline!.filter((t) => t.court[0].includes(att) && t.court[1].includes(def));
    expect(both.length).toBeGreaterThan(0);
    for (const t of both) expect(t.match[0][att]).toBe(def);
  });
  it('tiempos muertos: nunca más de los permitidos y cortan el parcial', () => {
    run(teams[8]!, teams[9]!, (r) => {
      const to = r.pbp!.filter((e) => e[0] === EV.TIMEOUT);
      for (const side of [0, 1]) {
        const first = to.filter((e) => e[3] === side && e[1]! <= 2).length;
        const second = to.filter((e) => e[3] === side && (e[1] === 3 || e[1] === 4)).length;
        expect(first).toBeLessThanOrEqual(2);
        expect(second).toBeLessThanOrEqual(3);
      }
    });
    const r = simulateGame(teams[8]!, teams[9]!, 31, { pbp: true, timeline: true });
    const t = r.pbp!.find((e) => e[0] === EV.TIMEOUT);
    if (t) {
      const after = r.timeline!.find((s) => s.i > t[7]!)!;
      expect(after.run[1 - t[3]!]).toBeLessThan(8);
    }
  });
});
