/**
 * Gestión del club a lo largo de la temporada:
 *  - rol esperado, minutos y moral;
 *  - química del equipo y cansancio acumulado;
 *  - objetivos de la directiva (sin despidos: suben o bajan el presupuesto);
 *  - tácticas de la IA;
 *  - entrenamiento individual;
 *  - cesiones.
 * Las fórmulas están en FORMULAS.md.
 */
import { ATTRS, ATTR_KEYS, type AttrKey, type Attrs, POSITIONS, type Pos, overallAt } from './attributes';
import { type ArchetypeKey, archetypeKeys } from './archetype';
import { DEFAULT_TACTICS, DEF_C, DEF_SYS, OFF_C, OFF_SYS, type DefSystem, type EnginePlayer, type OffSystem, type Pace, type Tactics, defFitOf, offFitOf } from './engine';
import { type Db, bumpRevision, transaction } from './schema';
import { COMP, getUniverse, standings } from './season';
import { addNews, payroll, type MarketResult } from './market';
import { cupoAllowsIn } from './world';
import { windowState } from './transfers';
import { leagueRoundPlayed } from './calendar';
import { Rng, mixSeed } from './rng';

/* ───────────── Rol, minutos y moral ───────────── */

export type RoleKey = 'estrella' | 'titular' | 'rotacion' | 'suplente' | 'reserva';
export const ROLE_INFO: Record<RoleKey, { label: string; min: number }> = {
  estrella: { label: 'Estrella', min: 30 },
  titular: { label: 'Titular', min: 25 },
  rotacion: { label: 'Rotación', min: 17 },
  suplente: { label: 'Suplente', min: 9 },
  reserva: { label: 'Reserva', min: 3 },
};
/** Rol que espera según su puesto en la plantilla (por media); los menores de 22 se conforman con uno menos. */
export function expectedRole(rank: number, age: number): RoleKey {
  const r: RoleKey = rank < 2 ? 'estrella' : rank < 5 ? 'titular' : rank < 8 ? 'rotacion' : rank < 10 ? 'suplente' : 'reserva';
  if (age > 21) return r;
  const order: RoleKey[] = ['estrella', 'titular', 'rotacion', 'suplente', 'reserva'];
  return order[Math.min(4, order.indexOf(r) + 1)]!;
}

/** Minutos medios de cada jugador en los últimos 5 partidos de su club. */
function recentMinutes(db: Db, clubId: number): Map<number, number> {
  const games = db.rows<{ id: number }>(
    "SELECT id FROM game WHERE (home_id = ? OR away_id = ?) AND status = 'jugado' ORDER BY season DESC, day DESC LIMIT 5",
    [clubId, clubId],
  ).map((g) => g.id);
  const out = new Map<number, number>();
  if (!games.length) return out;
  for (const r of db.rows<{ player_id: number; s: number }>(`SELECT player_id, SUM(sec) AS s FROM game_player_box WHERE club_id = ? AND game_id IN (${games.join(',')}) GROUP BY player_id`, [clubId])) {
    out.set(r.player_id, r.s / 60 / games.length);
  }
  return out;
}

/**
 * Moral tras cada partido: resultado, minutos frente a los que espera por su rol, sueldo frente a lo que
 * pediría hoy, intensidad del entrenamiento y química. Devuelve los jugadores del usuario que se han hundido.
 */
