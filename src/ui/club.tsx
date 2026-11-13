/** Despacho del club: entrenamiento, instalaciones, ojeadores y cantera. */
import { useState } from 'react';
import type * as Q from '../core/queries';
import type { Focus, Intensity, Training } from '../core/world';
import { call } from '../db/client';
import { Face } from './Face';
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
