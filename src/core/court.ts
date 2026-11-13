/**
 * Media pista FIBA en decímetros, con el origen en el centro del aro.
 * x: de -75 (izquierda) a 75 (derecha). y: de -16 (línea de fondo) hacia el centro del campo.
 * Línea de tres a 67,5 dm (6,75 m); esquinas a 66 dm (6,60 m) del eje.
 * Zona de 49 dm de ancho hasta la línea de tiros libres (y = 42). Semicírculo restringido de 12,5 dm.
 */
import { Rng } from './rng';

export const COURT = { halfWidth: 75, baseline: -16, ftLineY: 42, laneHalf: 24.5, rim: 12.5, three: 67.5, corner: 66, length: 124 } as const;
export const CORNER_Y = Math.sqrt(COURT.three ** 2 - COURT.corner ** 2); // ≈ 14,2 dm sobre el aro

export const ZONES = [
  { id: 0, name: 'Zona restringida', area: 'Aro', pts: 2 },
  { id: 1, name: 'Pintura izquierda', area: 'Pintura', pts: 2 },
  { id: 2, name: 'Pintura centro', area: 'Pintura', pts: 2 },
  { id: 3, name: 'Pintura derecha', area: 'Pintura', pts: 2 },
  { id: 4, name: 'Fondo izquierdo (media)', area: 'Media distancia', pts: 2 },
  { id: 5, name: 'Fondo derecho (media)', area: 'Media distancia', pts: 2 },
  { id: 6, name: 'Codo izquierdo', area: 'Media distancia', pts: 2 },
  { id: 7, name: 'Codo derecho', area: 'Media distancia', pts: 2 },
  { id: 8, name: 'Frontal (media)', area: 'Media distancia', pts: 2 },
  { id: 9, name: 'Esquina izquierda', area: 'Triple', pts: 3 },
  { id: 10, name: 'Esquina derecha', area: 'Triple', pts: 3 },
  { id: 11, name: 'Ala izquierda (triple)', area: 'Triple', pts: 3 },
  { id: 12, name: 'Ala derecha (triple)', area: 'Triple', pts: 3 },
  { id: 13, name: 'Frontal (triple)', area: 'Triple', pts: 3 },
] as const;

export function isThree(x: number, y: number): boolean {
  if (y <= CORNER_Y) return Math.abs(x) >= COURT.corner;
  return Math.hypot(x, y) >= COURT.three;
}

export function zoneOf(x: number, y: number): number {
  const r = Math.hypot(x, y);
  if (isThree(x, y)) {
    if (y <= CORNER_Y) return x < 0 ? 9 : 10;
    const ang = Math.atan2(x, y); // 0 = frente al aro
    if (Math.abs(ang) < Math.PI / 8) return 13;
    return x < 0 ? 11 : 12;
  }
  if (r < COURT.rim) return 0;
  if (Math.abs(x) <= COURT.laneHalf && y <= COURT.ftLineY) {
    if (x < -8) return 1;
    if (x > 8) return 3;
    return 2;
  }
  if (y < CORNER_Y) return x < 0 ? 4 : 5;
  if (Math.abs(x) <= COURT.laneHalf) return 8;
  return x < 0 ? 6 : 7;
}

export type ShotKind = 'rim' | 'paint' | 'mid' | 'three';

/** Coordenadas de un tiro del tipo pedido. `corner` fuerza triple desde la esquina. */
export function sampleShot(rng: Rng, kind: ShotKind, opts: { corner?: boolean; leftBias?: number } = {}): { x: number; y: number } {
  const side = () => (rng.chance(0.5 + (opts.leftBias ?? 0)) ? -1 : 1);
  for (let i = 0; i < 60; i++) {
    let x = 0;
    let y = 0;
    if (kind === 'rim') {
      const r = Math.sqrt(rng.next()) * (COURT.rim - 1);
      const a = (rng.next() - 0.5) * Math.PI * 1.1;
      x = r * Math.sin(a);
      y = Math.max(-8, r * Math.cos(a));
    } else if (kind === 'paint') {
      x = (rng.next() * 2 - 1) * COURT.laneHalf;
      y = -10 + rng.next() * rng.next() * (COURT.ftLineY + 10);
    } else if (kind === 'mid') {
      const r = 26 + rng.next() * 38;
      const a = (rng.next() - 0.5) * Math.PI * 1.05;
      x = r * Math.sin(a);
      y = Math.max(-12, r * Math.cos(a));
    } else if (opts.corner) {
      x = side() * (COURT.corner + 1 + rng.next() * 6);
      y = -12 + rng.next() * (CORNER_Y + 10);
    } else {
      // Triple por encima de la esquina: denso junto a la línea.
      const r = COURT.three + 1 + Math.abs(rng.next() - rng.next()) * 22;
      const a = (rng.next() - 0.5) * Math.PI * 0.82;
      x = r * Math.sin(a);
      y = r * Math.cos(a);
      if (y <= CORNER_Y + 1) continue;
    }
    x = Math.round(x);
    y = Math.round(y);
    const z = zoneOf(x, y); // con las coordenadas ya redondeadas, como se guardan
    const ok =
      kind === 'rim' ? z === 0 : kind === 'paint' ? z >= 1 && z <= 3 : kind === 'mid' ? z >= 4 && z <= 8 : opts.corner ? z === 9 || z === 10 : z >= 11;
    if (ok && Math.abs(x) <= COURT.halfWidth - 1 && y >= COURT.baseline + 1) return { x, y };
  }
  // Valores seguros si el muestreo no encuentra punto (no debería ocurrir).
  return kind === 'rim' ? { x: 0, y: 3 } : kind === 'paint' ? { x: 0, y: 25 } : kind === 'mid' ? { x: 0, y: 55 } : opts.corner ? { x: -70, y: 0 } : { x: 0, y: 75 };
}
