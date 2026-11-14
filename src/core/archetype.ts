/**
 * Arquetipos: una etiqueta que resume para qué sirve un jugador (Tirador, 3&D, Protector del aro…).
 * Se calcula de sus atributos: cada arquetipo mira unos pocos atributos clave y se queda el que más
 * supera su umbral. Si ninguno lo supera, es un jugador de rol.
 */
import type { Attrs, AttrKey, Pos } from './attributes';

export type ArchetypeKey =
  | 'anotador' | 'tirador' | '3d' | 'director' | 'penetrador' | 'defensor' | 'protector'
  | 'reboteador' | 'poste' | 'abierto' | 'todoterreno' | 'rol';

export interface Archetype { key: ArchetypeKey; label: string; hint: string }

const DEF: Record<ArchetypeKey, { label: string; hint: string; keys: AttrKey[]; thr: number; ok?: (a: Attrs, pos: Pos, h: number) => boolean; bonus?: (a: Attrs, pos: Pos, h: number) => number }> = {
  anotador: { label: 'Anotador', hint: 'Se crea su tiro y anota de todas las formas', keys: ['cre', 'sht2', 'drive', 'fin', 'sht3'], thr: 63 },
  tirador: { label: 'Tirador', hint: 'Especialista en el triple; muy peligroso sin balón', keys: ['sht3', 'sht3', 'offb', 'ft'], thr: 66 },
  '3d': { label: '3&D', hint: 'Tira de tres y defiende al exterior', keys: ['sht3', 'perd', 'perd', 'ant'], thr: 65, ok: (a) => a.sht3 >= 63 && a.perd >= 63 },
  director: { label: 'Director', hint: 'Organiza: pase, visión y manejo', keys: ['pas', 'vis', 'hdl', 'iq'], thr: 66 },
  penetrador: { label: 'Penetrador', hint: 'Ataca el aro con velocidad y finaliza', keys: ['drive', 'fin', 'spd', 'agi'], thr: 66 },
  defensor: { label: 'Defensor', hint: 'Defensor exterior: presión, robos y bloqueos', keys: ['perd', 'stl', 'ant', 'agi', 'pnr'], thr: 65 },
  protector: { label: 'Protector del aro', hint: 'Tapones, intimidación y defensa interior', keys: ['blk', 'intim', 'intd', 'jmp'], thr: 66, ok: (_a, _p, h) => h >= 202, bonus: (_a, _p, h) => (h - 206) * 0.4 },
  reboteador: { label: 'Reboteador', hint: 'Domina el rebote en los dos aros', keys: ['oreb', 'dreb', 'dreb', 'str', 'jmp'], thr: 64 },
  poste: { label: 'Poste bajo', hint: 'Juega de espaldas y castiga cerca del aro', keys: ['post', 'post', 'str', 'fin'], thr: 66, ok: (_a, p) => p === 'PF' || p === 'C' || p === 'SF' },
  abierto: { label: 'Pívot abierto', hint: 'Interior que abre el campo con su tiro', keys: ['sht3', 'sht2', 'offb'], thr: 57, ok: (_a, p) => p === 'PF' || p === 'C' },
  todoterreno: { label: 'Todoterreno', hint: 'Aporta en ataque y en defensa', keys: ['cre', 'sht2', 'pas', 'perd', 'intd', 'dreb', 'iq'], thr: 60, ok: (a) => Math.min(a.perd, a.sht2, a.pas) >= 52 },
  rol: { label: 'Jugador de rol', hint: 'Sin una especialidad clara', keys: [], thr: 0 },
};

export const ARCHETYPES = Object.entries(DEF).map(([key, d]) => ({ key: key as ArchetypeKey, label: d.label, hint: d.hint }));

/** Arquetipo principal y, si lo hay, uno secundario. */
export function archetypes(a: Attrs, pos: Pos, heightCm: number): Archetype[] {
  const scored: { key: ArchetypeKey; s: number }[] = [];
  for (const [key, d] of Object.entries(DEF) as [ArchetypeKey, (typeof DEF)[ArchetypeKey]][]) {
    if (key === 'rol') continue;
    if (d.ok && !d.ok(a, pos, heightCm)) continue;
    const mean = d.keys.reduce((s, k) => s + a[k], 0) / d.keys.length + (d.bonus?.(a, pos, heightCm) ?? 0);
    if (mean >= d.thr) scored.push({ key, s: mean - d.thr });
  }
  scored.sort((x, y) => y.s - x.s);
  const out = scored.slice(0, 2).map(({ key }) => ({ key, label: DEF[key].label, hint: DEF[key].hint }));
  return out.length ? out : [{ key: 'rol', label: DEF.rol.label, hint: DEF.rol.hint }];
}
export function archetype(a: Attrs, pos: Pos, heightCm: number): Archetype {
  return archetypes(a, pos, heightCm)[0]!;
}

/** Atributos que definen cada arquetipo (para entrenar «hacia» un arquetipo). */
export function archetypeKeys(k: ArchetypeKey): AttrKey[] {
  return [...new Set(DEF[k].keys)];
}
