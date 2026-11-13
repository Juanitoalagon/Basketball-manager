/**
 * Jugadores: atributos 1-99, posiciones, media por posición y generador.
 * Todo lo generado se marca como origen 'generado'; nunca se mezcla con datos reales.
 */
import { Rng } from './rng';

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type Pos = (typeof POSITIONS)[number];
export const POS_LABEL: Record<Pos, string> = { PG: 'Base', SG: 'Escolta', SF: 'Alero', PF: 'Ala-pívot', C: 'Pívot' };

export type AttrGroup = 'off' | 'def' | 'fis' | 'men';
export const ATTRS = [
  { key: 'drive', label: 'Penetración', group: 'off' },
  { key: 'fin', label: 'Finalización', group: 'off' },
  { key: 'sht2', label: 'Tiro de dos', group: 'off' },
  { key: 'sht3', label: 'Tiro de tres', group: 'off' },
  { key: 'ft', label: 'Tiros libres', group: 'off' },
  { key: 'hdl', label: 'Manejo de balón', group: 'off' },
  { key: 'vis', label: 'Visión de juego', group: 'off' },
  { key: 'pas', label: 'Pase', group: 'off' },
  { key: 'cre', label: 'Creación de tiro', group: 'off' },
  { key: 'post', label: 'Juego al poste', group: 'off' },
  { key: 'offb', label: 'Movimiento sin balón', group: 'off' },
  { key: 'oreb', label: 'Rebote ofensivo', group: 'off' },
  { key: 'perd', label: 'Defensa exterior', group: 'def' },
  { key: 'intd', label: 'Defensa interior', group: 'def' },
  { key: 'hlpd', label: 'Defensa colectiva', group: 'def' },
  { key: 'ant', label: 'Anticipación', group: 'def' },
  { key: 'stl', label: 'Robo', group: 'def' },
  { key: 'blk', label: 'Tapón', group: 'def' },
  { key: 'dreb', label: 'Rebote defensivo', group: 'def' },
  { key: 'pnr', label: 'Defensa de bloqueos', group: 'def' },
  { key: 'intim', label: 'Intimidación', group: 'def' },
  { key: 'str', label: 'Fuerza', group: 'fis' },
  { key: 'spd', label: 'Velocidad / atletismo', group: 'fis' },
  { key: 'agi', label: 'Agilidad', group: 'fis' },
  { key: 'jmp', label: 'Salto', group: 'fis' },
  { key: 'sta', label: 'Resistencia', group: 'fis' },
  { key: 'exp', label: 'Experiencia', group: 'men' },
  { key: 'iq', label: 'IQ / inteligencia de juego', group: 'men' },
  { key: 'lead', label: 'Liderazgo', group: 'men' },
  { key: 'cons', label: 'Consistencia', group: 'men' },
  { key: 'clutch', label: 'Sangre fría', group: 'men' },
  { key: 'disc', label: 'Disciplina', group: 'men' },
] as const;
export type AttrKey = (typeof ATTRS)[number]['key'];
export type Attrs = Record<AttrKey, number>;
export const ATTR_KEYS = ATTRS.map((a) => a.key) as AttrKey[];
export const GROUP_LABEL: Record<AttrGroup, string> = { off: 'Ofensivos', def: 'Defensivos', fis: 'Físicos', men: 'Mentales' };

