/**
 * Tácticas de equipo (plan de tiro y defensa) y tendencias de cada jugador.
 * Lo de equipo se ajusta en Equipo › Tácticas; lo de cada jugador, en su ficha › Tendencias.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_DEFENSE, type DefFocus, type Defense, type Level, TEND_INFO, TEND_KEYS, type Tactics, type TendKey } from '../core/engine';
import { call } from '../db/client';
import { Loading, Tabs, useData } from './kit';

export const LEVELS: [Level, string][] = [['menos', 'Menos'], ['normal', 'Normal'], ['mas', 'Más']];
const KIND_LABEL: Record<string, string> = { rim: 'Cerca del aro', paint: 'Pintura', mid: 'Media distancia', three: 'Triples' };
export const PRESSURE: [Level, string][] = [['menos', 'Conservadora'], ['normal', 'Normal'], ['mas', 'Presión']];
export const FOCUS: [DefFocus, string][] = [['equilibrada', 'Equilibrada'], ['pintura', 'Cerrar la pintura'], ['perimetro', 'Salir a tiradores']];
export const DEF_HELP =
  'Presión: más pérdidas del rival, pero más faltas y más cansancio. Cerrar la pintura: el rival entra menos y acierta menos cerca del aro, pero tira más triples y más liberado. Salir a tiradores: lo contrario. Marcaje especial: el elegido recibe menos balón y tira peor; el resto del rival, algo mejor.';

export function TacticsEditor({ clubId }: { clubId: number }) {
  const { data, error, reload } = useData<Tactics>('tactics', { clubId }, [clubId]);
  const [plan, setPlan] = useState<Tactics['shot'] | null>(null);
  const [def, setDef] = useState<Defense>(DEFAULT_DEFENSE);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setPlan(data.shot);
    setDef({ ...DEFAULT_DEFENSE, ...data.defense, mark: null });
  }, [data]);
  if (!data || !plan) return <Loading error={error} />;
  const save = async (p: Tactics['shot'], d: Defense) => {
    await call('setTactics', { clubId, tactics: { shot: p, defense: { ...d, mark: null } } });
    setMsg('Guardado. Se aplica desde el próximo partido; en directo puedes cambiarlo cuando quieras.');
    reload();
  };
  return (
    <div>
      {msg && <p className="ok">{msg}</p>}
      <section>
        <h3>Plan de tiro del equipo</h3>
        {(['three', 'mid', 'paint', 'rim'] as const).map((k) => (
          <div key={k} className="slot">
            <span className="sl">{KIND_LABEL[k]}</span>
            <Tabs<Level> small value={plan[k]} onChange={(v) => { setPlan({ ...plan, [k]: v }); setMsg(null); }} options={LEVELS} />
          </div>
        ))}
        <p className="muted small">Afecta a todos: buscar más un tipo de tiro aumenta su volumen y baja algo su acierto (son tiros más forzados); buscar menos, lo contrario. Para un jugador concreto, usa sus tendencias.</p>
      </section>
      <section>
        <h3>Defensa del equipo</h3>
        <div className="slot">
          <span className="sl">Intensidad</span>
          <Tabs<Level> small value={def.pressure} onChange={(v) => { setDef({ ...def, pressure: v }); setMsg(null); }} options={PRESSURE} />
        </div>
        <div className="slot">
          <span className="sl">Prioridad</span>
          <Tabs<DefFocus> small value={def.focus} onChange={(v) => { setDef({ ...def, focus: v }); setMsg(null); }} options={FOCUS} />
        </div>
        <p className="muted small">{DEF_HELP} El marcaje especial se elige en el partido en directo.</p>
      </section>
      <div className="row">
        <button onClick={() => void save(plan, def)}>Guardar</button>
        <button className="sec" onClick={() => {
          const p = { rim: 'normal', paint: 'normal', mid: 'normal', three: 'normal' } as Tactics['shot'];
          setPlan(p);
          setDef(DEFAULT_DEFENSE);
          void save(p, DEFAULT_DEFENSE);
        }}>Restablecer</button>
      </div>
    </div>
  );
}

type TendData = { natural: Record<TendKey, number>; override: Partial<Record<TendKey, number>>; editable: boolean };

function tendClass(v: number) {
  return v >= 80 ? 'a4' : v >= 65 ? 'a3' : v >= 45 ? 'a2' : v >= 25 ? 'a1' : 'a0';
}

/** Tendencias 1-99 de un jugador; las de los tuyos se pueden ajustar. */
export function TendencyEditor({ id, onSaved }: { id: number; onSaved?: () => void }) {
  const { data, error, reload } = useData<TendData>('tendencies', { id }, [id]);
  const [vals, setVals] = useState<Partial<Record<TendKey, number>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (data) setVals({ ...data.override });
  }, [data]);
  if (!data) return <Loading error={error} />;
  const val = (k: TendKey) => vals[k] ?? data.natural[k];
  const dirty = TEND_KEYS.some((k) => (vals[k] ?? null) !== (data.override[k] ?? null));
  const save = async (v: Partial<Record<TendKey, number | null>>) => {
    await call('setTendencies', { id, values: v });
    setMsg('Guardado. Se nota desde el próximo partido.');
    reload();
    onSaved?.();
  };
  return (
    <section>
      <p className="muted small">
        De 1 a 99: con qué frecuencia busca cada cosa. Las naturales salen de sus atributos (quien tira bien de tres, tiende a tirar de tres).
        {data.editable ? ' Puedes ajustarlas; forzar a alguien a hacer lo que no le sale empeora su acierto.' : ' Solo puedes ajustar las de tus jugadores.'}
      </p>
      {msg && <p className="ok">{msg}</p>}
      {TEND_KEYS.map((k) => {
        const v = val(k);
        const nat = data.natural[k];
        const changed = vals[k] !== undefined && vals[k] !== nat;
        return (
          <div key={k} className="tend">
            <div className="tl">
              <span title={TEND_INFO[k].hint}>{TEND_INFO[k].label}</span>
              <b className={`av ${tendClass(v)}`}>{v}</b>
            </div>
            {data.editable ? (
              <input type="range" min={1} max={99} value={v} aria-label={TEND_INFO[k].label}
                onChange={(e) => { setVals({ ...vals, [k]: Number(e.target.value) }); setMsg(null); }} />
            ) : (
              <div className="bar"><i style={{ width: `${v}%` }} /></div>
            )}
            <div className="muted small">{TEND_INFO[k].hint}{changed ? ` · natural ${nat}` : ''}</div>
          </div>
        );
      })}
      {data.editable && (
        <div className="row">
          <button disabled={!dirty} onClick={() => void save(Object.fromEntries(TEND_KEYS.map((k) => [k, vals[k] ?? null])))}>Guardar tendencias</button>
          <button className="sec" onClick={() => { setVals({}); void save(Object.fromEntries(TEND_KEYS.map((k) => [k, null]))); }}>Volver a las naturales</button>
        </div>
      )}
    </section>
  );
}