export function updateMorale(db: Db, clubId: number, won: boolean, intensityMorale: number, userClub: number | null) {
  const u = getUniverse(db)!;
  const roster = db.rows<{ id: number; name: string; morale: number; ovr: number; birth_year: number; salary: number | null }>(
    `SELECT p.id, p.name, p.morale, a.ovr, p.birth_year, c.salary FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     LEFT JOIN contract c ON c.player_id = p.id WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC`,
    [u.game_season, clubId],
  );
  const mins = recentMinutes(db, clubId);
  const chem = db.rows<{ chemistry: number }>('SELECT chemistry FROM club WHERE id = ?', [clubId])[0]?.chemistry ?? 50;
  roster.forEach((p, rank) => {
    const role = expectedRole(rank, u.game_season - p.birth_year);
    const exp = ROLE_INFO[role].min;
    const got = mins.get(p.id) ?? 0;
    const minPart = Math.max(-2.2, Math.min(1.2, (got - exp) / 5));
    const result = (won ? 2.5 : -2.5) * (rank < 8 ? 1 : 0.5);
    let m = p.morale + result + minPart + intensityMorale + (chem - 50) / 50;
    m += (68 - m) * 0.05; // vuelve poco a poco a lo normal
    m = Math.round(Math.max(0, Math.min(100, m)));
    const note = got < exp - 6
      ? `Quiere más minutos: juega ${got.toFixed(0)} y espera unos ${exp} como ${ROLE_INFO[role].label.toLowerCase()}`
      : got > exp + 8 && rank >= 8
        ? `Encantado: juega más de lo que esperaba (${got.toFixed(0)} min)`
        : m < 40 ? 'Desanimado por los resultados' : m >= 75 ? 'Contento con su papel' : 'Normal';
    db.exec('UPDATE player SET morale = ?, mood_note = ? WHERE id = ?', [m, note, p.id]);
    if (clubId === userClub && p.morale >= 40 && m < 40 && rank < 10) {
      addNews(db, 'moral', `${p.name} está descontento: ${note.charAt(0).toLowerCase()}${note.slice(1)}.`, clubId, p.id, { type: 'player', id: p.id });
    }
  });
}

/* ───────────── Cansancio acumulado ───────────── */

/** Tras un partido: cada minuto suma cansancio (30 minutos ≈ 0,22). */
export function addFatigue(db: Db, box: Map<number, number[]>) {
  for (const [id, b] of box) {
    const min = (b[0] ?? 0) / 60;
    if (min > 0) db.exec('UPDATE player SET fatigue = MIN(1, fatigue + ?) WHERE id = ?', [(min / 40) * 0.3, id]);
  }
}
/** Recuperación diaria: el cansancio se multiplica por 0,72 cada día que pasa. */
export function recoverFatigue(db: Db, days: number) {
  if (days <= 0) return;
  db.exec('UPDATE player SET fatigue = fatigue * ? WHERE fatigue > 0.005', [Math.pow(0.72, days)]);
}

/* ───────────── Química ───────────── */

/**
 * Química (0-100, 50 normal): continuidad del bloque (cuántos de los 8 mejores ya estaban la temporada
 * pasada), moral media y partidos jugados juntos esta temporada.
 */
export function updateChemistry(db: Db, season: number) {
  for (const c of db.rows<{ id: number }>('SELECT id FROM club')) {
    const top = db.rows<{ id: number; morale: number }>(
      `SELECT p.id, p.morale FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
       WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC LIMIT 8`,
      [season, c.id],
    );
    if (!top.length) continue;
    const ids = top.map((t) => t.id).join(',');
    const stayed = db.rows<{ n: number }>(`SELECT COUNT(DISTINCT player_id) AS n FROM player_season_stats WHERE season = ? AND club_id = ? AND player_id IN (${ids})`, [season - 1, c.id])[0]!.n;
    const gp = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE season = ? AND status = 'jugado' AND (home_id = ? OR away_id = ?)", [season, c.id, c.id])[0]!.n;
    const morale = top.reduce((a, t) => a + t.morale, 0) / top.length;
    const chem = 50 + 30 * (stayed / top.length - 0.5) + 0.35 * (morale - 65) + Math.min(10, gp / 3);
    db.exec('UPDATE club SET chemistry = ? WHERE id = ?', [Math.round(Math.max(15, Math.min(95, chem))), c.id]);
  }
}

/* ───────────── Tácticas de la IA ───────────── */

