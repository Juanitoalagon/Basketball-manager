/** Piezas comunes de la interfaz: datos asíncronos, tablas ordenables, pestañas y formatos. */
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../db/client';

export const f0 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : Math.round(x).toLocaleString('es-ES'));
export const f1 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const f2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const pc = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (x * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const pcRaw = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const mins = (sec: number, gp = 1) => (gp > 0 ? f1(sec / 60 / gp) : '—');
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
export const signed = (x: number) => (x > 0 ? `+${f0(x)}` : f0(x));
export const seasonLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

export function useData<T>(op: string, args: unknown, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    let alive = true;
    setError(null);
    call<T>(op, args)
      .then((d) => alive && setData(d))
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
export function Table<R>({ cols, rows, rowKey, onRow, highlight, defaultSort, caption, foot }: {
  cols: Col<R>[];
  rows: R[];
  rowKey: (r: R) => string | number;
  onRow?: (r: R) => void;
  highlight?: (r: R) => boolean;
  defaultSort?: { key: string; desc: boolean } | null;
  caption?: string;
  foot?: ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(defaultSort ?? null);
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
                onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: !c.left }))}
              >
                {c.label}
                {sort?.key === c.key ? (sort.desc ? ' ▾' : ' ▴') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
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
    </div>
  );
}

export function Tag({ kind }: { kind: 'sim' | 'real' | 'est' }) {
  const t = { sim: ['Simulado', 'Estadística generada por el motor del juego'], real: ['Real', 'Dato de una competición real importado'], est: ['Estimado', 'Valor estimado, no medido'] }[kind];
  return <span className={`tag ${kind}`} title={t[1]}>{t[0]}</span>;
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
  back: () => void;
};
