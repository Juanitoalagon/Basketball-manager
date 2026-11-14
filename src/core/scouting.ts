/**
 * Informe del rival, quintetos con +/- y planes tácticos guardados (v0.9).
 *
 * Informe: su sistema de ataque y defensa, su ritmo, su jugador más peligroso (más puntos por partido, o más media
 * si aún no han jugado) y cuánto tiran de tres frente a la media de su liga. Consejos del ayudante, cada uno
 * con un botón para aplicarlo a tus tácticas:
 *  - Emparejamiento: tu mejor defensor exterior (0,7·defensa exterior + 0,3·agilidad) o interior
 *    (0,6·defensa interior + 0,4·tapón) sobre su peligro; con 15 o más puntos por partido, negarle el balón,
 *    y con 20 o más, 2 contra 1.
 *  - Prioridad: si tiran de tres 4 puntos más que la liga, salir a tiradores; 4 menos, cerrar la pintura.
 *  - Sistema defensivo: el que mejor suma encaje con tu plantilla y efecto contra su ataque (tabla VS).
 */
import { DEF_C, DEF_SYS, type DefFocus, type DefSystem, OFF_SYS, type OffSystem, type Tactics, VS, defFitOf, fitBonus } from './engine';
import { type Db, bumpRevision, transaction } from './schema';
import { getUniverse, loadTeam } from './season';
import { compOfClub, playerLines, tactics } from './queries';
import { archetype } from './archetype';
import type { Attrs, Pos } from './attributes';

export type Advice =
  | { kind: 'matchup'; attacker: number; defender: number; special: 'negar' | 'dos' | null }
  | { kind: 'focus'; focus: DefFocus }
  | { kind: 'system'; system: DefSystem };

