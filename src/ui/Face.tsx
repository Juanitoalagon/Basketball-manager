/**
 * Caras generadas para los jugadores inventados. Siempre la misma cara para el mismo jugador
 * (la semilla es su id); no se guarda nada en la partida. Tres estilos, a elegir en Datos › Ajustes:
 *  - «avataaars» (por defecto): diseño de Pablo Stanley, libre para uso personal y comercial (DiceBear, MIT).
 *  - «personas»: diseño de Draftbit, licencia CC BY 4.0 (DiceBear, MIT).
 *  - «facesjs»: el estilo de las versiones anteriores (Apache-2.0).
 * La nacionalidad orienta el tono de piel, la edad pone canas y entradas, y la camiseta lleva los colores del club.
 * Las librerías se cargan aparte, solo cuando hay que pintar la primera cara.
 */
import { useEffect, useRef } from 'react';
import type { FaceConfig, Race } from 'facesjs';
import { Rng } from '../core/rng';

export type FaceStyle = 'avataaars' | 'personas' | 'facesjs';
export const FACE_STYLES: [FaceStyle, string, string][] = [
  ['avataaars', 'Ilustración', 'Avataaars de Pablo Stanley (libre uso)'],
  ['personas', 'Plano moderno', 'Personas de Draftbit (CC BY 4.0)'],
  ['facesjs', 'Clásico', 'facesjs, el de versiones anteriores (Apache-2.0)'],
];
let style: FaceStyle = (() => {
  try {
    return (localStorage.getItem('faceStyle') as FaceStyle | null) ?? 'avataaars';
  } catch {
    return 'avataaars';
  }
})();
const listeners = new Set<() => void>();
export function getFaceStyle() {
  return style;
}
export function setFaceStyle(s: FaceStyle) {
  style = s;
  try {
    localStorage.setItem('faceStyle', s);
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  svgCache.clear();
  for (const l of listeners) l();
}

const svgCache = new Map<string, string>();

/* ───────────── Tono de piel por procedencia ───────────── */

const RACE_MIX: Record<string, [Race, number][]> = {
  ES: [['white', 0.84], ['brown', 0.08], ['black', 0.08]],
  US: [['black', 0.68], ['white', 0.24], ['brown', 0.08]],
  CA: [['white', 0.5], ['black', 0.4], ['brown', 0.1]],
  FR: [['white', 0.5], ['black', 0.45], ['brown', 0.05]],
  SN: [['black', 1]],
  NG: [['black', 1]],
  BR: [['brown', 0.5], ['white', 0.3], ['black', 0.2]],
  AR: [['white', 0.75], ['brown', 0.25]],
  TR: [['white', 0.55], ['brown', 0.45]],
  IL: [['white', 0.65], ['brown', 0.35]],
  GR: [['white', 0.85], ['brown', 0.15]],
  PT: [['white', 0.75], ['black', 0.15], ['brown', 0.1]],
  EXT: [['black', 0.55], ['white', 0.35], ['brown', 0.1]],
  UE: [['white', 0.75], ['black', 0.2], ['brown', 0.05]],
};
const DEFAULT_MIX: [Race, number][] = [['white', 0.9], ['black', 0.07], ['brown', 0.03]];
function pickRace(rng: Rng, nationality: string): Race {
  const mix = RACE_MIX[nationality] ?? DEFAULT_MIX;
  let r = rng.next();
  for (const [race, p] of mix) if ((r -= p) <= 0) return race;
  return mix[0]![0];
}
const SKIN: Record<Race, string[]> = {
  white: ['ffdbb4', 'edb98a', 'f8d25c'.replace('f8d25c', 'f1c27d')],
  brown: ['d08b5b', 'c68642', 'ae5d29'],
  black: ['8d5524', '614335', '4a312c'],
  asian: ['f1c27d', 'e0ac69'],
};
const HAIR_DARK = ['2c1b18', '4a312c', '724133', '3b2219'];
const HAIR_LIGHT = ['a55728', 'b58143', 'd6b370'];
const GREY = ['a7a7a7', 'c4c4c4', 'e8e1e1'];
const strip = (c: string) => c.replace('#', '');

/* ───────────── DiceBear ───────────── */

type DB = typeof import('@dicebear/core');
let dbLib: Promise<[DB, typeof import('@dicebear/avataaars'), typeof import('@dicebear/personas')]> | null = null;
const loadDice = () => (dbLib ??= Promise.all([import('@dicebear/core'), import('@dicebear/avataaars'), import('@dicebear/personas')]));

function diceSvg(L: Awaited<ReturnType<typeof loadDice>>, which: 'avataaars' | 'personas', id: number, nationality: string, age: number, colors: [string, string, string]): string {
  const [core, ava, per] = L;
  const rng = new Rng(id * 7919 + 17);
  const race = pickRace(rng, nationality);
  const skin = rng.pick(SKIN[race]);
  const grey = age >= 31 && rng.chance(Math.min(0.85, (age - 30) * 0.16));
  const hair = grey ? GREY[Math.min(2, Math.floor((age - 31) / 3))]! : race === 'white' && rng.chance(0.2) ? rng.pick(HAIR_LIGHT) : rng.pick(HAIR_DARK);
  const bald = age >= 30 && rng.chance(Math.min(0.45, (age - 29) * 0.07));
  const beard = age > 21 ? rng.chance(0.55) : rng.chance(0.15);
  const shirt = strip(colors[0].toLowerCase() === '#ffffff' ? colors[1] : colors[0]);
  if (which === 'avataaars') {
    const shortHair = race === 'black'
      ? ['shortFlat', 'shortCurly', 'theCaesar', 'fro', 'dreads01', 'frizzle', 'shortRound'] as const
      : ['shortFlat', 'shortRound', 'shortWaved', 'theCaesar', 'theCaesarAndSidePart', 'sides', 'shortCurly', 'shaggy'] as const;
    return core.createAvatar(ava, {
      seed: String(id),
      top: [rng.pick([...shortHair])],
      topProbability: bald ? 0 : 100,
      hairColor: [hair],
      facialHair: [rng.pick(['beardLight', 'beardMedium', 'beardMajestic', 'moustacheFancy'] as const)],
      facialHairProbability: beard ? 100 : 0,
      facialHairColor: [grey ? hair : rng.pick(HAIR_DARK)],
      skinColor: [skin],
      clothing: ['shirtCrewNeck'],
      clothesColor: [shirt],
      eyes: [rng.pick(['default', 'default', 'happy', 'squint', 'side'] as const)],
      eyebrows: [rng.pick(['defaultNatural', 'flatNatural', 'default', 'raisedExcitedNatural', 'upDownNatural'] as const)],
      mouth: [rng.pick(['default', 'serious', 'smile', 'twinkle'] as const)],
      accessoriesProbability: 0,
      style: ['default'],
    }).toString();
  }
  const hairs = race === 'black' ? ['buzzcut', 'fade', 'curlyHighTop', 'curly', 'shortCombover'] as const : ['buzzcut', 'fade', 'shortCombover', 'shortComboverChops', 'sideShave', 'curly'] as const;
  return core.createAvatar(per, {
    seed: String(id),
    hair: [bald ? (rng.chance(0.5) ? 'bald' : 'balding') : rng.pick([...hairs])],
    hairColor: [hair],
    facialHair: [rng.pick(['beardMustache', 'goatee', 'shadow', 'soulPatch', 'pyramid'] as const)],
    facialHairProbability: beard ? 100 : 0,
    skinColor: [skin],
    clothingColor: [shirt],
    body: [rng.pick(['squared', 'rounded'] as const)],
    eyes: ['open'],
    mouth: [rng.pick(['smile', 'smirk', 'bigSmile', 'lips'] as const)],
    nose: [rng.pick(['mediumRound', 'smallRound', 'wrinkles'] as const)],
  }).toString();
}

/* ───────────── facesjs (estilo clásico) ───────────── */

type Lib = typeof import('facesjs');
let fjs: Promise<Lib> | null = null;
const loadFjs = () => (fjs ??= import('facesjs'));
const GREYS = ['#8d8d8d', '#a7a7a7', '#c4c4c4', '#dcdcdc'];
const BALDISH = ['bald', 'short-bald', 'crop-fade', 'short-fade'];
function makeFace(L: Lib, id: number, nationality: string, age: number, colors: [string, string, string]): FaceConfig {
  const rng = new Rng(id * 7919 + 17);
  const race = pickRace(rng, nationality);
  const original = Math.random;
  Math.random = () => rng.next();
  let face: FaceConfig;
  try {
    face = L.generate({ teamColors: colors, jersey: { id: 'jersey' }, accessories: { id: 'none' }, glasses: { id: 'none' } }, { gender: 'male', race });
  } finally {
    Math.random = original;
  }
  if (age >= 31 && rng.chance(Math.min(0.85, (age - 30) * 0.16))) face.hair.color = GREYS[Math.min(3, Math.floor((age - 31) / 2.5))]!;
  if (age >= 30 && rng.chance(Math.min(0.5, (age - 29) * 0.07))) face.hair.id = BALDISH[rng.int(0, BALDISH.length - 1)]!;
  if (age <= 21 && rng.chance(0.6)) face.facialHair.id = 'none';
  return face;
}

export function parseColors(c: string | null | undefined): [string, string, string] {
  try {
    const v = c ? (JSON.parse(c) as [string, string, string]) : null;
    if (v && v.length === 3) return v;
  } catch {
    /* colores por defecto */
  }
  return ['#3b4252', '#ffffff', '#9aa5b1'];
}

export function Face({ id, nationality, age, colors, size = 48, title, styleOverride }: { id: number; nationality: string; age: number; colors?: string | null; size?: number; title?: string; styleOverride?: FaceStyle }) {
  const tc = parseColors(colors);
  const ref = useRef<HTMLSpanElement>(null);
  const ageKey = age >= 30 ? Math.min(age, 40) : age <= 21 ? 'j' : 'a';
  useEffect(() => {
    let alive = true;
    const draw = () => {
      const el = ref.current;
      if (!el) return;
      const st = styleOverride ?? style;
      const key = `${st}|${id}|${ageKey}|${tc.join()}`;
      const hit = svgCache.get(key);
      if (hit) {
        el.innerHTML = hit;
        return;
      }
      el.innerHTML = '';
      if (st === 'facesjs') {
        void loadFjs().then((L) => {
          if (!alive || !ref.current) return;
          L.display(ref.current, makeFace(L, id, nationality, age, tc));
          svgCache.set(key, ref.current.innerHTML);
        });
      } else {
        void loadDice().then((L) => {
          if (!alive || !ref.current) return;
          const svg = diceSvg(L, st, id, nationality, age, tc);
          if (svgCache.size > 800) svgCache.clear();
          svgCache.set(key, svg);
          ref.current.innerHTML = svg;
        });
      }
    };
    draw();
    listeners.add(draw);
    return () => {
      alive = false;
      listeners.delete(draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ageKey, tc.join(), nationality, styleOverride]);
  const square = (styleOverride ?? style) !== 'facesjs';
  return <span ref={ref} className={`face ${square ? 'sq' : ''}`} style={{ width: size, height: square ? size * 1.1 : size * 1.5 }} title={title} aria-hidden={!title} />;
}
