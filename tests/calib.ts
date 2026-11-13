/**
 * Banco de calibración: simula muchos partidos entre plantillas generadas y devuelve las medias
 * por equipo y partido. Los objetivos son PROVISIONALES (aproximaciones de la liga española,
 * de memoria); se sustituirán por los calculados con los datos reales importados en la fase 6.
 */
import { BOX_FIELDS, type EngineTeam, simulateGame } from '../src/core/engine';
import { generateRoster } from '../src/core/generate';
import { Rng } from '../src/core/rng';

export const TARGETS: Record<string, [number, number]> = {
  pts: [76, 86],
  poss: [69, 76],
  fg2pct: [0.51, 0.56],
  fg3pct: [0.33, 0.38],
  ftpct: [0.72, 0.79],
  threeRate: [0.36, 0.45],
  ftRate: [0.22, 0.33],
  tov: [11, 14.5],
  orbPct: [0.26, 0.33],
  ast: [15, 19.5],
  stl: [5.5, 8.5],
  blk: [1.8, 3.5],
  pf: [18, 23],
  homeWin: [0.54, 0.66],
  otRate: [0.02, 0.09],
  starterMin: [24, 31],
  topMin: [28, 34],
};

export function makeLeague(seed: number, tier = 1, n = 18): EngineTeam[] {
  const rng = new Rng(seed);
  const used = new Set<string>();
  let id = 1;
  return Array.from({ length: n }, (_, c) => ({
    clubId: c + 1,
    players: generateRoster(rng, { tier, season: 2026, strength: (rng.next() + rng.next() - 1) * 4, used }).map((p) => ({
      id: id++, pos1: p.pos1, pos2: p.pos2, height_cm: p.heightCm, attrs: p.attrs,
    })),
  }));
}

export function runBench(games: number, seed = 1) {
  const teams = makeLeague(seed);
  const rng = new Rng(seed * 7 + 3);
  const F = Object.fromEntries(BOX_FIELDS.map((f, i) => [f, i])) as Record<string, number>;
  const tot: Record<string, number> = {};
  const add = (k: string, v: number) => (tot[k] = (tot[k] ?? 0) + v);
  let homeWins = 0;
  let ots = 0;
  for (let g = 0; g < games; g++) {
    const h = rng.int(0, teams.length - 1);
    let a = rng.int(0, teams.length - 2);
    if (a >= h) a++;
    const r = simulateGame(teams[h]!, teams[a]!, rng.int(1, 2 ** 31));
    if (r.score[0] > r.score[1]) homeWins++;
    if (r.ot) ots++;
    for (const side of [0, 1] as const) {
      const rows = [...r.box.entries()].filter(([id]) => r.side.get(id) === side).map(([, b]) => b);
      const opp = [...r.box.entries()].filter(([id]) => r.side.get(id) !== side).map(([, b]) => b);
      const s = (f: string, rs = rows) => rs.reduce((acc, b) => acc + b[F[f]!]!, 0);
      add('pts', s('pts'));
      add('poss', r.poss[side]);
      add('fgm2', s('fgm2')); add('fga2', s('fga2')); add('fgm3', s('fgm3')); add('fga3', s('fga3'));
      add('ftm', s('ftm')); add('fta', s('fta')); add('tov', s('tov')); add('ast', s('ast'));
      add('stl', s('stl')); add('blk', s('blk')); add('pf', s('pf')); add('orb', s('orb'));
      add('oppDrb', s('drb', opp));
      const mins = rows.map((b) => b[F.sec]! / 60).sort((x, y) => y - x);
      add('starterMin', mins.slice(0, 5).reduce((x, y) => x + y, 0) / 5);
      add('topMin', mins[0]!);
    }
  }
  const n = games * 2;
  return {
    pts: tot.pts! / n,
    poss: tot.poss! / n,
    fg2pct: tot.fgm2! / tot.fga2!,
    fg3pct: tot.fgm3! / tot.fga3!,
    ftpct: tot.ftm! / tot.fta!,
    threeRate: tot.fga3! / (tot.fga2! + tot.fga3!),
    ftRate: tot.fta! / (tot.fga2! + tot.fga3!),
    tov: tot.tov! / n,
    orbPct: tot.orb! / (tot.orb! + tot.oppDrb!),
    ast: tot.ast! / n,
    stl: tot.stl! / n,
    blk: tot.blk! / n,
    pf: tot.pf! / n,
    homeWin: homeWins / games,
    otRate: ots / games,
    starterMin: tot.starterMin! / n,
    topMin: tot.topMin! / n,
  } as Record<string, number>;
}