/** Desviación típica de cada posición respecto al nivel general del jugador. */
const PROFILE: Record<Pos, Partial<Record<AttrKey, number>>> = {
  PG: { drive: 7, fin: -4, sht2: 2, sht3: 5, ft: 6, hdl: 16, vis: 15, pas: 15, cre: 8, post: -22, offb: 0, oreb: -22, perd: 6, intd: -20, ant: 6, stl: 8, blk: -24, dreb: -18, pnr: 4, intim: -22, str: -14, spd: 10, agi: 12, jmp: -2, sta: 4, iq: 3 },
  SG: { drive: 6, fin: 0, sht2: 5, sht3: 9, ft: 6, hdl: 6, vis: 2, pas: 0, cre: 8, post: -16, offb: 7, oreb: -16, perd: 7, intd: -14, ant: 4, stl: 5, blk: -18, dreb: -14, pnr: 2, intim: -16, str: -8, spd: 8, agi: 8, jmp: 2 },
  SF: { drive: 3, fin: 2, sht2: 3, sht3: 3, ft: 1, hdl: -3, vis: -3, pas: -3, cre: 2, post: -6, offb: 6, oreb: -6, perd: 5, intd: -4, hlpd: 2, ant: 2, stl: 2, blk: -8, dreb: -4, pnr: 2, intim: -6, str: 0, spd: 4, agi: 3, jmp: 4 },
  PF: { drive: -5, fin: 5, sht2: 0, sht3: -6, ft: -5, hdl: -12, vis: -10, pas: -9, cre: -6, post: 8, offb: 2, oreb: 10, perd: -6, intd: 8, hlpd: 2, ant: -3, stl: -6, blk: 8, dreb: 10, pnr: 0, intim: 8, str: 8, spd: -4, agi: -6, jmp: 3 },
  C: { drive: -12, fin: 8, sht2: -4, sht3: -22, ft: -12, hdl: -20, vis: -12, pas: -10, cre: -12, post: 14, offb: 0, oreb: 18, perd: -14, intd: 16, hlpd: 3, ant: -6, stl: -10, blk: 18, dreb: 18, pnr: -2, intim: 16, str: 14, spd: -10, agi: -12, jmp: 0, sta: -3 },
};

/** Pesos de la media general por posición. La media no decide partidos: solo resume. */
const OVR_W: Record<Pos, Partial<Record<AttrKey, number>>> = {
  PG: { hdl: 3, vis: 3, pas: 3, cre: 2, drive: 2, sht3: 2, sht2: 1, ft: 1, fin: 1, perd: 2, stl: 1, ant: 1, pnr: 1, hlpd: 1, spd: 1, agi: 1, iq: 2, sta: 1 },
  SG: { sht3: 3, sht2: 2, cre: 2, drive: 2, fin: 1, ft: 1, offb: 2, hdl: 1, pas: 1, perd: 3, stl: 1, ant: 1, hlpd: 1, spd: 1, agi: 1, iq: 1, sta: 1 },
  SF: { sht3: 2, sht2: 2, drive: 2, fin: 2, cre: 1, offb: 2, perd: 2, intd: 1, hlpd: 2, dreb: 1, ant: 1, spd: 1, jmp: 1, str: 1, iq: 1, sta: 1 },
  PF: { fin: 2, post: 2, sht2: 1, sht3: 1, oreb: 2, dreb: 3, intd: 3, blk: 1, intim: 1, hlpd: 2, pnr: 1, str: 2, jmp: 1, iq: 1, sta: 1 },
  C: { fin: 3, post: 2, oreb: 2, dreb: 3, intd: 3, blk: 3, intim: 2, hlpd: 1, pnr: 1, str: 2, jmp: 1, iq: 1, sta: 1 },
};

const HEIGHT_MEAN: Record<Pos, number> = { PG: 188, SG: 195, SF: 201, PF: 206, C: 211 };

const clamp = (x: number, lo = 1, hi = 99) => Math.max(lo, Math.min(hi, Math.round(x)));
function gauss(rng: Rng): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Posiciones vecinas: jugar en una contigua penaliza poco; lejos, mucho. */
export function positionFit(player: { pos1: Pos; pos2: Pos | null }, slot: Pos): number {
  if (player.pos1 === slot || player.pos2 === slot) return 0;
  const d = Math.abs(POSITIONS.indexOf(player.pos1) - POSITIONS.indexOf(slot));
  return d === 1 ? -3 : d === 2 ? -9 : -18;
}

export function overall(a: Attrs, pos: Pos, heightCm: number): number {
  const w = OVR_W[pos];
  const prof = PROFILE[pos];
  let s = 0;
  let sw = 0;
  for (const k of ATTR_KEYS) {
    const wk = w[k] ?? 0;
    if (!wk) continue;
    s += wk * (a[k] - (prof[k] ?? 0));
    sw += wk;
  }
  const heightBonus = (heightCm - HEIGHT_MEAN[pos]) * 0.35;
  return clamp(s / sw + heightBonus);
}

export function overallAt(a: Attrs, p: { pos1: Pos; pos2: Pos | null; height_cm: number }, slot: Pos): number {
  return overall(a, slot, p.height_cm) + positionFit(p, slot);
}

export interface NewPlayer {
  name: string;
  nationality: string;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  wingspanCm: number;
  hand: 'R' | 'L';
  pos1: Pos;
  pos2: Pos | null;
  attrs: Attrs;
  ovr: number;
  potential: number;
  potentialEst: number;
}

