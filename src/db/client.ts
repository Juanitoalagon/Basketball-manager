import type { LoadProgress } from './protocol';

/** Cliente de la base de datos: envía operaciones al hilo de trabajo y devuelve promesas. */
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let onProgress: ((p: LoadProgress) => void) | null = null;

worker.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.event === 'progress') {
    onProgress?.(m.progress);
    return;
  }
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  if (m.ok) w.resolve(m.result);
  else w.reject(new Error(m.error));
};
worker.onerror = (e) => {
  for (const w of waiting.values()) w.reject(new Error(e.message || 'Error en el hilo de datos.'));
  waiting.clear();
};

export function call<T>(op: string, args?: unknown): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, op, args });
  });
}
export function cancelLoad(): void {
  worker.postMessage({ op: 'cancel' });
}
export function setProgressListener(fn: ((p: LoadProgress) => void) | null): void {
  onProgress = fn;
}
