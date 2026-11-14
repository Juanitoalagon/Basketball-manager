/** Previa de un partido: cómo llegan los dos equipos, sus mejores jugadores y cómo juegan. */
import { useState } from 'react';
import type * as Q from '../core/queries';
import type * as SC from '../core/scouting';
import type { Tactics } from '../core/engine';
import { call } from '../db/client';
import { Face } from './Face';
import { Loading, type Nav, f1, pc, shortName, useData } from './kit';

type PreviewData = NonNullable<ReturnType<typeof Q.preview>>;
type TeamP = PreviewData['home'];

const ROWS: { key: keyof NonNullable<TeamP['stats']>; lg?: keyof TeamP['league']; label: string; fmt: (x: number | null) => string; better: 'high' | 'low'; hint: string }[] = [
  { key: 'ppg', label: 'Puntos a favor', fmt: f1, better: 'high', hint: 'por partido' },
  { key: 'oppg', label: 'Puntos en contra', fmt: f1, better: 'low', hint: 'por partido' },
  { key: 'ortg', lg: 'ortg', label: 'Ataque (ORtg)', fmt: f1, better: 'high', hint: 'puntos por 100 posesiones' },
  { key: 'drtg', lg: 'drtg', label: 'Defensa (DRtg)', fmt: f1, better: 'low', hint: 'puntos recibidos por 100 posesiones' },
  { key: 'pace', lg: 'pace', label: 'Ritmo', fmt: f1, better: 'high', hint: 'posesiones por 40 min' },
  { key: 'threeRate', lg: 'threeRate', label: 'Triples / tiros', fmt: pc, better: 'high', hint: 'cuánto tiran de tres' },
  { key: 'efg', lg: 'efg', label: 'eFG%', fmt: pc, better: 'high', hint: 'acierto de campo ajustado' },
  { key: 'tov', lg: 'tov', label: 'Pérdidas', fmt: pc, better: 'low', hint: 'por posesión' },
  { key: 'orb', lg: 'orb', label: 'Rebote ofensivo', fmt: pc, better: 'high', hint: '% de sus fallos que recuperan' },
];

/** Una frase sobre el estilo de juego, sacada de sus números frente a la media de su liga. */
function style(t: TeamP): string[] {
  const s = t.stats;
  const l = t.league;
  if (!s) return ['Todavía no hay partidos para saber cómo juega.'];
  const out: string[] = [];
  if (s.threeRate !== null && l.threeRate !== null) {
    if (s.threeRate > l.threeRate * 1.12) out.push('Abusa del triple');
    else if (s.threeRate < l.threeRate * 0.88) out.push('Juega por dentro, tira pocos triples');
  }
  if (s.pace !== null && l.pace !== null) {
    if (s.pace > l.pace + 1.5) out.push('Juega rápido');
    else if (s.pace < l.pace - 1.5) out.push('Juega lento, en estático');
  }
  if (s.drtg !== null && l.drtg !== null && s.drtg < l.drtg - 3) out.push('Defensa muy sólida');
  if (s.ortg !== null && l.ortg !== null && s.ortg > l.ortg + 3) out.push('Ataque de los mejores');
  if (s.orb !== null && l.orb !== null && s.orb > l.orb + 0.03) out.push('Castiga el rebote ofensivo');
  if (s.tov !== null && l.tov !== null && s.tov > l.tov + 0.015) out.push('Pierde muchos balones');
  return out.length ? out : ['Equipo equilibrado, sin rasgos marcados'];
}

function TeamCard({ t, nav }: { t: TeamP; nav: Nav }) {
  return (
    <section>
      <h3 className="tap" onClick={() => nav.club(t.club.id)}>{t.club.name}</h3>
      <div className="muted small">
        {t.record ? `${t.record.w}-${t.record.l} · ${t.record.pos}º en ${t.compName}` : t.compName}
        {t.recent.length > 0 && <> · últimos: {t.recent.map((r, i) => <b key={i} className={r === 'G' ? 'good' : 'bad'}>{r}</b>)}</>}
      </div>
      <p className="small">{style(t).join(' · ')}.</p>
      <div className="oncourt three">
        {t.top.map((p) => (
          <div key={p.id} className="pc" onClick={() => nav.player(p.id)}>
            {p.origin !== 'real' ? <Face id={p.id} nationality={p.nationality} age={p.age} colors={t.club.colors} size={36} /> : <span className="face" style={{ width: 36, height: 54 }} />}
            <div className="n">{shortName(p.name)}</div>
            <div className="arch">{p.archetype}</div>
            <div className="muted">{p.pos1} · {p.ovr}</div>
            {p.pts !== null ? <div>{f1(p.pts)} p · {f1(p.reb)} r · {f1(p.ast)} a</div> : <div className="muted">sin partidos</div>}
            {p.injured && <div className="bad">Lesionado</div>}
          </div>
        ))}
      </div>
      <div className="small" style={{ marginTop: 6 }}>
        {t.leaders.pts && <div>Máximo anotador: <b className="tap" onClick={() => nav.player(t.leaders.pts!.id)}>{shortName(t.leaders.pts.name)}</b> ({f1(t.leaders.pts.value)})</div>}
        {t.leaders.reb && <div>Reboteador: <b className="tap" onClick={() => nav.player(t.leaders.reb!.id)}>{shortName(t.leaders.reb.name)}</b> ({f1(t.leaders.reb.value)})</div>}
        {t.leaders.ast && <div>Asistente: <b className="tap" onClick={() => nav.player(t.leaders.ast!.id)}>{shortName(t.leaders.ast.name)}</b> ({f1(t.leaders.ast.value)})</div>}
        {t.injured.length > 0 && <div className="bad">Bajas: {t.injured.map((x) => `${shortName(x.name)} (${x.games})`).join(', ')}</div>}
      </div>
    </section>
  );
}