/** Potencial real (oculto) según edad; el estimado lleva ruido de ojeador. */
export function makePotential(rng: Rng, ovr: number, age: number): { potential: number; potentialEst: number } {
  const growth = age <= 19 ? 10 + rng.int(0, 16) : age <= 21 ? 6 + rng.int(0, 12) : age <= 23 ? 2 + rng.int(0, 8) : age <= 26 ? rng.int(0, 4) : 0;
  const potential = clamp(Math.max(ovr, ovr + growth));
  const potentialEst = clamp(potential + Math.round(gauss(rng) * (age <= 23 ? 5 : 2)));
  return { potential, potentialEst: Math.max(ovr, potentialEst) };
}

export function generatePlayer(rng: Rng, opts: { pos: Pos; quality: number; age: number; season: number; nationality: string; name: string }): NewPlayer {
  const { pos, quality, age } = opts;
  const heightCm = Math.round(HEIGHT_MEAN[pos] + gauss(rng) * 3.8);
  const prof = PROFILE[pos];
  const attrs = {} as Attrs;
  // Un "estilo" propio para que dos jugadores del mismo nivel no sean clones.
  const style = { sh: gauss(rng) * 6, ins: gauss(rng) * 6, cr: gauss(rng) * 6, df: gauss(rng) * 6 };
  for (const a of ATTRS) {
    let v = quality + (prof[a.key] ?? 0) + gauss(rng) * 7;
    if (['sht2', 'sht3', 'ft', 'offb'].includes(a.key)) v += style.sh;
    if (['fin', 'post', 'oreb', 'dreb', 'str'].includes(a.key)) v += style.ins;
    if (['cre', 'drive', 'hdl', 'vis', 'pas'].includes(a.key)) v += style.cr;
    if (a.group === 'def') v += style.df;
    if (a.key === 'exp') v = 20 + (age - 18) * 4.5 + gauss(rng) * 8;
    if (a.key === 'sta') v = 55 + gauss(rng) * 12 + (quality - 55) * 0.3;
    if (a.group === 'men' && a.key !== 'exp') v = 50 + (quality - 55) * 0.4 + gauss(rng) * 12;
    if (a.group === 'fis' && age >= 30) v -= (age - 29) * 1.5;
    if (['blk', 'oreb', 'dreb', 'intim', 'intd'].includes(a.key)) v += (heightCm - HEIGHT_MEAN[pos]) * 0.8;
    attrs[a.key] = clamp(v);
  }
  const i = POSITIONS.indexOf(pos);
  const pos2 = rng.chance(0.55) ? POSITIONS[Math.max(0, Math.min(4, i + (rng.chance(0.5) ? 1 : -1)))]! : null;
  const ovr = overall(attrs, pos, heightCm);
  return {
    name: opts.name,
    nationality: opts.nationality,
    birthYear: opts.season - age,
    heightCm,
    weightKg: Math.round(heightCm - 100 + (pos === 'C' || pos === 'PF' ? 12 : 0) + gauss(rng) * 5 + attrs.str * 0.08),
    wingspanCm: Math.round(heightCm * (1.03 + gauss(rng) * 0.025)),
    hand: rng.chance(0.12) ? 'L' : 'R',
    pos1: pos,
    pos2: pos2 === pos ? null : pos2,
    attrs,
    ovr,
    ...makePotential(rng, ovr, age),
  };
}

/** Evolución anual provisional (la fase 10 la sustituirá por entrenamiento, minutos e instalaciones). */
export function developAttrs(rng: Rng, a: Attrs, age: number, ovr: number, potential: number): Attrs {
  const room = Math.max(0, potential - ovr);
  const base = age <= 21 ? room * 0.35 : age <= 24 ? room * 0.3 : age <= 27 ? room * 0.25 : age <= 29 ? 0 : age <= 32 ? -1.5 : -3.5;
  const out = {} as Attrs;
  for (const d of ATTRS) {
    let delta = base + gauss(rng) * 1.5;
    if (d.group === 'fis' && age >= 28) delta -= (age - 27) * 0.6;
    if (d.key === 'exp') delta = 4 + rng.int(0, 3);
    if (d.key === 'iq' && age <= 30) delta = Math.max(delta, 1);
    out[d.key] = clamp(a[d.key] + delta);
  }
  return out;
}