/** Mejor quinteto por puesto (el que pondría un entrenador). */
function bestFive(ps: EnginePlayer[]): EnginePlayer[] {
  const out: EnginePlayer[] = [];
  for (const pos of POSITIONS) {
    const b = ps.filter((p) => !out.includes(p)).sort((a, c) => overallAt(c.attrs, c, pos) - overallAt(a.attrs, a, pos))[0];
    if (b) out.push(b);
  }
  return out;
}
/** Encaje de una plantilla con cada sistema, ya centrado (positivo = le va bien). */
export function systemFits(ps: EnginePlayer[]) {
  const five = bestFive(ps);
  const off = (Object.keys(OFF_SYS) as OffSystem[]).map((k) => ({ key: k, fit: k === 'equilibrado' ? 0 : offFitOf(five, k) - OFF_C[k] }));
  const def = (Object.keys(DEF_SYS) as DefSystem[]).map((k) => ({ key: k, fit: defFitOf(five, k) - DEF_C[k] }));
  return { off, def };
}
/** La IA elige el sistema que mejor encaja con su plantilla (con un poco de personalidad del entrenador). */
export function aiTactics(players: EnginePlayer[], rng: Rng): Tactics {
  const f = systemFits(players);
  const pick = <T extends string>(xs: { key: T; fit: number }[]) => xs.map((x) => ({ ...x, s: x.fit + rng.next() * 3 })).sort((a, b) => b.s - a.s)[0]!.key;
  const offense = pick(f.off.map((x) => (x.key === 'equilibrado' ? { ...x, fit: 1 } : x)));
  const system = pick(f.def.map((x) => (x.key === 'individual' ? { ...x, fit: x.fit + 1 } : x)));
  const speed = players.slice(0, 8).reduce((a, p) => a + (p.attrs.spd + p.attrs.sta) / 2, 0) / Math.max(1, Math.min(8, players.length));
  const pace: Pace = offense === 'transicion' || speed > 66 ? 'rapido' : offense === 'poste' || speed < 50 ? 'lento' : 'normal';
  return { ...DEFAULT_TACTICS, offense, pace, defense: { ...DEFAULT_TACTICS.defense!, system } };
}

/* ───────────── Objetivos de la directiva ───────────── */

export const OBJECTIVE_LABEL: Record<string, string> = {
  titulo: 'Ganar un título (Liga o Copa)',
  playoffs: 'Entrar en los playoffs (top 8)',
  mitad: 'Acabar en la mitad alta (top 9 de 18)',
  salvacion: 'Evitar el descenso',
  ascenso: 'Ascender a la Liga ACB (1º)',
  meritorio: 'Acabar entre los 6 primeros',
};
/** Objetivo de cada club español según su presupuesto dentro de su liga. */
export function setObjectives(db: Db, season: number) {
  for (const comp of [COMP.ACB, COMP.FEB]) {
    const clubs = db.rows<{ id: number }>('SELECT id FROM club WHERE competition_id = ? ORDER BY budget DESC', [comp]);
    clubs.forEach((c, i) => {
      const kind = comp === COMP.ACB ? (i < 2 ? 'titulo' : i < 8 ? 'playoffs' : i < 13 ? 'mitad' : 'salvacion') : i < 3 ? 'ascenso' : i < 9 ? 'meritorio' : 'mitad';
      db.exec('INSERT OR IGNORE INTO objective (season, club_id, kind, target) VALUES (?,?,?,?)', [season, c.id, kind, OBJECTIVE_LABEL[kind]!]);
    });
  }
}
/**
 * Al acabar la temporada: superado (+12 % de presupuesto), cumplido (+5 %) o fallado (−8 %).
 * La confianza de la directiva sube o baja, pero nunca te despiden.
 */