export function scoutRival(db: Db, gameId: number) {
  const u = getUniverse(db)!;
  const g = db.rows<{ home_id: number; away_id: number; competition_id: number }>('SELECT home_id, away_id, competition_id FROM game WHERE id = ?', [gameId])[0];
  if (!g || !u.user_club_id) return null;
  const me = u.user_club_id;
  const opp = g.home_id === me ? g.away_id : g.home_id;
  const season = u.game_season;
  const oppT = tactics(db, opp);
  const comp = compOfClub(db, opp);
  const theirTeam = loadTeam(db, opp, season, g.competition_id);
  const myTeam = loadTeam(db, me, season, g.competition_id);
  // Su peligro.
  const lines = playerLines(db, season, comp, 'regular', opp);
  const ids = new Set(theirTeam.players.map((p) => p.id));
  const scorers = lines.filter((l) => ids.has(l.id) && l.gp >= 2).sort((a, b) => b.pts / b.gp - a.pts / a.gp);
  const byOvr = [...theirTeam.players].sort((a, b) => ovrOf(db, b.id, season) - ovrOf(db, a.id, season));
  const dangerId = scorers[0]?.id ?? byOvr[0]?.id;
  if (!dangerId) return null;
  const danger = theirTeam.players.find((p) => p.id === dangerId)!;
  const ppg = scorers[0] ? scorers[0].pts / scorers[0].gp : null;
  const name = (id: number) => db.rows<{ name: string }>('SELECT name FROM player WHERE id = ?', [id])[0]?.name ?? '';
  // Tiro de tres: su porcentaje de triples sobre el total de tiros frente a la liga.
  const share = (rows: { fga2: number; fga3: number }[]) => {
    const a = rows.reduce((s, r) => s + r.fga2 + r.fga3, 0);
    return a ? rows.reduce((s, r) => s + r.fga3, 0) / a : null;
  };
  const all = playerLines(db, season, comp, 'regular');
  const theirs = share(all.filter((l) => l.club_id === opp));
  const league = share(all);
  // Mi mejor defensor para su peligro (entre mis 8 de más media).
  const perimeter = ['PG', 'SG', 'SF'].includes(danger.pos1);
  const mine = [...myTeam.players].sort((a, b) => ovrOf(db, b.id, season) - ovrOf(db, a.id, season)).slice(0, 8);
  const score = (a: Attrs) => (perimeter ? 0.7 * a.perd + 0.3 * a.agi : 0.6 * a.intd + 0.4 * a.blk);
  const stopper = [...mine].sort((a, b) => score(b.attrs) - score(a.attrs))[0];
  const special: 'negar' | 'dos' | null = ppg === null ? null : ppg >= 20 ? 'dos' : ppg >= 15 ? 'negar' : null;
  const advice: { text: string; advice: Advice }[] = [];
  if (stopper) {
    advice.push({
      text: `Pon a ${name(stopper.id)} (${perimeter ? `defensa exterior ${stopper.attrs.perd}` : `defensa interior ${stopper.attrs.intd}`}) encima de ${name(danger.id)}${special === 'dos' ? ' y hazle 2 contra 1' : special === 'negar' ? ' y que le niegue el balón' : ''}.`,
      advice: { kind: 'matchup', attacker: danger.id, defender: stopper.id, special },
    });
  }
  if (theirs !== null && league !== null && Math.abs(theirs - league) >= 0.04) {
    const focus: DefFocus = theirs > league ? 'perimetro' : 'pintura';
    advice.push({
      text: focus === 'perimetro'
        ? `Tiran mucho de tres (${Math.round(theirs * 100)} % de sus tiros; la liga, ${Math.round(league * 100)} %): sal a los tiradores.`
        : `Apenas tiran de tres (${Math.round(theirs * 100)} %; la liga, ${Math.round(league * 100)} %): cierra la pintura.`,
      advice: { kind: 'focus', focus },
    });
  }
  // Sistema defensivo contra su ataque.
  const off = (oppT.offense ?? 'equilibrado') as OffSystem;
  const five = mine.slice(0, 5);
  const sysScore = (s: DefSystem) => {
    const vs = VS[off]?.[s];
    const make = vs?.make ? Object.values(vs.make).reduce((a, b) => a + (b ?? 0), 0) / 4 : 0;
    return fitBonus(defFitOf(five, s), DEF_C[s]) - make + (vs?.tov ?? 0) * 0.5;
  };
  const best = (Object.keys(DEF_SYS) as DefSystem[]).sort((a, b) => sysScore(b) - sysScore(a))[0]!;
  const cur = (tactics(db, me).defense?.system ?? 'individual') as DefSystem;
  if (best !== cur && sysScore(best) - sysScore(cur) > 0.01) {
    advice.push({ text: `Contra su ${OFF_SYS[off].label.toLowerCase()}, te conviene defender en ${DEF_SYS[best].label}.`, advice: { kind: 'system', system: best } });
  }
  return {
    opp, oppName: db.rows<{ name: string }>('SELECT name FROM club WHERE id = ?', [opp])[0]?.name ?? '',
    offense: OFF_SYS[off].label, defense: DEF_SYS[(oppT.defense?.system ?? 'individual') as DefSystem].label, pace: oppT.pace ?? 'normal',
    danger: { id: danger.id, name: name(danger.id), pos: danger.pos1, ppg, archetype: archetype(danger.attrs, danger.pos1 as Pos, danger.height_cm).label },
    three: theirs, leagueThree: league,
    advice,
  };
}

function ovrOf(db: Db, id: number, season: number): number {
  return db.rows<{ ovr: number }>('SELECT ovr FROM player_attributes WHERE player_id = ? AND season = ?', [id, season])[0]?.ovr ?? 0;
}

function saveTactics(db: Db, clubId: number, t: Tactics) {
  db.exec('INSERT OR REPLACE INTO tactics (club_id, data) VALUES (?,?)', [clubId, JSON.stringify(t)]);
}

