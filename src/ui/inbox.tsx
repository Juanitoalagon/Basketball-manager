/** Bandeja de entrada y estado del club (directiva, química) en la portada. */
import { useState } from 'react';
import type * as Q from '../core/queries';
import { call } from '../db/client';
import { Loading, type Nav, useChangeTick, useData, useSticky } from './kit';
import { fmtDate } from './screens';

type Inbox = ReturnType<typeof Q.inbox>;
const ICON: Record<string, string> = {
  oferta: '💰', lesion: '✚', alta: '✅', moral: '😟', directiva: '🏛', ayudante: '📋', contrato: '📝', cesion: '↔', premio: '🏅',
  fichaje: '✍', venta: '💶', cantera: '🌱', cambio: '🔁',
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
    if (r.action?.type === 'player' && r.action.id) nav.player(r.action.id);
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
