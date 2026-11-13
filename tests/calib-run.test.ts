import { it } from 'vitest';
import { TARGETS, runBench } from './calib';
import { TUNE } from '../src/core/engine';
for (const [k, v] of Object.entries(JSON.parse(process.env.TUNE ?? '{}'))) (TUNE as any)[k] = typeof v === 'object' ? { ...(TUNE as any)[k], ...(v as object) } : v;
it('calib', () => {
  const t0 = performance.now();
  const r = runBench(Number(process.env.GAMES ?? 800), Number(process.env.SEED ?? 1));
  const ms = performance.now() - t0;
  for (const [k, v] of Object.entries(r)) {
    const [lo, hi] = TARGETS[k]!;
    console.log(k.padEnd(11), v.toFixed(3).padStart(8), `  [${lo}, ${hi}]`, v < lo || v > hi ? '  <-- FUERA' : '');
  }
  console.log('ms/partido', (ms / Number(process.env.GAMES ?? 800)).toFixed(2));
}, 600000);
