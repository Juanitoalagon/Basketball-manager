/** Bandeja de entrada y estado del club (directiva, química) en la portada. */
import { useState } from 'react';
import type * as Q from '../core/queries';
import { call } from '../db/client';
import { Loading, type Nav, notifyChange, useChangeTick, useData, useSticky } from './kit';
import { fmtDate } from './screens';

type Inbox = ReturnType<typeof Q.inbox>;
const ICON: Record<string, string> = {
  oferta: '💰', lesion: '✚', alta: '✅', moral: '😟', directiva: '🏛', ayudante: '📋', contrato: '📝', cesion: '↔', premio: '🏅',
  fichaje: '✍', venta: '💶', cantera: '🌱', cambio: '🔁', peticion: '😠',
};

export function InboxPanel({ clubId, nav }: { clubId: number; nav: Nav }) {
  const tick = useChangeTick();
  const { data, error, reload } = useData<Inbox>('inbox', { clubId }, [clubId, tick]);
  const [all, setAll] = useSticky('inbox.all', false);
  const [, setBusy] = useState(false);
  if (!data) return <Loading error={error} />;
  const rows = all ? data.rows : data.rows.slice(0, 5);
  const open = async (r: Inbox['rows'][number]) => {
    if (!r.read) {
      setBusy(true);
      await call('markRead', { clubId, ids: [r.id] });
      setBusy(false);
      reload();
    }
    if ((r.action?.type === 'player' || r.action?.type === 'request') && r.action.id) nav.player(r.action.id);
    else if (r.player_id) nav.player(r.player_id);
  };
  return (
    <section className="inbox">
      <h3>
        Bandeja de entrada {data.unread > 0 && <span className="badge">{data.unread}</span>}
      </h3>
      {data.rows.length === 0 && <p className="muted">Aquí llegarán las ofertas, los informes del ayudante, la directiva, las lesiones y los contratos.</p>}
      <ul className="plain">
        {rows.map((r) => (
          <li key={r.id} className={`msg ${r.read ? '' : 'unread'} ${r.action || r.player_id ? 'tap' : ''}`} onClick={() => void open(r)}>
            <span className="ic" aria-hidden="true">{ICON[r.kind] ?? '•'}</span>
            <span className="tx">{r.text}</span>
            <span className="muted small">{r.date ? fmtDate(r.date) : ''}</span>
          </li>
        ))}
      </ul>
      <div className="row">
        {data.rows.length > 5 && <button className="sec" onClick={() => setAll(!all)}>{all ? 'Ver menos' : `Ver todo (${data.rows.length})`}</button>}
        {data.unread > 0 && <button className="sec" onClick={async () => { await call('markRead', { clubId }); reload(); }}>Marcar todo como leído</button>}
      </div>
    </section>
  );
}

type Board = { confidence: number; chemistry: number; cash: number; budget: number; payroll: number; objective: { target: string; result: string | null } | null; last: { target: string; result: string | null } | null };
export function BoardCard({ clubId }: { clubId: number }) {
  const tick = useChangeTick();
  const { data } = useData<Board>('board', { clubId }, [clubId, tick]);
  if (!data) return null;
  const meter = (v: number) => <span className="meter"><i style={{ width: `${Math.max(3, Math.min(100, v))}%` }} className={v >= 60 ? 'g' : v >= 40 ? 'm' : 'b'} /></span>;
  return (
    <section className="board">
      <div><small>Objetivo de la directiva</small><b>{data.objective?.target ?? '—'}</b>{data.objective?.result && <span className={data.objective.result === 'fallado' ? 'bad' : 'good'}> · {data.objective.result}</span>}</div>
      <div className="two">
        <div><small>Confianza de la directiva</small>{meter(data.confidence)}<span className="small">{Math.round(data.confidence)}</span></div>
        <div><small>Química del equipo</small>{meter(data.chemistry)}<span className="small">{Math.round(data.chemistry)}</span></div>
      </div>
      <p className="muted small">Cumplir el objetivo sube el presupuesto de la próxima temporada (+5 %, o +12 % si lo superas); fallarlo lo recorta un 8 %. Nunca te despiden.</p>
    </section>
  );
}

type Promise0 = { kind: string; minutes: number; strikes: number; broken: number; season: number } | null;
/** Jugador que pide salir, transferible o con una promesa: estado y qué puede hacer el entrenador. */
export function RequestPanel({ id, wantsOut, listed, promise, onDone }: { id: number; wantsOut: boolean; listed: boolean; promise: Promise0; onDone: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [mins, setMins] = useState(20);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    const r = await call<{ ok: boolean; message: string }>('request', { id, action, ...extra });
    setMsg(r);
    notifyChange();
    onDone();
  };
  return (
    <div className={`reqbox ${wantsOut ? 'bad' : ''}`}>
      {wantsOut && <b>😠 Pide salir del club</b>}
      {listed && <div className="small">📋 En la lista de transferibles: le llegan más ofertas.</div>}
      {promise && <div className="small">{promise.broken ? '💔 Le rompiste una promesa: ya no se fía de ti.' : `🤝 Le prometiste unos ${promise.minutes} minutos esta temporada${promise.strikes ? ` · avisos ${promise.strikes}/5` : ''}.`}</div>}
      {wantsOut && <p className="muted small">Mientras quiera irse rinde algo menos (−3 en todo).</p>}
      <div className="row tight">
        {wantsOut && <button className="sec" onClick={() => void act('hablar')}>Hablar con él</button>}
        {wantsOut && !promise?.broken && (
          <span className="row tight">
            <select value={mins} onChange={(e) => setMins(Number(e.target.value))} aria-label="Minutos prometidos">{[10, 15, 20, 25, 30].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
            <button className="sec" onClick={() => void act('prometer', { minutes: mins })}>Prometer minutos</button>
          </span>
        )}
        {!listed ? (wantsOut && <button className="sec" onClick={() => void act('vender')}>Ponerlo en venta</button>) : <button className="sec" onClick={() => void act('quitar')}>Quitar de transferibles</button>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.message}</p>}
    </div>
  );
}