export function evaluateObjectives(db: Db, season: number, userClub: number | null): string[] {
  const out: string[] = [];
  const acb = standings(db, season, COMP.ACB).map((r) => r.club_id);
  const feb = standings(db, season, COMP.FEB).map((r) => r.club_id);
  const champs = db.rows<{ competition_id: number; champion_id: number | null; runner_up_id: number | null }>('SELECT competition_id, champion_id, runner_up_id FROM season_result WHERE season = ?', [season]);
  const won = (id: number, comps: number[]) => champs.some((c) => comps.includes(c.competition_id) && c.champion_id === id);
  const final = (id: number) => champs.some((c) => c.competition_id === 1 && c.runner_up_id === id);
  const semis = new Set(db.rows<{ high_id: number; low_id: number }>('SELECT high_id, low_id FROM playoff_series WHERE season = ? AND competition_id = 1 AND round = 2', [season]).flatMap((s) => [s.high_id, s.low_id]));
  for (const o of db.rows<{ club_id: number; kind: string }>('SELECT club_id, kind FROM objective WHERE season = ? AND result IS NULL', [season])) {
    const posA = acb.indexOf(o.club_id) + 1;
    const posF = feb.indexOf(o.club_id) + 1;
    let res: 'superado' | 'cumplido' | 'fallado';
    switch (o.kind) {
      case 'titulo': res = won(o.club_id, [1]) && won(o.club_id, [3]) ? 'superado' : won(o.club_id, [1, 3, 4]) ? 'cumplido' : 'fallado'; break;
      case 'playoffs': res = semis.has(o.club_id) || final(o.club_id) || won(o.club_id, [1, 3]) ? 'superado' : posA > 0 && posA <= 8 ? 'cumplido' : 'fallado'; break;
      case 'mitad': res = (posA > 0 && posA <= 8) || (posF > 0 && posF <= 3) ? 'superado' : (posA > 0 && posA <= 9) || (posF > 0 && posF <= 9) ? 'cumplido' : 'fallado'; break;
      case 'salvacion': res = posA > 0 && posA <= 12 ? 'superado' : posA > 0 && posA < 18 ? 'cumplido' : 'fallado'; break;
      case 'ascenso': res = posF === 1 ? 'superado' : posF > 0 && posF <= 3 ? 'cumplido' : 'fallado'; break;
      default: res = posF > 0 && posF <= 3 ? 'superado' : posF > 0 && posF <= 6 ? 'cumplido' : 'fallado';
    }
    const delta = res === 'superado' ? 0.12 : res === 'cumplido' ? 0.05 : -0.08;
    db.exec('UPDATE objective SET result = ?, delta = ? WHERE season = ? AND club_id = ?', [res, delta, season, o.club_id]);
    db.exec('UPDATE club SET confidence = MAX(5, MIN(100, confidence + ?)) WHERE id = ?', [res === 'superado' ? 15 : res === 'cumplido' ? 6 : -15, o.club_id]);
    if (o.club_id === userClub) {
      const msg = res === 'superado'
        ? `La directiva está encantada: objetivo superado (${OBJECTIVE_LABEL[o.kind]}). Presupuesto +12 % la próxima temporada.`
        : res === 'cumplido'
          ? `Objetivo cumplido (${OBJECTIVE_LABEL[o.kind]}). La directiva sube el presupuesto un 5 %.`
          : `No se ha cumplido el objetivo (${OBJECTIVE_LABEL[o.kind]}). La directiva recorta el presupuesto un 8 %, pero confía en ti.`;
      addNews(db, 'directiva', msg, userClub, null, { type: 'club' });
      out.push(msg);
    }
  }
  return out;
}
export function objectiveDelta(db: Db, season: number, clubId: number): number {
  return db.rows<{ delta: number | null }>('SELECT delta FROM objective WHERE season = ? AND club_id = ?', [season, clubId])[0]?.delta ?? 0;
}
export function objectiveOf(db: Db, season: number, clubId: number) {
  return db.rows<{ kind: string; target: string; result: string | null; delta: number | null }>('SELECT kind, target, result, delta FROM objective WHERE season = ? AND club_id = ?', [season, clubId])[0] ?? null;
}

/* ───────────── Entrenamiento individual ───────────── */

export type IndividualPlan = `grupo:${'off' | 'def' | 'fis' | 'men'}` | `attr:${AttrKey}` | `arq:${ArchetypeKey}` | `pos:${Pos}`;
/** Plazas de entrenamiento individual: 2 + nivel de instalaciones. */
export const trainingSlots = (facilities: number) => 2 + facilities;

