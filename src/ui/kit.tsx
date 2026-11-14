/** Piezas comunes de la interfaz: datos asíncronos, tablas ordenables, pestañas y formatos. */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../db/client';
import { COUNTRY_LABEL, CUPO_RULES, cupoOf } from '../core/names';

export const f0 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : Math.round(x).toLocaleString('es-ES'));
export const f1 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const f2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const pc = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (x * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const pcRaw = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const mins = (sec: number, gp = 1) => (gp > 0 ? f1(sec / 60 / gp) : '—');
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
export const signed = (x: number) => (x > 0 ? `+${f0(x)}` : f0(x));
/** «Óscar Crespo Reyes» → «Ó. Crespo»; «Rokas Petrauskas» → «R. Petrauskas». Para tablas estrechas. */
export function shortName(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length < 2) return name;
  return `${p[0]![0]}. ${p.length >= 3 ? p[1] : p.slice(1).join(' ')}`;
}
/** Orden natural de las posiciones al ordenar tablas: PG, SG, SF, PF, C. */
export const POS_ORDER: Record<string, number> = { PG: 1, SG: 2, SF: 3, PF: 4, C: 5 };
export const posSort = (pos1: string, pos2?: string | null) => (POS_ORDER[pos1] ?? 9) + (pos2 ? (POS_ORDER[pos2] ?? 0) / 10 : 0);
export const seasonLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

/**
 * Estado que sobrevive al cambiar de pantalla y volver (filtros, pestañas, orden de tablas).
 * Vive en memoria mientras la app está abierta.
 */
const sticky = new Map<string, unknown>();
let anonN = 0;
export function useSticky<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (sticky.has(key) ? (sticky.get(key) as T) : init));
  const set = useCallback((x: T) => {
    sticky.set(key, x);
    setV(x);
  }, [key]);
  return [v, set];
}

/** Aviso global de «algo ha cambiado» (fichajes, ventas…) para que se refresquen el dinero y similares. */
const changeListeners = new Set<() => void>();
export function notifyChange() {
  for (const l of changeListeners) l();
}
export function useChangeTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((x) => x + 1);
    changeListeners.add(f);
    return () => {
      changeListeners.delete(f);
    };
  }, []);
  return n;
}

/** Última respuesta de cada consulta: al volver a una pantalla se pinta al momento y luego se refresca. */
const dataCache = new Map<string, unknown>();
export function clearDataCache() {
  dataCache.clear();
}

