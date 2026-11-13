/**
 * Caras generadas para los jugadores inventados (facesjs, licencia Apache-2.0).
 *
 * La cara depende solo del id del jugador: siempre sale la misma, en cualquier móvil y tras importar
 * la partida. No se guarda nada en la base de datos. La edad cambia el pelo (canas, entradas) y la
 * nacionalidad orienta el tono de piel. La camiseta lleva los colores del club.
 * La librería se carga aparte (≈ 100 kB comprimida) solo cuando hay que pintar la primera cara.
 */
import { useEffect, useRef } from 'react';
import type { FaceConfig, Race } from 'facesjs';
import { Rng } from '../core/rng';

type Lib = typeof import('facesjs');
let lib: Promise<Lib> | null = null;
const loadLib = () => (lib ??= import('facesjs'));

/** SVG ya dibujados (por jugador, tramo de edad y colores), para no recalcular al volver a una pantalla. */
const svgCache = new Map<string, string>();

/** Reparto aproximado de tonos de piel por procedencia, solo para variar las caras. */
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

const GREYS = ['#8d8d8d', '#a7a7a7', '#c4c4c4', '#dcdcdc'];
const BALDISH = ['bald', 'short-bald', 'crop-fade', 'short-fade'];

/** Genera la cara con el azar sustituido por uno con semilla (facesjs usa Math.random por dentro). */
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
  // La edad: canas y entradas a partir de los 31-33.
  if (age >= 31 && rng.chance(Math.min(0.85, (age - 30) * 0.16))) face.hair.color = GREYS[Math.min(3, Math.floor((age - 31) / 2.5))]!;
  if (age >= 30 && rng.chance(Math.min(0.5, (age - 29) * 0.07))) face.hair.id = BALDISH[rng.int(0, BALDISH.length - 1)]!;
  // Los veinteañeros, menos barba.
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

export function Face({ id, nationality, age, colors, size = 48, title }: { id: number; nationality: string; age: number; colors?: string | null; size?: number; title?: string }) {
  const tc = parseColors(colors);
  const key = `${id}|${age >= 31 ? Math.min(age, 40) : age <= 21 ? 'j' : 0}|${tc.join()}`;
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hit = svgCache.get(key);
    if (hit) {
      el.innerHTML = hit;
      return;
    }
    el.innerHTML = '';
    let alive = true;
    loadLib().then((L) => {
      if (!alive || !ref.current) return;
      // display() dibuja en el elemento (necesita el DOM real para medir algunas piezas).
      L.display(ref.current, makeFace(L, id, nationality, age, tc));
      if (svgCache.size > 600) svgCache.clear();
      svgCache.set(key, ref.current.innerHTML);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nationality]);
  // El contenido lo pone la librería a partir de números; React no toca el interior del span.
  return <span ref={ref} className="face" style={{ width: size, height: size * 1.5 }} title={title} aria-hidden={!title} />;
}