export function planAttrs(plan: string): AttrKey[] {
  const [kind, v] = plan.split(':') as [string, string];
  if (kind === 'attr') return [v as AttrKey];
  if (kind === 'grupo') return ATTRS.filter((a) => a.group === v).map((a) => a.key);
  if (kind === 'arq') return archetypeKeys(v as ArchetypeKey);
  if (kind === 'pos') return POS_KEYS[v as Pos] ?? [];
  return [];
}
const POS_KEYS: Record<Pos, AttrKey[]> = {
  PG: ['hdl', 'pas', 'vis', 'perd'], SG: ['sht3', 'offb', 'cre', 'perd'], SF: ['sht2', 'drive', 'perd', 'dreb'],
  PF: ['post', 'dreb', 'intd', 'str'], C: ['intd', 'blk', 'dreb', 'post'],
};
/**
 * Mejora extra del plan individual en la evolución de verano: se reparten «puntos» entre los atributos del plan.
 * Puntos = 7 (≤ 19 años), 6 (20-21), 4 (22-24), 2,5 (25-28) o 1 (29+), × intensidad × instalaciones.
 * Un solo atributo recibe los puntos × 0,7 (concentrado); un grupo, repartidos.
 */
export function individualBonus(a: Attrs, plan: string, age: number, k: number, rng: Rng): Attrs {
  const keys = planAttrs(plan);
  if (!keys.length) return a;
  const pts = (age <= 19 ? 7 : age <= 21 ? 6 : age <= 24 ? 4 : age <= 28 ? 2.5 : 1) * k * (keys.length === 1 ? 0.7 : 1);
  const out = { ...a };
  const each = pts / keys.length;
  for (const key of keys) out[key] = Math.min(99, out[key] + Math.floor(each) + (rng.next() < each - Math.floor(each) ? 1 : 0));
  return out;
}
export function setIndividualPlan(db: Db, playerId: number, clubId: number, plan: string | null): MarketResult {
  const p = db.rows<{ name: string; club_id: number | null; youth: number }>('SELECT name, club_id, youth FROM player WHERE id = ?', [playerId])[0];
  if (!p || (p.club_id !== clubId && p.youth !== clubId)) return { ok: false, message: 'Solo puedes entrenar a jugadores de tu club o de tu cantera.' };
  const u = getUniverse(db)!;
  if (plan === null) {
    db.exec('DELETE FROM player_training WHERE player_id = ?', [playerId]);
    return { ok: true, message: `${p.name} vuelve al entrenamiento del grupo.` };
  }
  if (!planAttrs(plan).length) return { ok: false, message: 'Plan no válido.' };
  const fac = db.rows<{ facilities: number }>('SELECT facilities FROM club WHERE id = ?', [clubId])[0]!.facilities;
  const used = db.rows<{ n: number }>(
    'SELECT COUNT(*) AS n FROM player_training t JOIN player p ON p.id = t.player_id WHERE (p.club_id = ? OR p.youth = ?) AND t.player_id <> ?',
    [clubId, clubId, playerId],
  )[0]!.n;
  if (used >= trainingSlots(fac)) return { ok: false, message: `Ya usas las ${trainingSlots(fac)} plazas de entrenamiento individual. Mejora las instalaciones para tener más.` };
  transaction(db, () => {
    db.exec('INSERT OR REPLACE INTO player_training (player_id, plan, since) VALUES (?,?,?)', [playerId, plan, u.game_season]);
    bumpRevision(db);
  });
  return { ok: true, message: `Plan individual de ${p.name} guardado. Se nota en la evolución de verano.` };
}
export function trainingOverview(db: Db, clubId: number) {
  const u = getUniverse(db)!;
  const fac = db.rows<{ facilities: number }>('SELECT facilities FROM club WHERE id = ?', [clubId])[0]!.facilities;
  const rows = db.rows<{ id: number; name: string; pos1: string; birth_year: number; youth: number; ovr: number; plan: string | null; nationality: string; origin: string }>(
    `SELECT p.id, p.name, p.pos1, p.birth_year, p.youth, a.ovr, t.plan, p.nationality, p.origin FROM player p
     JOIN player_attributes a ON a.player_id = p.id AND a.season = ? LEFT JOIN player_training t ON t.player_id = p.id
     WHERE (p.club_id = ? OR p.youth = ?) AND p.retired = 0 ORDER BY p.youth > 0, a.ovr DESC`,
    [u.game_season, clubId, clubId],
  );
  return { slots: trainingSlots(fac), used: rows.filter((r) => r.plan).length, players: rows.map((r) => ({ ...r, age: u.game_season - r.birth_year })) };
}