type Report = NonNullable<ReturnType<typeof SC.scoutRival>>;
/** Informe del ayudante sobre el rival, con un botón para aplicar cada consejo a tus tácticas. */
export function RivalReport({ gameId, nav, onApplied }: { gameId: number; nav: Nav; onApplied?: (t: Tactics) => void }) {
  const { data } = useData<Report | null>('scoutRival', { gameId }, [gameId]);
  const [done, setDone] = useState<Set<number>>(new Set());
  if (!data) return null;
  const apply = async (i: number, advice: SC.Advice) => {
    const t = await call<Tactics>('applyAdvice', { advice });
    setDone(new Set([...done, i]));
    onApplied?.(t);
  };
  return (
    <section className="report">
      <h3>📋 Informe del ayudante: {data.oppName}</h3>
      <div className="kv small">
        <span>Ataque</span><b>{data.offense}</b>
        <span>Defensa</span><b>{data.defense}</b>
        <span>Ritmo</span><b>{data.pace === 'rapido' ? 'Rápido' : data.pace === 'lento' ? 'Lento' : 'Normal'}</b>
        <span>Triples</span><b>{data.three === null ? '—' : `${Math.round(data.three * 100)} % de sus tiros`}{data.leagueThree !== null && <span className="muted"> (liga {Math.round(data.leagueThree * 100)} %)</span>}</b>
      </div>
      <p className="tap" onClick={() => nav.player(data.danger.id)}>
        ⚠️ Su peligro: <b>{data.danger.name}</b> <span className="muted">{data.danger.pos} · {data.danger.archetype}{data.danger.ppg !== null ? ` · ${f1(data.danger.ppg)} puntos por partido` : ''}</span> ›
      </p>
      {data.advice.length === 0 && <p className="muted small">Nada que cambiar: tu plan ya encaja con este rival.</p>}
      <ul className="plain advice">
        {data.advice.map((a, i) => (
          <li key={i}>
            <span>{a.text}</span>
            <button className="sec" disabled={done.has(i)} onClick={() => void apply(i, a.advice)}>{done.has(i) ? '✓ Aplicado' : 'Aplicar'}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PreviewView({ gameId, nav, onApplied }: { gameId?: number; nav: Nav; onApplied?: (t: Tactics) => void }) {
  const { data, error } = useData<PreviewData | null>('preview', { gameId }, [gameId]);
  if (data === null) return error ? <Loading error={error} /> : <p className="muted">No hay partido próximo.</p>;
  if (!data) return <Loading error={error} />;
  const { home, away } = data;
  const better = (row: (typeof ROWS)[number], a: number | null, b: number | null) =>
    a === null || b === null || a === b ? 0 : (row.better === 'high' ? a > b : a < b) ? 1 : -1;
  return (
    <div className="preview">
      <section className="hero">
        <div className="muted small">{data.compName} · día {data.game.day}</div>
        <h2>{home.club.short} vs {away.club.short}</h2>
        {data.h2h.length > 0 && (
          <p className="small">Esta temporada: {data.h2h.map((h) => `${h.home_id === home.club.id ? home.club.short : away.club.short} ${h.home_pts}-${h.away_pts}`).join(' · ')}</p>
        )}
      </section>
      {data.userSide !== null && <RivalReport gameId={data.game.id} nav={nav} onApplied={onApplied} />}
      <section>
        <h3>Cara a cara</h3>
        <div className="tbl">
          <table>
            <thead><tr><th className="l">Estadística</th><th>{home.club.short}</th><th>{away.club.short}</th><th>Liga</th></tr></thead>
            <tbody>
              {ROWS.map((r) => {
                const a = home.stats?.[r.key] ?? null;
                const b = away.stats?.[r.key] ?? null;
                const w = better(r, a, b);
                return (
                  <tr key={r.key}>
                    <td className="l" title={r.hint}>{r.label}</td>
                    <td className={w > 0 ? 'good b' : ''}>{r.fmt(a)}</td>
                    <td className={w < 0 ? 'good b' : ''}>{r.fmt(b)}</td>
                    <td className="muted">{r.lg ? r.fmt(home.league[r.lg]) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Toda la temporada en su competición principal. En verde, quién está mejor en cada cosa.</p>
      </section>
      <TeamCard t={home} nav={nav} />
      <TeamCard t={away} nav={nav} />
    </div>
  );
}
