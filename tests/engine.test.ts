import { describe, expect, it } from 'vitest';
import { BOX_FIELDS, simulateGame } from '../src/core/engine';
import { ZONES, isThree, zoneOf } from '../src/core/court';
import { TARGETS, makeLeague, runBench } from './calib';

const F = Object.fromEntries(BOX_FIELDS.map((f, i) => [f, i])) as Record<string, number>;
const teams = makeLeague(11);

describe('motor de partido', () => {
  it('la misma semilla reproduce el mismo partido; otra semilla, otro', () => {
    const a = simulateGame(teams[0]!, teams[1]!, 99, { pbp: true });
    const b = simulateGame(teams[0]!, teams[1]!, 99, { pbp: true });
    const c = simulateGame(teams[0]!, teams[1]!, 100);
    expect(b.score).toEqual(a.score);
    expect(b.shots).toEqual(a.shots);
    expect(b.pbp).toEqual(a.pbp);
    expect(c.shots).not.toEqual(a.shots);
  });

  it('las estadísticas cuadran con las acciones en 300 partidos', () => {
    for (let g = 0; g < 300; g++) {
      const r = simulateGame(teams[g % 18]!, teams[(g * 7 + 3) % 18 === g % 18 ? (g + 1) % 18 : (g * 7 + 3) % 18]!, 1000 + g);
      expect(r.score[0]).not.toBe(r.score[1]);
      const len = 2400 + r.ot * 300;
      for (const side of [0, 1] as const) {
        const rows = [...r.box].filter(([id]) => r.side.get(id) === side).map(([, b]) => b);
        const opp = [...r.box].filter(([id]) => r.side.get(id) !== side).map(([, b]) => b);
        const s = (f: string, rs = rows) => rs.reduce((a, b) => a + b[F[f]!]!, 0);
        // Los puntos individuales suman el marcador y salen de sus tiros.
        expect(s('pts')).toBe(r.score[side]);
        expect(s('fgm2') * 2 + s('fgm3') * 3 + s('ftm')).toBe(r.score[side]);
        // Minutos: 5 jugadores durante todo el partido.
        expect(s('sec')).toBe(len * 5);
        // Cada asistencia es una canasta; cada tapón, un tiro taponado del rival; cada falta, una recibida.
        expect(s('ast')).toBeLessThanOrEqual(s('fgm2') + s('fgm3'));
        expect(s('blk')).toBe(s('blka', opp));
        expect(s('pf')).toBe(s('fd', opp));
        expect(s('stl')).toBeLessThanOrEqual(s('tov', opp));
        // El +/- del equipo es la diferencia del marcador por 5.
        expect(s('pm')).toBe((r.score[side] - r.score[1 - side]!) * 5);
        // Nadie pasa de 5 faltas personales... salvo la que le elimina.
        for (const b of rows) expect(b[F.pf]!).toBeLessThanOrEqual(5);
        // Rebotes: nunca más que tiros fallados.
        const misses = s('fga2') + s('fga3') - s('fgm2') - s('fgm3') + s('fta') - s('ftm');
        expect(s('orb') + s('drb', opp)).toBeLessThanOrEqual(misses);
      }
      // Los tiros del mapa son exactamente los intentos de la hoja estadística, y su zona cuadra con sus coordenadas.
      const fga = [...r.box.values()].reduce((a, b) => a + b[F.fga2]! + b[F.fga3]!, 0);
      expect(r.shots.length / 4).toBe(fga);
      for (let i = 0; i < r.shots.length; i += 4) {
        const zone = r.shots[i + 3]! & 15;
        expect(zoneOf(r.shots[i + 1]!, r.shots[i + 2]!)).toBe(zone);
        const b = r.box.get(r.shots[i]!)!;
        expect(b).toBeDefined();
        expect(ZONES[zone]!.pts === 3).toBe(isThree(r.shots[i + 1]!, r.shots[i + 2]!));
      }
    }
  });

  it('el banco de calibración queda dentro de los objetivos', () => {
    const r = runBench(1500, 3);
    const out = Object.entries(r).filter(([k, v]) => v < TARGETS[k]![0] || v > TARGETS[k]![1]);
    expect(out).toEqual([]);
  }, 120_000);
});

describe('órdenes del entrenador', () => {
  it('el plan de tiro cambia el reparto de tiros y forzar un tiro lo empeora', () => {
    const base = teams[2]!;
    const stats = (t: typeof base) => {
      let f3 = 0, fga = 0, m3 = 0;
      for (let g = 0; g < 300; g++) {
        const r = simulateGame(t, teams[5]!, 5000 + g);
        for (const [id, b] of r.box) if (r.side.get(id) === 0) { f3 += b[F.fga3]!; fga += b[F.fga2]! + b[F.fga3]!; m3 += b[F.fgm3]!; }
      }
      return { rate: f3 / fga, pct: m3 / f3 };
    };
    const normal = stats(base);
    const mas = stats({ ...base, tactics: { shot: { rim: 'normal', paint: 'normal', mid: 'normal', three: 'mas' } } });
    const menos = stats({ ...base, tactics: { shot: { rim: 'normal', paint: 'normal', mid: 'normal', three: 'menos' } } });
    expect(mas.rate).toBeGreaterThan(normal.rate + 0.05);
    expect(menos.rate).toBeLessThan(normal.rate - 0.05);
    expect(mas.pct).toBeLessThan(normal.pct);
    expect(menos.pct).toBeGreaterThan(normal.pct);
  }, 60_000);

  it('el quinteto elegido sale de titular y un jugador fuera de la rotación casi no juega', () => {
    const t = teams[3]!;
    const ids = t.players.map((p) => p.id);
    const starters = [ids[11]!, ids[10]!, ids[9]!, ids[8]!, ids[7]!];
    const out = ids[0]!;
    const r = simulateGame({ ...t, lineup: { starters, roles: { [out]: 'fuera' } } }, teams[4]!, 77);
    for (const id of starters) expect(r.starters.has(id)).toBe(true);
    expect(r.box.get(out)![F.sec]!).toBeLessThan(120);
  });
});

describe('partido en directo', () => {
  it('una orden en la posesión k no cambia nada antes de k y sí se aplica', () => {
    const [h, a] = [teams[6]!, teams[7]!];
    const base = simulateGame(h, a, 4242, { pbp: true, timeline: true });
    const k = 70;
    const snap = base.timeline!.find((t) => t.i === k)!;
    const out = snap.court[0][0]!;
    const inn = h.players.map((p) => p.id).find((id) => !snap.court[0].includes(id) && snap.fouls[id]! < 5)!;
    const r = simulateGame(h, a, 4242, { pbp: true, timeline: true, interventions: [{ at: k, side: 0, kind: 'auto', on: false }, { at: k, side: 0, kind: 'sub', in: inn, out }] });
    expect(r.timeline!.slice(0, k + 1).map((t) => t.score)).toEqual(base.timeline!.slice(0, k + 1).map((t) => t.score));
    expect(r.pbp!.filter((e) => e[7]! < k)).toEqual(base.pbp!.filter((e) => e[7]! < k));
    const after = r.timeline!.find((t) => t.i === k + 1)!;
    expect(after.court[0]).toContain(inn);
    expect(after.court[0]).not.toContain(out);
    // Con los cambios automáticos apagados, el que entra sigue en pista unas cuantas posesiones.
    expect(r.timeline!.find((t) => t.i === k + 9)!.court[0]).toContain(inn);
  });
});
