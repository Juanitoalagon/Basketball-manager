import { ATTRS, type AttrKey, type Attrs } from '../core/attributes';
/**
 * Tácticas de equipo (plan de tiro y defensa) y tendencias de cada jugador.
 * Lo de equipo se ajusta en Equipo › Tácticas; lo de cada jugador, en su ficha › Tendencias.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_DEFENSE, DEFAULT_TACTICS, DEF_SYS, OFF_SYS, type DefFocus, type DefSystem, type Defense, type Level, type OffSystem, type Pace, TEND_INFO, TEND_KEYS, type Tactics, type TendKey } from '../core/engine';
import { call } from '../db/client';
import { Loading, Tabs, useData, Toast } from './kit';

export const LEVELS: [Level, string][] = [['menos', 'Menos'], ['normal', 'Normal'], ['mas', 'Más']];
const KIND_LABEL: Record<string, string> = { rim: 'Cerca del aro', paint: 'Pintura', mid: 'Media distancia', three: 'Triples' };
export const PRESSURE: [Level, string][] = [['menos', 'Conservadora'], ['normal', 'Normal'], ['mas', 'Presión']];
export const FOCUS: [DefFocus, string][] = [['equilibrada', 'Equilibrada'], ['pintura', 'Cerrar la pintura'], ['perimetro', 'Salir a tiradores']];
export const DEF_HELP =
  'Presión: más pérdidas del rival, pero más faltas y más cansancio. Cerrar la pintura: el rival entra menos y acierta menos cerca del aro, pero tira más triples y más liberado. Salir a tiradores: lo contrario.';

export const PACES: [Pace, string][] = [['lento', 'Lento'], ['normal', 'Normal'], ['rapido', 'Rápido']];
type Fits = { off: { key: OffSystem; fit: number }[]; def: { key: DefSystem; fit: number }[] };
/** Encaje de tu plantilla con un sistema, en palabras. */
export function fitLabel(f: number | undefined) {
  if (f === undefined) return '';
  return f >= 6 ? 'encaja muy bien' : f >= 2 ? 'encaja' : f > -3 ? 'normal' : f > -8 ? 'encaja poco' : 'no encaja';
}
const fitClass = (f: number | undefined) => (f === undefined ? '' : f >= 2 ? 'good' : f > -3 ? '' : 'bad');

/** Selector de sistema con su encaje con tu plantilla. */
export function SystemPicker<T extends string>({ value, onChange, table, fits }: { value: T; onChange: (v: T) => void; table: Record<T, { label: string; hint: string }>; fits?: { key: T; fit: number }[] }) {
  return (
    <div className="opts">
      {(Object.keys(table) as T[]).map((k) => {
        const f = fits?.find((x) => x.key === k)?.fit;
        return (
          <button key={k} className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>
            {table[k].label}
            <small>{table[k].hint}</small>
            {k !== 'equilibrado' && f !== undefined && <small className={fitClass(f)}>Tu plantilla: {fitLabel(f)}</small>}
          </button>
        );
      })}
    </div>
  );
}