/* ───────────── Cesiones ───────────── */

function roster(db: Db, clubId: number, season: number) {
  return db.rows<{ id: number; ovr: number; pos1: string }>(
    'SELECT p.id, a.ovr, p.pos1 FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC',
    [season, clubId],
  );
}
/** Clubes españoles que aceptarían a tu jugador cedido, con el rol que tendría allí. */
export function loanOptions(db: Db, playerId: number) {
  const u = getUniverse(db)!;
  const p = db.rows<{ ovr: number; nationality: string; pos1: string; club_id: number | null }>('SELECT a.ovr, p.nationality, p.pos1, p.club_id FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.id = ?', [u.game_season, playerId])[0];
  if (!p) return [];
  const out: { club_id: number; name: string; comp: number; rank: number; role: RoleKey; minutes: number; share: number }[] = [];
  for (const c of db.rows<{ id: number; name: string; competition_id: number }>("SELECT id, name, competition_id FROM club WHERE country = 'ES' AND id <> ? ORDER BY competition_id, reputation DESC", [p.club_id])) {
    const r = roster(db, c.id, u.game_season);
    if (r.length >= 16 || cupoAllowsIn(db, c.id, p.nationality)) continue;
    const rank = r.filter((x) => x.ovr > p.ovr).length;
    if (rank > 9) continue; // allí no jugaría
    const role = expectedRole(rank, 25);
    out.push({ club_id: c.id, name: c.name, comp: c.competition_id, rank: rank + 1, role, minutes: ROLE_INFO[role].min, share: rank < 5 ? 1 : rank < 8 ? 0.75 : 0.5 });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 10);
}
export function loanOut(db: Db, playerId: number, toClub: number): MarketResult {
  const u = getUniverse(db)!;
  const w = windowState(db);
  if (!w.open) return { ok: false, message: `${w.label}. Las cesiones se hacen con el mercado abierto.` };
  const p = db.rows<{ name: string; club_id: number | null }>('SELECT name, club_id FROM player WHERE id = ?', [playerId])[0];
  if (!p || p.club_id !== u.user_club_id) return { ok: false, message: 'Solo puedes ceder a jugadores de tu plantilla.' };
  if (db.rows('SELECT 1 FROM loan WHERE player_id = ?', [playerId]).length) return { ok: false, message: 'Ya está cedido.' };
  if (roster(db, p.club_id!, u.game_season).length <= 10) return { ok: false, message: 'No puedes quedarte con menos de 10 jugadores.' };
  const opt = loanOptions(db, playerId).find((o) => o.club_id === toClub);
  if (!opt) return { ok: false, message: 'Ese club ya no lo quiere.' };
  const club = db.rows<{ name: string }>('SELECT name FROM club WHERE id = ?', [toClub])[0]!.name;
  transaction(db, () => {
    db.exec('INSERT INTO loan (player_id, owner_id, club_id, season, share, day) VALUES (?,?,?,?,?,?)', [playerId, p.club_id, toClub, u.game_season, opt.share, u.game_day]);
    db.exec('UPDATE player SET club_id = ? WHERE id = ?', [toClub, playerId]);
    db.exec('DELETE FROM lineup WHERE player_id = ?', [playerId]);
    db.exec('DELETE FROM player_tendency WHERE player_id = ?', [playerId]);
    addNews(db, 'cesion', `${p.name} se va cedido a ${club} hasta final de temporada (paga el ${Math.round(opt.share * 100)} % de su sueldo).`, u.user_club_id, playerId, { type: 'player', id: playerId });
    bumpRevision(db);
  });
  return { ok: true, message: `${p.name} se va cedido a ${club}. Allí sería ${ROLE_INFO[opt.role].label.toLowerCase()} (unos ${opt.minutes} minutos).` };
}
/** Pedir cedido a un jugador de otro club: lo deja si no está entre sus 8 mejores. Tú pagas la parte del sueldo que pidas. */
export function loanIn(db: Db, playerId: number, share: number): MarketResult {
  const u = getUniverse(db)!;
  const w = windowState(db);
  if (!w.open) return { ok: false, message: `${w.label}. Las cesiones se hacen con el mercado abierto.` };
  const p = db.rows<{ name: string; club_id: number | null; nationality: string; salary: number | null }>('SELECT p.name, p.club_id, p.nationality, c.salary FROM player p LEFT JOIN contract c ON c.player_id = p.id WHERE p.id = ?', [playerId])[0];
  if (!p || p.club_id === null || p.club_id === u.user_club_id) return { ok: false, message: 'No se puede pedir cedido.' };
  if (db.rows('SELECT 1 FROM loan WHERE player_id = ?', [playerId]).length) return { ok: false, message: 'Ya está cedido.' };
  const r = roster(db, p.club_id, u.game_season);
  const rank = r.findIndex((x) => x.id === playerId);
  if (rank >= 0 && rank < 8) return { ok: false, message: 'Su club no lo cede: cuenta con él en la rotación.' };
  if (r.length <= 11) return { ok: false, message: 'Su club no lo cede: se quedaría corto de jugadores.' };
  if (share < 0.5) return { ok: false, message: 'Su club pide que pagues al menos la mitad del sueldo.' };
  if (roster(db, u.user_club_id!, u.game_season).length >= 16) return { ok: false, message: 'Tu plantilla ya tiene 16 jugadores.' };
  const cupo = cupoAllowsIn(db, u.user_club_id!, p.nationality);
  if (cupo) return { ok: false, message: cupo };
  const budget = db.rows<{ budget: number }>('SELECT budget FROM club WHERE id = ?', [u.user_club_id])[0]!.budget;
  if (payroll(db, u.user_club_id!) + (p.salary ?? 0) * share > budget) return { ok: false, message: 'Su parte del sueldo no cabe en tu presupuesto.' };
  transaction(db, () => {
    db.exec('INSERT INTO loan (player_id, owner_id, club_id, season, share, day) VALUES (?,?,?,?,?,?)', [playerId, p.club_id, u.user_club_id, u.game_season, share, u.game_day]);
    db.exec('UPDATE player SET club_id = ? WHERE id = ?', [u.user_club_id, playerId]);
    db.exec('DELETE FROM lineup WHERE player_id = ?', [playerId]);
    addNews(db, 'cesion', `${p.name} llega cedido hasta final de temporada (pagas el ${Math.round(share * 100)} % de su sueldo).`, u.user_club_id, playerId, { type: 'player', id: playerId });
    bumpRevision(db);
  });
  return { ok: true, message: `${p.name} llega cedido hasta final de temporada.` };
}
/** Recuperar a un cedido (con el mercado abierto). */
export function recallLoan(db: Db, playerId: number): MarketResult {
  const u = getUniverse(db)!;
  const l = db.rows<{ owner_id: number; club_id: number; name: string }>('SELECT l.owner_id, l.club_id, p.name FROM loan l JOIN player p ON p.id = l.player_id WHERE l.player_id = ?', [playerId])[0];
  if (!l) return { ok: false, message: 'No está cedido.' };
  const w = windowState(db);
  if (!w.open) return { ok: false, message: `${w.label}. Solo se puede recuperar con el mercado abierto.` };
  if (l.owner_id !== u.user_club_id && l.club_id !== u.user_club_id) return { ok: false, message: 'No es cosa tuya.' };
  transaction(db, () => {
    db.exec('UPDATE player SET club_id = ? WHERE id = ?', [l.owner_id, playerId]);
    db.exec('DELETE FROM lineup WHERE player_id = ?', [playerId]);
    db.exec('DELETE FROM loan WHERE player_id = ?', [playerId]);
    addNews(db, 'cesion', `Termina la cesión de ${l.name}.`, u.user_club_id, playerId, { type: 'player', id: playerId });
    bumpRevision(db);
  });
  return { ok: true, message: `Termina la cesión de ${l.name}.` };
}
/** Al acabar la temporada, cada cedido vuelve a su club. */
export function endLoans(db: Db, userClub: number | null, events: string[]) {
  for (const l of db.rows<{ player_id: number; owner_id: number; club_id: number; name: string }>('SELECT l.player_id, l.owner_id, l.club_id, p.name FROM loan l JOIN player p ON p.id = l.player_id')) {
    db.exec('UPDATE player SET club_id = ? WHERE id = ? AND retired = 0', [l.owner_id, l.player_id]);
    db.exec('DELETE FROM lineup WHERE player_id = ?', [l.player_id]);
    if (l.owner_id === userClub) events.push(`${l.name} vuelve de su cesión.`);
  }
  db.exec('DELETE FROM loan');
}
export function loansOf(db: Db, clubId: number) {
  const u = getUniverse(db)!;
  return db.rows<{ player_id: number; name: string; owner_id: number; club_id: number; owner: string; club: string; share: number; gp: number | null; sec: number | null; pts: number | null }>(
    `SELECT l.player_id, p.name, l.owner_id, l.club_id, o.name AS owner, c.name AS club, l.share,
       (SELECT SUM(gp) FROM player_season_stats s WHERE s.player_id = l.player_id AND s.season = ? AND s.club_id = l.club_id) AS gp,
       (SELECT SUM(sec) FROM player_season_stats s WHERE s.player_id = l.player_id AND s.season = ? AND s.club_id = l.club_id) AS sec,
       (SELECT SUM(pts) FROM player_season_stats s WHERE s.player_id = l.player_id AND s.season = ? AND s.club_id = l.club_id) AS pts
     FROM loan l JOIN player p ON p.id = l.player_id JOIN club o ON o.id = l.owner_id JOIN club c ON c.id = l.club_id
     WHERE l.owner_id = ? OR l.club_id = ?`,
    [u.game_season, u.game_season, u.game_season, clubId, clubId],
  );
}

