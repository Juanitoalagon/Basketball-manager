/** Despacho del club: entrenamiento, instalaciones, ojeadores y cantera. */
import { useState } from 'react';
import type * as Q from '../core/queries';
import type { Focus, Intensity, Training } from '../core/world';
import { call } from '../db/client';
import { Face } from './Face';
import { ATTRS } from '../core/attributes';
import { CupoSummary, CupoTag, Loading, type Nav, useData } from './kit';
import { eur } from './market';

type Office = ReturnType<typeof Q.office>;
type Msg = { ok: boolean; message: string } | null;

const FOCUS: [Focus, string, string][] = [
  ['equilibrado', 'Equilibrado', 'Un poco de todo'],
  ['tiro', 'Tiro', 'Tiro de 2 y 3, libres, sin balón'],
  ['creacion', 'Creación', 'Bote, penetración, pase, visión'],
  ['interior', 'Juego interior', 'Finalización, poste, rebote, fuerza'],
  ['defensa', 'Defensa', 'Exterior, interior, ayudas, robos, tapones'],
  ['fisico', 'Físico', 'Fuerza, velocidad, agilidad, salto, resistencia'],
];
const INTENSITY: [Intensity, string, string][] = [
  ['suave', 'Suave', '×0,7 mejora · −20 % lesiones · moral +'],
  ['normal', 'Normal', 'Sin efectos añadidos'],
  ['duro', 'Duro', '×1,4 mejora · +30 % lesiones · moral −'],
];

function Level({ n, max = 5 }: { n: number; max?: number }) {
  return (
    <span className="lvl" aria-label={`Nivel ${n} de ${max}`}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}
    </span>
  );
}

function Result({ msg }: { msg: Msg }) {
  return msg ? <p className={msg.ok ? 'ok' : 'error'}>{msg.message}</p> : null;
}