type Preset = { slot: number; name: string; tactics: Tactics };
/** Hasta tres planes con nombre («contra grandes», «cerrar partido»…) que se aplican con un toque. */
export function PresetsPanel({ clubId, current, onApplied }: { clubId: number; current: Tactics; onApplied: (t: Tactics) => void }) {
  const { data, reload } = useData<Preset[]>('presets', { clubId }, [clubId]);
  const [name, setName] = useState('');
  const [slot, setSlot] = useState(0);
  if (!data) return null;
  const free = [0, 1, 2].find((k) => !data.some((p) => p.slot === k)) ?? slot;
  return (
    <section className="presets">
      <h3>Planes guardados</h3>
      {data.length === 0 && <p className="muted small">Guarda tus tácticas como un plan con nombre para cambiarlas de golpe, también durante el partido en directo.</p>}
      <ul className="plain">
        {data.map((p) => (
          <li key={p.slot} className="row tight" style={{ justifyContent: 'space-between' }}>
            <span><b>{p.name}</b> <span className="muted small">{OFF_SYS[p.tactics.offense ?? 'equilibrado'].label} · {DEF_SYS[p.tactics.defense?.system ?? 'individual'].label}</span></span>
            <span className="row tight">
              <button onClick={async () => { const t = await call<Tactics | null>('applyPreset', { clubId, slot: p.slot }); if (t) onApplied(t); }}>Aplicar</button>
              <button className="sec" aria-label={`Borrar ${p.name}`} onClick={async () => { await call('deletePreset', { clubId, slot: p.slot }); reload(); }}>✕</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="row tight">
        <input type="text" placeholder="Nombre del plan" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Nombre del plan" style={{ flex: 1, marginTop: 0 }} />
        {data.length >= 3 && (
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} aria-label="Sustituir">
            {data.map((p) => <option key={p.slot} value={p.slot}>Sustituir «{p.name}»</option>)}
          </select>
        )}
        <button className="sec" onClick={async () => { await call('savePreset', { clubId, slot: data.length >= 3 ? slot : free, name: name || `Plan ${free + 1}`, tactics: current }); setName(''); reload(); }}>Guardar lo actual</button>
      </div>
    </section>
  );
}

export function TacticsEditor({ clubId }: { clubId: number }) {
  const { data, error, reload } = useData<Tactics>('tactics', { clubId }, [clubId]);
  const fits = useData<Fits>('fits', { clubId }, [clubId]);
  const [t, setT] = useState<Tactics | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (data) setT({ ...DEFAULT_TACTICS, ...data, defense: { ...DEFAULT_DEFENSE, ...data.defense, mark: null } });
  }, [data]);
  if (!data || !t) return <Loading error={error} />;
  const def = t.defense!;
  const up = (x: Partial<Tactics>) => { setT({ ...t, ...x }); setMsg(null); };
  const upDef = (x: Partial<Defense>) => up({ defense: { ...def, ...x } });
  const save = async (v: Tactics) => {
    await call('setTactics', { clubId, tactics: { ...v, defense: { ...v.defense!, mark: null, special: data.defense?.special ?? null, matchups: data.defense?.matchups ?? {} } } });
    setMsg('Guardado. Se aplica desde el próximo partido; en directo puedes cambiarlo cuando quieras.');
    reload();
  };
  return (
    <div>
      <Toast text={msg} />
      <PresetsPanel clubId={clubId} current={t} onApplied={(x) => { setT({ ...DEFAULT_TACTICS, ...x, defense: { ...DEFAULT_DEFENSE, ...x.defense, mark: null } }); setMsg('Plan aplicado y guardado.'); }} />
      <section>
        <h3>Sistema de ataque</h3>
        <SystemPicker<OffSystem> value={t.offense ?? 'equilibrado'} onChange={(v) => up({ offense: v })} table={OFF_SYS} fits={fits.data?.off} />
        <div className="slot">
          <span className="sl">Ritmo</span>
          <Tabs<Pace> small value={t.pace ?? 'normal'} onChange={(v) => up({ pace: v })} options={PACES} />
        </div>
        <p className="muted small">El encaje compara a tu mejor quinteto con lo que pide cada sistema. Un sistema que encaja mejora el acierto (hasta un 3 %); uno que no encaja, lo empeora. Ritmo rápido: más posesiones y contraataques; lento: menos posesiones, útil contra rivales mejores.</p>
      </section>
      <section>
        <h3>Plan de tiro del equipo</h3>
        {(['three', 'mid', 'paint', 'rim'] as const).map((k) => (
          <div key={k} className="slot">
            <span className="sl">{KIND_LABEL[k]}</span>
            <Tabs<Level> small value={t.shot[k]} onChange={(v) => up({ shot: { ...t.shot, [k]: v } })} options={LEVELS} />
          </div>
        ))}
        <p className="muted small">Afecta a todos: buscar más un tipo de tiro aumenta su volumen y baja algo su acierto (son tiros más forzados); buscar menos, lo contrario. Para un jugador concreto, usa sus tendencias.</p>
      </section>
      <section>
        <h3>Sistema defensivo</h3>
        <SystemPicker<DefSystem> value={def.system ?? 'individual'} onChange={(v) => upDef({ system: v })} table={DEF_SYS} fits={fits.data?.def} />
        <div className="slot">
          <span className="sl">Intensidad</span>
          <Tabs<Level> small value={def.pressure} onChange={(v) => upDef({ pressure: v })} options={PRESSURE} />
        </div>
        <div className="slot">
          <span className="sl">Prioridad</span>
          <Tabs<DefFocus> small value={def.focus} onChange={(v) => upDef({ focus: v })} options={FOCUS} />
        </div>
        <p className="muted small">{DEF_HELP} Los emparejamientos, el dos contra uno y negar el balón se eligen en el partido en directo (pestaña Táctica).</p>
      </section>
      <section>
        <h3>Tiempos muertos automáticos</h3>
        <label className="row tight"><input type="checkbox" checked={t.autoTimeout?.on ?? true} onChange={(e) => up({ autoTimeout: { run: t.autoTimeout?.run ?? 8, on: e.target.checked } })} /> Que el ayudante pida tiempo muerto</label>
        <div className="slot">
          <span className="sl">Si el rival hace un parcial de</span>
          <Tabs<string> small value={String(t.autoTimeout?.run ?? 8)} onChange={(v) => up({ autoTimeout: { on: t.autoTimeout?.on ?? true, run: Number(v) } })} options={[['6', '6-0'], ['8', '8-0'], ['10', '10-0'], ['12', '12-0']]} />
        </div>
        <p className="muted small">También lo pide si tus cinco están fundidos. Un tiempo muerto corta la racha del rival, da algo de aire y unas posesiones de concentración. FIBA: 2 en la primera parte, 3 en la segunda y 1 por prórroga.</p>
      </section>
      <div className="row">
        <button onClick={() => void save(t)}>Guardar</button>
        <button className="sec" onClick={() => { setT(DEFAULT_TACTICS); void save(DEFAULT_TACTICS); }}>Restablecer</button>
      </div>
    </div>
  );
}

