/**
 * Estadísticas de la ficha (v0.8): una tarjeta por temporada con el club en el que jugaba, una fila por
 * competición y solo cuatro números grandes a la vez (se cambia de grupo con las pestañas), más la
 * trayectoria del jugador: de qué cantera sale y por qué clubes ha pasado.
 */
import { useMemo } from 'react';
import type { PlayerLine } from '../core/queries';
import { reb, type Line } from '../core/stats';
import { type Nav, Tabs, Tag, f1, mins, pc, pcRaw, seasonLabel, signed, useSticky } from './kit';
import { eur } from './market';

export interface CareerRow {
  season: number; comp: string; competition_id: number; stage: string; line: PlayerLine;
  club_id: number; club: string; club_short: string; club_colors: string | null;
}
export interface Move { season: number; day: number; kind: string; fee: number; from_club: number | null; to_club: number | null; from_name: string | null; to_name: string | null }

type Grp = 'basic' | 'shoot' | 'adv';
const per = (l: Line, v: number) => (l.gp ? v / l.gp : null);
const GROUPS: Record<Grp, { label: string; get: (l: PlayerLine) => string }[]> = {
  basic: [
    { label: 'PTS', get: (l) => f1(per(l, l.pts)) },
    { label: 'REB', get: (l) => f1(per(l, reb(l))) },
    { label: 'AST', get: (l) => f1(per(l, l.ast)) },
    { label: 'VAL', get: (l) => f1(per(l, l.pir)) },
  ],
  shoot: [
    { label: 'T2%', get: (l) => pc(l.fga2 ? l.fgm2 / l.fga2 : null) },
    { label: 'T3%', get: (l) => pc(l.fga3 ? l.fgm3 / l.fga3 : null) },
    { label: 'T1%', get: (l) => pc(l.fta ? l.ftm / l.fta : null) },
    { label: 'TS%', get: (l) => pc(l.ts) },
  ],
  adv: [
    { label: 'USG%', get: (l) => pcRaw(l.usg) },
    { label: 'WS', get: (l) => f1(l.ws) },
    { label: 'VA', get: (l) => f1(l.va) },
    { label: '+/-', get: (l) => (l.gp ? signed(Math.round(l.pm / l.gp)) : '—') },
  ],
};
const SUB: Record<Grp, (l: PlayerLine) => string> = {
  basic: (l) => `${f1(per(l, l.stl))} rob · ${f1(per(l, l.blk))} tap · ${f1(per(l, l.tov))} pér`,
  shoot: (l) => `${l.fgm2}/${l.fga2} de dos · ${l.fgm3}/${l.fga3} de tres · ${l.ftm}/${l.fta} libres`,
  adv: (l) => `Ataque ${f1(l.ows)} · defensa ${f1(l.dws)} victorias aportadas`,
};
const KIND: Record<string, string> = {
  libre: 'Firma como agente libre', traspaso: 'Traspaso', clausula: 'Pago de cláusula', cambio: 'Intercambio',
  rescision: 'Rescisión', renovacion: 'Renueva', cesion: 'Cesión', cantera: 'Sube de la cantera',
};
const color = (c: string | null) => {
  try { const a = JSON.parse(c ?? '[]') as string[]; return a[0]?.toLowerCase() === '#ffffff' ? a[1] : a[0]; } catch { return undefined; }
};