export function useData<T>(op: string, args: unknown, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const cacheKey = `${op}|${JSON.stringify(args)}`;
  const [data, setData] = useState<T | null>(() => (dataCache.get(cacheKey) as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    let alive = true;
    setError(null);
    const cached = dataCache.get(cacheKey) as T | undefined;
    if (cached !== undefined) setData(cached);
    call<T>(op, args)
      .then((d) => {
        dataCache.set(cacheKey, d);
        if (alive) setData(d);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, n, ...deps]);
  return { data, error, reload };
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;
}

export function Tabs<T extends string>({ value, options, onChange, small }: { value: T; options: [T, string][]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={`tabs ${small ? 'small' : ''}`} role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export interface Col<R> {
  key: string;
  label: string;
  title?: string;
  value: (r: R) => number | string | null;
  render?: (r: R) => ReactNode;
  left?: boolean;
}

/** Tabla con primera columna fija, desplazamiento horizontal y orden al tocar la cabecera. */
export function Table<R>({ cols, rows, rowKey, onRow, highlight, defaultSort, caption, foot, id, page }: {
  cols: Col<R>[];
  rows: R[];
  rowKey: (r: R) => string | number;
  onRow?: (r: R) => void;
  highlight?: (r: R) => boolean;
  defaultSort?: { key: string; desc: boolean } | null;
  caption?: string;
  foot?: ReactNode;
  /** Si se da, el orden elegido se recuerda al volver a la pantalla. */
  id?: string;
  /** Filas que se pintan de entrada (las demás, con «Mostrar más»): listas largas sin atascar el móvil. */
  page?: number;
}) {
  const anon = useRef(`anon${++anonN}`);
  const [shown, setShown] = useState(page ?? Infinity);
  const [sort, setSort] = useSticky<{ key: string; desc: boolean } | null>(`sort:${id ?? anon.current}`, defaultSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.key === sort.key);
    if (!c) return rows;
    return [...rows].sort((a, b) => {
      const va = c.value(a);
      const vb = c.value(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
      return sort.desc ? -d : d;
    });
  }, [rows, sort, cols]);
  return (
    <div className="tbl">
      <table>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                title={c.title}
                className={`${c.left ? 'l' : ''} ${sort?.key === c.key ? 'sorted' : ''}`}
                onClick={() => setSort(sort?.key === c.key ? { key: c.key, desc: !sort.desc } : { key: c.key, desc: !c.left })}
              >
                {c.label}
                {sort?.key === c.key ? (sort.desc ? ' ▾' : ' ▴') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, shown).map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} className={`${onRow ? 'tap' : ''} ${highlight?.(r) ? 'me' : ''}`}>
              {cols.map((c) => (
                <td key={c.key} className={c.left ? 'l' : ''}>
                  {c.render ? c.render(r) : (c.value(r) ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot}
      </table>
      {sorted.length > shown && <button className="sec more" onClick={() => setShown(shown + (page ?? 100))}>Mostrar más ({sorted.length - shown} más)</button>}
    </div>
  );
}

export function Tag({ kind }: { kind: 'sim' | 'real' | 'est' }) {
  const t = { sim: ['Simulado', 'Estadística generada por el motor del juego'], real: ['Real', 'Dato de una competición real importado'], est: ['Estimado', 'Valor estimado, no medido'] }[kind];
  return <span className={`tag ${kind}`} title={t[1]}>{t[0]}</span>;
}

const CUPO_TXT = { NAC: ['NAC', 'Nacional (jugador de formación española)'], COM: ['COM', 'Comunitario o asimilado: no ocupa plaza de extracomunitario'], EXT: ['EXT', 'Extracomunitario: máximo ' + CUPO_RULES.maxExt + ' por plantilla'] } as const;
/** Etiqueta de cupo (NAC / COM / EXT) con color propio. */
export function CupoTag({ nationality, full }: { nationality: string; full?: boolean }) {
  const c = cupoOf(nationality);
  return (
    <span className={`cupo ${c.toLowerCase()}`} title={`${CUPO_TXT[c][1]} · ${COUNTRY_LABEL[nationality] ?? nationality}`}>
      {CUPO_TXT[c][0]}{full ? ` · ${COUNTRY_LABEL[nationality] ?? nationality}` : ''}
    </span>
  );
}
/** Resumen de cupos de una plantilla, en rojo si incumple. */
export function CupoSummary({ cupo }: { cupo: { NAC: number; COM: number; EXT: number } }) {
  return (
    <div className="cupos">
      <span className={cupo.NAC < CUPO_RULES.minNac ? 'bad' : ''}><span className="cupo nac">NAC</span> {cupo.NAC} <small>(mín. {CUPO_RULES.minNac})</small></span>
      <span><span className="cupo com">COM</span> {cupo.COM}</span>
      <span className={cupo.EXT > CUPO_RULES.maxExt ? 'bad' : ''}><span className="cupo ext">EXT</span> {cupo.EXT} <small>(máx. {CUPO_RULES.maxExt})</small></span>
    </div>
  );
}

export function Back({ onBack, label = 'Volver' }: { onBack: () => void; label?: string }) {
  return (
    <button className="back" onClick={onBack}>
      ‹ {label}
    </button>
  );
}

export type Nav = {
  player: (id: number) => void;
  game: (id: number) => void;
  club: (id: number) => void;
  live: () => void;
  back: () => void;
};

/**
 * Aviso flotante: aparece encima de la barra inferior y se va solo a los 4 s (o al tocarlo).
 * No empuja el contenido, así la pantalla no salta al guardar algo.
 */
export function Toast({ text, ok = true }: { text: string | null | undefined; ok?: boolean }) {
  const [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    setHidden(null);
    const t = setTimeout(() => setHidden(text), 4000);
    return () => clearTimeout(t);
  }, [text]);
  if (!text || hidden === text) return null;
  return <div className={`toast ${ok ? 'ok' : 'error'}`} role="status" onClick={() => setHidden(text)}>{text}</div>;
}
