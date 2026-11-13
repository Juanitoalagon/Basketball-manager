// Prueba con los datos reales del usuario si están disponibles (no se incluyen en el proyecto).
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { estimateQuality, readSuperManagerZip } from '../src/core/importer';
const F = '/tmp/smdata/ca4aa4f0-datos.zip';
describe.skipIf(!existsSync(F))('datos reales de SuperManagerLab', () => {
  it('importa los 18 clubes y estima niveles', async () => {
    const d = await readSuperManagerZip(new Uint8Array(readFileSync(F)));
    estimateQuality(d);
    console.log('equipos', d.teams.length, 'jugadores', d.teams.reduce((a, t) => a + t.players.length, 0), 'sin ficha', d.unmatched.length, d.unmatched.slice(0, 30).join('; '), 'con temporada anterior', d.prevMatched, 'días', d.currentDays);
    for (const t of d.teams) {
      const q = t.players.map((p) => p.quality!).sort((a, b) => b - a);
      console.log(t.name.padEnd(34), t.code, t.players.length, 'top8', (q.slice(0, 8).reduce((a, b) => a + b, 0) / 8).toFixed(1), '|', t.players.sort((a, b) => b.quality! - a.quality!).slice(0, 3).map((p) => `${p.name} ${p.quality!.toFixed(0)}`).join(', '));
    }
    expect(d.teams.length).toBe(18);
  });
});