/* ───────────── Desarrollo por minutos ───────────── */

/**
 * Los menores de 24 que juegan mucho mejoran algo más; los que no juegan, se estancan.
 * ≥ 20 min por partido: +1 en 3 atributos clave de su puesto; < 6 min (con al menos 10 partidos posibles): −1 en 2.
 */
export function minutesDevelopment(a: Attrs, pos: Pos, age: number, mpg: number | null, rng: Rng): Attrs {
  if (age > 23 || mpg === null) return a;
  const out = { ...a };
  const keys = POS_KEYS[pos];
  if (mpg >= 20) for (const k of rng.shuffle([...keys]).slice(0, 3)) out[k] = Math.min(99, out[k] + 1);
  else if (mpg < 6) for (const k of rng.shuffle([...keys]).slice(0, 2)) out[k] = Math.max(1, out[k] - 1);
  return out;
}

/* ───────────── Informe semanal del ayudante ───────────── */

export function assistantReport(db: Db, clubId: number) {
  const u = getUniverse(db)!;
  const round = leagueRoundPlayed(db, u.game_season);
  if (round === 0 || round % 6 !== 0) return;
  if (db.rows("SELECT 1 FROM news WHERE kind = 'ayudante' AND season = ? AND text LIKE ?", [u.game_season, `Jornada ${round}:%`]).length) return;
  const tired = db.rows<{ name: string }>('SELECT name FROM player WHERE club_id = ? AND fatigue > 0.35 ORDER BY fatigue DESC LIMIT 3', [clubId]).map((r) => r.name);
  const sad = db.rows<{ name: string }>('SELECT name FROM player WHERE club_id = ? AND morale < 45 ORDER BY morale LIMIT 3', [clubId]).map((r) => r.name);
  const chem = db.rows<{ chemistry: number }>('SELECT chemistry FROM club WHERE id = ?', [clubId])[0]!.chemistry;
  const parts = [
    `química ${chem >= 65 ? 'muy buena' : chem >= 50 ? 'correcta' : 'mejorable'} (${Math.round(chem)})`,
    tired.length ? `cargados de minutos: ${tired.join(', ')}` : 'nadie arrastra cansancio',
    sad.length ? `descontentos: ${sad.join(', ')}` : 'el vestuario está tranquilo',
  ];
  addNews(db, 'ayudante', `Jornada ${round}: ${parts.join('; ')}.`, clubId, null, { type: 'club' });
}

void ATTR_KEYS;
void mixSeed;