export function CareerView({ career, moves, youthClub, currentClub, season, nav }: { career: CareerRow[]; moves: Move[]; youthClub: string | null; currentClub: string | null; season: number; nav: Nav }) {
  const [grp, setGrp] = useSticky<Grp>('career.grp', 'basic');
  const seasons = useMemo(() => {
    const m = new Map<number, CareerRow[]>();
    for (const r of career) m.set(r.season, [...(m.get(r.season) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [career]);
  // Etapas: temporadas seguidas en el mismo club (una cesión cuenta como etapa propia).
  const spells = useMemo(() => {
    const out: { club: string; club_id: number; colors: string | null; from: number; to: number; gp: number }[] = [];
    for (const [s, rows] of [...seasons].reverse()) {
      for (const clubId of [...new Set(rows.map((r) => r.club_id))]) {
        const r = rows.find((x) => x.club_id === clubId)!;
        const gp = rows.filter((x) => x.club_id === clubId).reduce((a, x) => a + x.line.gp, 0);
        const last = out[out.length - 1];
        if (last && last.club_id === clubId && last.to >= s - 1) { last.to = s; last.gp += gp; } else out.push({ club: r.club, club_id: clubId, colors: r.club_colors, from: s, to: s, gp });
      }
    }
    return out;
  }, [seasons]);

  return (
    <>
      <section>
        <h3>Trayectoria</h3>
        <ul className="plain traj">
          {youthClub && <li>🌱 Formado en la cantera de <b>{youthClub}</b></li>}
          {spells.map((sp, i) => (
            <li key={i} className="tap" onClick={() => nav.club(sp.club_id)}>
              <span className="sw" style={{ background: color(sp.colors) }} />
              <b>{sp.club}</b> <span className="muted small">{sp.from === sp.to ? seasonLabel(sp.from) : `${seasonLabel(sp.from)} a ${seasonLabel(sp.to)}`} · {sp.gp} partidos</span>
            </li>
          ))}
          {spells.length === 0 && <li className="muted">{currentClub ? `En ${currentClub}; aún sin partidos.` : 'Sin partidos todavía.'}</li>}
        </ul>
        {moves.length > 0 && (
          <>
            <h4 className="aw">Movimientos</h4>
            <ul className="plain moves">
              {[...moves].reverse().map((m, i) => (
                <li key={i}>
                  <span className="muted small">{seasonLabel(m.season)}{m.day ? ` · día ${m.day}` : ' · verano'}</span>
                  <div>
                    <b>{KIND[m.kind] ?? m.kind}</b>{' '}
                    {m.kind === 'renovacion' ? `con ${m.to_name}` : m.kind === 'rescision' ? `con ${m.from_name}` : `${m.from_name ? `${m.from_name} → ` : ''}${m.to_name ?? 'agente libre'}`}
                    {m.fee > 0 && m.kind !== 'rescision' && <span className="muted"> · {eur(m.fee)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted small">Antes de {seasonLabel(season - (seasons.length ? seasons.length - 1 : 0))} no hay registro: los jugadores generados empiezan la partida en su club.</p>
      </section>

      <section>
        <h3>Por temporada</h3>
        <Tabs<Grp> small value={grp} onChange={setGrp} options={[['basic', 'Básicas'], ['shoot', 'Tiro'], ['adv', 'Avanzadas']]} />
        {seasons.length === 0 && <p className="muted">Sin estadísticas todavía.</p>}
        {seasons.map(([s, rows]) => (
          <div key={s} className="scard">
            <div className="shead">
              <b>{seasonLabel(s)}</b>
              {[...new Map(rows.map((r) => [r.club_id, r])).values()].map((r) => (
                <span key={r.club_id} className="sclub"><span className="sw" style={{ background: color(r.club_colors) }} />{r.club}</span>
              ))}
            </div>
            {rows.sort((a, b) => a.competition_id - b.competition_id || (a.stage === 'playoffs' ? 1 : -1)).map((r) => (
              <div key={`${r.comp}-${r.stage}-${r.club_id}`} className="srow">
                <div className="sl">
                  <span className={`compbadge c${r.competition_id}`}>{r.comp}{r.stage === 'playoffs' ? ' PO' : ''}</span>
                  <span className="muted small">{r.line.gp} PJ · {mins(r.line.sec, r.line.gp)} min</span>
                </div>
                <div className="snums">
                  {GROUPS[grp].map((g) => <span key={g.label}><b>{g.get(r.line)}</b><small>{g.label}</small></span>)}
                </div>
                <div className="muted small ssub">{SUB[grp](r.line)}</div>
              </div>
            ))}
          </div>
        ))}
        <p className="muted small">Promedios por partido <Tag kind="sim" />. VAL = valoración; WS = victorias aportadas; VA = valor añadido.</p>
      </section>
    </>
  );
}