type TendData = { natural: Record<TendKey, number>; override: Partial<Record<TendKey, number>>; editable: boolean };

function tendClass(v: number) {
  return v >= 80 ? 'a4' : v >= 65 ? 'a3' : v >= 45 ? 'a2' : v >= 25 ? 'a1' : 'a0';
}

/** Tendencias 1-99 de un jugador; las de los tuyos se pueden ajustar. */
/** Atributos que alimentan cada tendencia (se muestran para decidir con criterio). */
const TEND_ATTRS: Record<TendKey, AttrKey[]> = {
  uso: ['cre', 'drive', 'sht3', 'post'], tres: ['sht3', 'offb'], media: ['sht2', 'cre'], aro: ['drive', 'fin', 'jmp', 'str'],
  poste: ['post', 'str', 'fin'], pase: ['pas', 'vis'], defensa: ['perd', 'intd', 'agi', 'spd'], robo: ['stl', 'ant'],
  tapon: ['blk', 'intim', 'intd'], rebote: ['oreb', 'jmp', 'str'],
};
const ATTR_LABEL = Object.fromEntries(ATTRS.map((a) => [a.key, a.label])) as Record<AttrKey, string>;

export function TendencyEditor({ id, attrs, onSaved }: { id: number; attrs?: Attrs; onSaved?: () => void }) {
  const { data, error, reload } = useData<TendData>('tendencies', { id }, [id]);
  const [vals, setVals] = useState<Partial<Record<TendKey, number>>>({});
  const [editing, setEditing] = useState<TendKey | null>(null);
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
    setEditing(null);
    reload();
    onSaved?.();
  };
  const bump = (k: TendKey, d: number) => {
    setVals({ ...vals, [k]: Math.max(1, Math.min(99, val(k) + d)) });
    setMsg(null);
  };
  return (
    <section>
      <p className="muted small">
        De 1 a 99: con qué frecuencia busca cada cosa. Las naturales salen de sus atributos (debajo de cada una).
        {data.editable ? ' Toca «Ajustar» para cambiar una; forzar a alguien a hacer lo que no le sale empeora su acierto.' : ' Solo puedes ajustar las de tus jugadores.'}
      </p>
      <Toast text={msg} />
      {TEND_KEYS.map((k) => {
        const v = val(k);
        const nat = data.natural[k];
        const changed = v !== nat;
        return (
          <div key={k} className={`tend ${editing === k ? 'editing' : ''}`}>
            <div className="tl">
              <span title={TEND_INFO[k].hint}>{TEND_INFO[k].label}</span>
              <span>
                {changed && <span className="muted small">natural {nat} → </span>}
                <b className={`av ${tendClass(v)}`}>{v}</b>
              </span>
            </div>
            <div className="bar nat">
              <i style={{ width: `${v}%` }} />
              <em style={{ left: `${nat}%` }} title={`Natural: ${nat}`} />
            </div>
            {attrs && (
              <div className="tattrs">
                {TEND_ATTRS[k].map((a) => <span key={a}>{ATTR_LABEL[a]} <b className={`av ${tendClass(attrs[a])}`}>{attrs[a]}</b></span>)}
              </div>
            )}
            {data.editable && (editing === k ? (
              <div className="stepper">
                <button className="sec" onClick={() => bump(k, -5)}>−5</button>
                <button className="sec" onClick={() => bump(k, -1)}>−1</button>
                <b>{v}</b>
                <button className="sec" onClick={() => bump(k, 1)}>+1</button>
                <button className="sec" onClick={() => bump(k, 5)}>+5</button>
                <button className="sec" onClick={() => { setVals({ ...vals, [k]: nat }); setMsg(null); }}>Natural</button>
              </div>
            ) : (
              <button className="linkbtn" onClick={() => setEditing(k)}>Ajustar</button>
            ))}
          </div>
        );
      })}
      {data.editable && (
        <div className="row">
          <button disabled={!dirty} onClick={() => void save(Object.fromEntries(TEND_KEYS.map((k) => [k, vals[k] ?? null])))}>Guardar tendencias</button>
          <button className="sec" onClick={() => { setVals({}); void save(Object.fromEntries(TEND_KEYS.map((k) => [k, null]))); }}>Todas a las naturales</button>
        </div>
      )}
    </section>
  );
}