export function TrainingScreen({ clubId }: { clubId: number }) {
  const { data, error, reload } = useData<Office>('office', { clubId }, [clubId]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading error={error} />;
  const set = async (t: Training) => {
    setBusy(true);
    await call('setTraining', { clubId, training: t });
    setBusy(false);
    setMsg(null);
    reload();
  };
  const upgrade = async (what: 'facilities' | 'scouting') => {
    setBusy(true);
    setMsg(await call<Msg>('upgrade', { clubId, what }));
    setBusy(false);
    reload();
  };
  const t = data.training;
  return (
    <div>
      <section>
        <h3>Foco del entrenamiento</h3>
        <p className="muted small">Se nota en la evolución de cada verano: más en los jóvenes (≤ 24 años) que en los veteranos.</p>
        <div className="opts">
          {FOCUS.map(([k, label, hint]) => (
            <button key={k} className={t.focus === k ? 'on' : ''} disabled={busy} onClick={() => set({ ...t, focus: k })} aria-pressed={t.focus === k}>
              {label}
              <small>{hint}</small>
            </button>
          ))}
        </div>
        <h3>Intensidad</h3>
        <div className="opts">
          {INTENSITY.map(([k, label, hint]) => (
            <button key={k} className={t.intensity === k ? 'on' : ''} disabled={busy} onClick={() => set({ ...t, intensity: k })} aria-pressed={t.intensity === k}>
              {label}
              <small>{hint}</small>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>Instalaciones y ojeadores</h3>
        <p className="muted small">Caja disponible: <b>{eur(data.club.cash)}</b></p>
        <dl>
          <dt>Instalaciones de entrenamiento</dt>
          <dd>
            <Level n={data.club.facilities} /> <span className="muted small">Cada nivel por encima de 3 da +15 % al efecto del entrenamiento (y −15 % por debajo).</span>
          </dd>
          <dd className="row">
            {data.upgrade.facilities !== null ? (
              <button className="sec" disabled={busy || data.club.cash < data.upgrade.facilities} onClick={() => upgrade('facilities')}>
                Mejorar al nivel {data.club.facilities + 1} · {eur(data.upgrade.facilities)}
              </button>
            ) : (
              <span className="good">Nivel máximo</span>
            )}
          </dd>
          <dt>Ojeadores</dt>
          <dd>
            <Level n={data.club.scouting} /> <span className="muted small">El potencial que ves es una estimación: ahora con un error típico de ±{data.scoutError.toFixed(1).replace('.', ',')} puntos.</span>
          </dd>
          <dd className="row">
            {data.upgrade.scouting !== null ? (
              <button className="sec" disabled={busy || data.club.cash < data.upgrade.scouting} onClick={() => upgrade('scouting')}>
                Mejorar al nivel {data.club.scouting + 1} · {eur(data.upgrade.scouting)}
              </button>
            ) : (
              <span className="good">Nivel máximo</span>
            )}
          </dd>
        </dl>
        <Result msg={msg} />
      </section>
    </div>
  );
}

type TrainingOv = { slots: number; used: number; players: { id: number; name: string; pos1: string; age: number; youth: number; ovr: number; plan: string | null; nationality: string; origin: string }[] };
const GROUP_PLANS: [string, string][] = [['grupo:off', 'Ataque (todo)'], ['grupo:def', 'Defensa (todo)'], ['grupo:fis', 'Físico'], ['grupo:men', 'Mental']];
const ARQ_PLANS: [string, string][] = [['arq:tirador', 'Tirador'], ['arq:3d', '3&D'], ['arq:director', 'Director'], ['arq:anotador', 'Anotador'], ['arq:penetrador', 'Penetrador'], ['arq:defensor', 'Defensor'], ['arq:protector', 'Protector del aro'], ['arq:reboteador', 'Reboteador'], ['arq:poste', 'Poste bajo'], ['arq:abierto', 'Pívot abierto']];
const POS_PLANS: [string, string][] = [['pos:PG', 'Aprender a jugar de base'], ['pos:SG', 'Aprender de escolta'], ['pos:SF', 'Aprender de alero'], ['pos:PF', 'Aprender de ala-pívot'], ['pos:C', 'Aprender de pívot']];
export function planLabel(plan: string | null): string {
  if (!plan) return 'Con el grupo';
  const all = [...GROUP_PLANS, ...ARQ_PLANS, ...POS_PLANS];
  const hit = all.find(([k]) => k === plan);
  if (hit) return hit[1];
  if (plan.startsWith('attr:')) return ATTRS.find((a) => a.key === plan.slice(5))?.label ?? plan;
  return plan;
}

/** Entrenamiento individual: un plan por jugador (plazas según las instalaciones). */
export function IndividualTraining({ clubId, nav }: { clubId: number; nav: Nav }) {
  const { data, error, reload } = useData<TrainingOv>('training', { clubId }, [clubId]);
  const [msg, setMsg] = useState<Msg>(null);
  if (!data) return <Loading error={error} />;
  const set = async (id: number, plan: string | null) => {
    setMsg(await call<Msg>('setPlan', { id, clubId, plan }));
    reload();
  };
  return (
    <section>
      <h3>Entrenamiento individual · {data.used}/{data.slots} plazas</h3>
      <p className="muted small">Un plan concreto para cada jugador, además del foco del equipo: un atributo, un grupo, un arquetipo (por ejemplo, convertir a un alero en 3&D) o aprender una posición nueva. Se nota en la evolución de verano: mucho en los jóvenes (sobre todo en la cantera) y poco en los veteranos. Más plazas mejorando las instalaciones.</p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.message}</p>}
      {data.players.map((p) => (
        <div key={p.id} className="trow">
          <span className="tap" onClick={() => nav.player(p.id)}>
            <b>{p.name}</b> <span className="muted small">{p.pos1} · {p.ovr} · {p.age} años{p.youth ? ' · cantera' : ''}</span>
          </span>
          <select value={p.plan ?? ''} onChange={(e) => void set(p.id, e.target.value || null)} aria-label={`Plan de ${p.name}`}>
            <option value="">Con el grupo</option>
            <optgroup label="Grupos">{GROUP_PLANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
            <optgroup label="Arquetipo">{ARQ_PLANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
            <optgroup label="Atributo concreto">{ATTRS.filter((a) => a.group !== 'men').map((a) => <option key={a.key} value={`attr:${a.key}`}>{a.label}</option>)}</optgroup>
            <optgroup label="Posición">{POS_PLANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
          </select>
        </div>
      ))}
    </section>
  );
}

export function YouthScreen({ clubId, nav }: { clubId: number; nav: Nav }) {
  const { data, error, reload } = useData<Office>('office', { clubId }, [clubId]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading error={error} />;
  const act = async (op: 'promoteYouth' | 'releaseYouth', id: number) => {
    setBusy(true);
    setMsg(await call<Msg>(op, { clubId, id }));
    setBusy(false);
    reload();
  };
  return (
    <div>
      <section>
        <h3>Cantera</h3>
        <p className="muted small">
          Juveniles de 16 a 18 años. No juegan ni cobran hasta que los subes: entonces firman un contrato de formación de 30 mil € por 4 temporadas.
          Cada verano llegan 3 nuevos; los que cumplen 19 sin subir se marchan.
        </p>
        <p className="muted small">Plantilla: {data.roster}/16 · Potencial estimado con un error de ±{data.scoutError.toFixed(1).replace('.', ',')} (ojeadores nivel {data.club.scouting}).</p>
        <CupoSummary cupo={data.cupo} />
      </section>
      <Result msg={msg} />
      <section>
        {data.youth.length === 0 && <p className="muted">Ahora mismo no hay juveniles. Llegarán en la próxima pretemporada.</p>}
        {data.youth.map((y) => (
          <div key={y.id} className="youth">
            <span className="tap" onClick={() => nav.player(y.id)}>
              <Face id={y.id} nationality={y.nationality} age={y.age} colors={data.club.colors} size={44} />
            </span>
            <div className="info tap" onClick={() => nav.player(y.id)}>
              <b>{y.name}</b> <CupoTag nationality={y.nationality} />
              <div className="muted small">
                {y.pos1}{y.pos2 ? `/${y.pos2}` : ''} · {y.age} años · {(y.height_cm / 100).toFixed(2).replace('.', ',')} m
              </div>
              <div className="small">
                Media <b>{y.ovr}</b> · Potencial <b className={y.potential_est >= 75 ? 'good' : ''}>{y.potential_est}</b>
              </div>
            </div>
            <div className="acts">
              <button disabled={busy || data.roster >= 16} onClick={() => act('promoteYouth', y.id)}>Subir</button>
              <button className="sec" disabled={busy} onClick={() => act('releaseYouth', y.id)}>Descartar</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
