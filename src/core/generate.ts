/** Generación de clubes y plantillas (en memoria; season.ts lo guarda en la base de datos). */
import { type NewPlayer, type Pos, POSITIONS, generatePlayer } from './attributes';
import { makeName, pickNationality } from './names';
import { Rng } from './rng';

export const ROSTER_SIZE = 12;
/** Nivel medio de cada división: la primera ronda los 61 de media; la segunda, 12 menos. */
export const TIER_QUALITY: Record<number, number> = { 1: 61, 2: 49 };

/** Escalera de calidad de una plantilla: estrella, titulares, rotación y fondo de armario. */
const LADDER = [12, 8, 6, 4, 3, 0, -2, -4, -6, -8, -11, -14];

export function generateRoster(rng: Rng, opts: { tier: number; season: number; strength: number; used: Set<string> }): NewPlayer[] {
  const base = TIER_QUALITY[opts.tier]! + opts.strength;
  // Dos por posición más dos comodines, para que el banquillo cubra todos los huecos.
  const positions: Pos[] = [...POSITIONS, ...POSITIONS, rng.pick(POSITIONS), rng.pick(['SF', 'PF', 'SG'] as Pos[])];
  rng.shuffle(positions);
  // Que la estrella y los titulares no caigan todos en la misma posición.
  const starters = rng.shuffle([...POSITIONS]);
  const order: Pos[] = [...starters, ...positions.filter((_, i) => i >= 5).slice(0, ROSTER_SIZE - 5)];
  return order.map((pos, i) => {
    const age = Math.max(18, Math.min(36, Math.round(27 + (rng.next() + rng.next() + rng.next() - 1.5) * 8)));
    const ageAdj = age < 22 ? -(22 - age) * 1.8 : 0;
    const nat = pickNationality(rng);
    return generatePlayer(rng, {
      pos,
      quality: base + LADDER[i]! + ageAdj + (rng.next() - 0.5) * 4,
      age,
      season: opts.season,
      nationality: nat,
      name: makeName(rng, nat, opts.used),
    });
  });
}

/** Jugadores jóvenes de cantera para rellenar plantillas tras las retiradas. */
export function generateProspect(rng: Rng, opts: { tier: number; season: number; used: Set<string> }): NewPlayer {
  const nat = rng.chance(0.75) ? 'ES' : pickNationality(rng);
  const age = rng.int(18, 20);
  return generatePlayer(rng, {
    pos: rng.pick(POSITIONS),
    quality: TIER_QUALITY[opts.tier]! - 12 + rng.next() * 8,
    age,
    season: opts.season,
    nationality: nat,
    name: makeName(rng, nat, opts.used),
  });
}