/** Aplica un consejo a las tácticas guardadas del club. */
export function applyAdvice(db: Db, clubId: number, a: Advice): Tactics {
  return transaction(db, () => {
    const t = tactics(db, clubId);
    const d = { ...t.defense! };
    if (a.kind === 'matchup') {
      const m = { ...(d.matchups ?? {}) };
      for (const [k, v] of Object.entries(m)) if (v === a.defender) delete m[Number(k)];
      m[a.attacker] = a.defender;
      d.matchups = m;
      d.special = a.special ? { id: a.attacker, mode: a.special } : d.special ?? null;
    } else if (a.kind === 'focus') d.focus = a.focus;
    else d.system = a.system;
    const out = { ...t, defense: d };
    saveTactics(db, clubId, out);
    bumpRevision(db);
    return out;
  });
}

/* ───────────── Quintetos ───────────── */

export function lineupUnits(db: Db, clubId: number, season: number) {
  const rows = db.rows<{ five: string; sec: number; pf: number; pa: number; games: number }>('SELECT five, sec, pf, pa, games FROM lineup_unit WHERE season = ? AND club_id = ? AND sec >= 120 ORDER BY sec DESC LIMIT 40', [season, clubId]);
  const ids = [...new Set(rows.flatMap((r) => r.five.split(',').map(Number)))];
  const names = new Map(ids.length ? db.rows<{ id: number; name: string; pos1: string }>(`SELECT id, name, pos1 FROM player WHERE id IN (${ids.join(',')})`).map((p) => [p.id, p]) : []);
  return rows.map((r) => ({
    ...r,
    players: r.five.split(',').map(Number).map((id) => ({ id, name: names.get(id)?.name ?? '?', pos1: names.get(id)?.pos1 ?? '' })),
    /** +/- por cada 40 minutos que juegan juntos. */
    net40: ((r.pf - r.pa) * 2400) / r.sec,
  }));
}

/* ───────────── Planes tácticos guardados ───────────── */

export const PRESET_SLOTS = 3;
export function presets(db: Db, clubId: number) {
  return db.rows<{ slot: number; name: string; tactics: string }>('SELECT slot, name, tactics FROM tactic_preset WHERE club_id = ? ORDER BY slot', [clubId]).map((p) => ({ slot: p.slot, name: p.name, tactics: JSON.parse(p.tactics) as Tactics }));
}
/** Guarda las tácticas actuales (sin emparejamientos, que dependen del rival) con un nombre. */
export function savePreset(db: Db, clubId: number, slot: number, name: string, t: Tactics) {
  const clean: Tactics = { ...t, defense: { ...t.defense!, matchups: {}, special: null } };
  transaction(db, () => {
    db.exec('INSERT OR REPLACE INTO tactic_preset (club_id, slot, name, tactics) VALUES (?,?,?,?)', [clubId, Math.max(0, Math.min(PRESET_SLOTS - 1, slot)), name.trim().slice(0, 24) || `Plan ${slot + 1}`, JSON.stringify(clean)]);
    bumpRevision(db);
  });
  return presets(db, clubId);
}
export function deletePreset(db: Db, clubId: number, slot: number) {
  db.exec('DELETE FROM tactic_preset WHERE club_id = ? AND slot = ?', [clubId, slot]);
  return presets(db, clubId);
}
/** Aplica un plan guardado (conserva los emparejamientos y el marcaje especial actuales). */
export function applyPreset(db: Db, clubId: number, slot: number): Tactics | null {
  const p = presets(db, clubId).find((x) => x.slot === slot);
  if (!p) return null;
  const cur = tactics(db, clubId);
  const out: Tactics = { ...cur, ...p.tactics, defense: { ...cur.defense!, ...p.tactics.defense, matchups: cur.defense?.matchups ?? {}, special: cur.defense?.special ?? null } };
  transaction(db, () => {
    saveTactics(db, clubId, out);
    bumpRevision(db);
  });
  return out;
}
