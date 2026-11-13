/**
 * Formato de partida portable (.bmsave): un ZIP con
 *   manifest.json    versiones, identificador, revisión, recuentos y sumas SHA-256
 *   universe.sqlite  la partida completa
 *   README.txt       qué es el fichero
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { APP_VERSION, FORMAT_VERSION } from './schema';

export interface Manifest {
  format: number;
  appVersion: string;
  schemaVersion: number;
  engineVersion: string;
  universeId: string;
  universeName: string;
  revision: number;
  gameSeason: number;
  gameDay: number;
  exportedAt: string;
  tables: Record<string, number>;
  files: Record<string, { bytes: number; sha256: string }>;
}

export type ManifestInput = Omit<Manifest, 'format' | 'appVersion' | 'exportedAt' | 'files'>;

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const README = `Partida de Basketball Manager Advanced.
Para usarla: abre la app, ve a Datos > Importar y elige este fichero.
Dentro hay una base de datos SQLite (universe.sqlite) que se puede abrir en un
ordenador con cualquier visor de SQLite, y un manifiesto con la versión y las
sumas de verificación.
`;

export async function buildSave(dbBytes: Uint8Array, info: ManifestInput): Promise<Uint8Array> {
  const manifest: Manifest = {
    format: FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    ...info,
    files: { 'universe.sqlite': { bytes: dbBytes.length, sha256: await sha256Hex(dbBytes) } },
  };
  return zipSync(
    {
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      'universe.sqlite': dbBytes,
      'README.txt': strToU8(README),
    },
    { level: 6 },
  );
}

/** Abre y verifica un .bmsave. Lanza un error legible si algo no cuadra. No toca la partida actual. */
export async function readSave(zipBytes: Uint8Array): Promise<{ manifest: Manifest; dbBytes: Uint8Array }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch {
    throw new Error('El fichero no es una partida válida (no se puede descomprimir).');
  }
  const mf = files['manifest.json'];
  const dbBytes = files['universe.sqlite'];
  if (!mf || !dbBytes) throw new Error('El fichero no es una partida válida (faltan partes).');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(mf)) as Manifest;
  } catch {
    throw new Error('El manifiesto de la partida está dañado.');
  }
  if (typeof manifest.format !== 'number' || !manifest.universeId || !manifest.files?.['universe.sqlite']) {
    throw new Error('El manifiesto de la partida está incompleto.');
  }
  if (manifest.format > FORMAT_VERSION) {
    throw new Error(`La partida usa un formato más nuevo (${manifest.format}) que esta app (${FORMAT_VERSION}). Actualiza la app.`);
  }
  const expected = manifest.files['universe.sqlite']!;
  if (expected.bytes !== dbBytes.length || expected.sha256 !== (await sha256Hex(dbBytes))) {
    throw new Error('La partida está dañada: la suma de verificación no coincide.');
  }
  if (strFromU8(dbBytes.subarray(0, 15)) !== 'SQLite format 3') {
    throw new Error('La partida está dañada: la base de datos no es válida.');
  }
  return { manifest, dbBytes };
}
