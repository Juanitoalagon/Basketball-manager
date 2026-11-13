/**
 * El mundo alrededor de la liga: Copa del Rey, competiciones europeas, clubes extranjeros, cupos,
 * cantera, ojeadores, entrenamiento, instalaciones y fichajes de la IA durante la temporada.
 *
 * Calendario de una temporada ("día" = semana):
 *  - Liga ACB y Primera FEB: jornadas 1 a 34 (día = jornada).
 *  - Competiciones europeas: dos grupos de 8 a doble vuelta en los días pares 2-28; cuartos el 30, semifinales el 32 y final el 33.
 *  - Copa del Rey: los 8 primeros de la ACB al acabar la jornada 17; cuartos el día 18, semifinales el 19 y final el 20.
 *  - Playoffs ACB: desde el día 35.
 */
import { ATTRS, type AttrKey, type Attrs, POSITIONS, generatePlayer, overall, type Pos } from './attributes';
import { generateRoster } from './generate';
import { CLUB_COLORS, COMP_INFO, CUPO_RULES, FOREIGN_CLUBS, type Cupo, cupoOf, makeName, pickNationality } from './names';
import { Rng, mixSeed } from './rng';
import { type Db, bumpRevision, transaction } from './schema';
import { COMP, getUniverse, insertPlayer, freeNumber, roundRobin, scheduleKnockout, standings, type StandingRow } from './season';
import { addNews, askSalary, payroll, type MarketResult } from './market';
import { aiMarketDay } from './transfers';

export const EURO = [4, 5, 6] as const;
const EUROLEAGUE_LICENSES = ['RMA', 'FCB', 'BAS', 'VBC'];

/* ───────────── Cupos ───────────── */

export function cupoCounts(db: Db, clubId: number): Record<Cupo, number> {
  const out: Record<Cupo, number> = { NAC: 0, COM: 0, EXT: 0 };
  for (const p of db.rows<{ nationality: string }>('SELECT nationality FROM player WHERE club_id = ? AND retired = 0', [clubId])) out[cupoOf(p.nationality)]++;
  return out;
}
export function isSpanishClub(db: Db, clubId: number): boolean {
  return db.rows<{ country: string }>('SELECT country FROM club WHERE id = ?', [clubId])[0]?.country === 'ES';
}
/** ¿Puede entrar este jugador sin romper los cupos? */
export function cupoAllowsIn(db: Db, clubId: number, nationality: string): string | null {
  if (!isSpanishClub(db, clubId)) return null;
  const c = cupoCounts(db, clubId);
  if (cupoOf(nationality) === 'EXT' && c.EXT >= CUPO_RULES.maxExt) return `Ya tienes ${CUPO_RULES.maxExt} extracomunitarios, el máximo permitido.`;
  return null;
}
/** ¿Puede salir este jugador sin quedarse por debajo del mínimo de nacionales? */
export function cupoAllowsOut(db: Db, clubId: number, nationality: string): string | null {
  if (!isSpanishClub(db, clubId)) return null;
  const c = cupoCounts(db, clubId);
  if (cupoOf(nationality) === 'NAC' && c.NAC <= CUPO_RULES.minNac) return `Necesitas al menos ${CUPO_RULES.minNac} jugadores nacionales.`;
  return null;
}
/** Ajusta una plantilla generada para que cumpla los cupos: cambia nacionalidad (y nombre) a los que sobran. */
export function fixRosterCupos<T extends { nationality: string; name: string }>(rng: Rng, roster: T[], used: Set<string>): void {
  let ext = 0;
  for (const p of roster) {
    if (cupoOf(p.nationality) === 'EXT') {
      ext++;
      if (ext > CUPO_RULES.maxExt) {
        used.delete(p.name);
        p.nationality = rng.chance(0.5) ? 'ES' : rng.pick(['FR', 'LT', 'IT', 'SN']);
        p.name = makeName(rng, p.nationality, used);
      }
    }
  }
  let nac = roster.filter((p) => p.nationality === 'ES').length;
  for (const p of [...roster].reverse()) {
    if (nac >= CUPO_RULES.minNac + 1) break;
    if (p.nationality !== 'ES') {
      used.delete(p.name);
      p.nationality = 'ES';
      p.name = makeName(rng, 'ES', used);
      nac++;
    }
  }
}

/* ───────────── Clubes extranjeros, competiciones y colores ───────────── */

/**
 * Prepara lo que falte del mundo (también en partidas de versiones anteriores): competiciones nuevas,
 * colores, instalaciones, ojeadores, clubes extranjeros con plantilla y cantera. Sin transacción propia.
 */
export function setupWorld(db: Db): void {
  const u = getUniverse(db);
  if (!u) return;
  for (const [id, c] of Object.entries(COMP_INFO)) {
    db.exec('INSERT OR IGNORE INTO competition (id, name, short, kind, country, tier) VALUES (?,?,?,?,?,?)', [Number(id), c.name, c.short, c.kind, Number(id) <= 3 ? 'ES' : null, null]);
  }
  for (const c of db.rows<{ id: number; short: string; reputation: number; colors: string | null }>('SELECT id, short, reputation, colors FROM club')) {
    if (!c.colors) db.exec('UPDATE club SET colors = ? WHERE id = ?', [JSON.stringify(CLUB_COLORS[c.short] ?? ['#444444', '#ffffff', '#999999']), c.id]);
  }
  db.exec("UPDATE club SET facilities = MAX(1, MIN(5, CAST(reputation / 20 AS INTEGER))), scouting = MAX(1, MIN(4, CAST(reputation / 30 AS INTEGER))) WHERE training IS NULL");
  db.exec(`UPDATE club SET training = '{"focus":"equilibrado","intensity":"normal"}' WHERE training IS NULL`);
  const foreign = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM club WHERE country <> 'ES'")[0]!.n;
  if (!foreign) {
    const rng = new Rng(mixSeed(u.seed, 777));
    const used = new Set(db.rows<{ name: string }>('SELECT name FROM player').map((p) => p.name));
    let id = Number(db.rows<{ m: number }>('SELECT MAX(id) AS m FROM club')[0]!.m);
    for (const f of FOREIGN_CLUBS) {
      id++;
      db.exec('INSERT INTO club (id, name, short, city, country, reputation, budget, competition_id, cash, colors, facilities, scouting, training) VALUES (?,?,?,?,?,?,?,NULL,0,?,?,?,?)', [
        id, f.name, f.short, f.city, f.country, Math.round(60 + f.strength * 6), 0, JSON.stringify(f.colors), Math.max(2, Math.min(5, 3 + Math.round(f.strength / 2))), 3, '{"focus":"equilibrado","intensity":"normal"}',
      ]);
      const nums = new Set<number>();
      const roster = generateRoster(rng, { tier: 1, season: u.game_season, strength: f.strength, used });
      // Mitad de la plantilla del país del club; el resto, internacional.
      for (const p of roster) {
        if (rng.chance(0.5)) {
          used.delete(p.name);
          p.nationality = f.country;
          p.name = makeName(rng, f.country, used);
        }
      }
      for (const p of roster) insertPlayer(db, p, id, freeNumber(rng, nums), u.game_season);
    }
  }
  // Cantera inicial de los clubes españoles.
  if (!db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE youth > 0')[0]!.n) {
    const rng = new Rng(mixSeed(u.seed, 991));
    for (const c of db.rows<{ id: number; scouting: number; competition_id: number }>("SELECT id, scouting, competition_id FROM club WHERE country = 'ES'")) {
      for (let k = 0; k < 3; k++) addYouth(db, rng, c.id, c.competition_id ?? 2, c.scouting, u.game_season);
    }
  }
}

/** Equipos de cada competición europea: licencias fijas en la EuroLeague y el resto según la última clasificación de la ACB. */
function euroMembers(db: Db, season: number): Record<number, number[]> {
  const prev = standings(db, season - 1, COMP.ACB).map((r) => r.club_id);
  const acb = db.rows<{ id: number; short: string; reputation: number }>('SELECT id, short, reputation FROM club WHERE competition_id = 1 ORDER BY reputation DESC');
  const order = [...acb].sort((a, b) => {
    const ia = prev.indexOf(a.id);
    const ib = prev.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.reputation - a.reputation;
  });
  const el = acb.filter((c) => EUROLEAGUE_LICENSES.includes(c.short)).map((c) => c.id);
  // Si los nombres cortos no coinciden (universo importado), las licencias van a los de más reputación.
  for (const c of acb) if (el.length < 4 && !el.includes(c.id)) el.push(c.id);
  const rest = order.filter((c) => !el.includes(c.id)).map((c) => c.id);
  const out: Record<number, number[]> = { 4: el, 5: rest.slice(0, 4), 6: rest.slice(4, 8) };
  for (const f of db.rows<{ id: number; short: string }>("SELECT id, short FROM club WHERE country <> 'ES'")) {
    const def = FOREIGN_CLUBS.find((x) => x.short === f.short);
    if (def) out[def.comp]!.push(f.id);
  }
  return out;
}

/** Grupos y calendario de las tres competiciones europeas (días pares 2-28). */
export function scheduleEurope(db: Db, season: number, seed: number): void {
  if (db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM comp_group WHERE season = ?', [season])[0]!.n) return;
  const rng = new Rng(mixSeed(seed, season * 13 + 5));
  const members = euroMembers(db, season);
  for (const comp of EURO) {
    const teams = rng.shuffle([...members[comp]!]).slice(0, 16);
    if (teams.length < 16) continue;
    // Bombos: los dos grupos con nivel parecido.
    teams.sort((a, b) => clubLevel(db, b, season) - clubLevel(db, a, season));
    const groups: Record<string, number[]> = { A: [], B: [] };
    teams.forEach((t, i) => groups[i % 4 === 0 || i % 4 === 3 ? 'A' : 'B']!.push(t));
    for (const [g, ids] of Object.entries(groups)) {
      for (const id of ids) db.exec('INSERT INTO comp_group VALUES (?,?,?,?)', [season, comp, id, g]);
      for (const [d, h, a] of roundRobin(ids, rng)) {
        db.exec("INSERT INTO game (season, competition_id, stage, day, home_id, away_id, seed, status) VALUES (?,?, 'grupos', ?,?,?,?, 'pendiente')", [season, comp, d * 2, h, a, rng.int(1, 2 ** 31 - 1)]);
      }
    }
  }
}

function clubLevel(db: Db, clubId: number, season: number): number {
  return Number(db.rows<{ l: number | null }>(
    `SELECT AVG(ovr) AS l FROM (SELECT a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC LIMIT 8)`,
    [season, clubId],
  )[0]?.l ?? 50);
}

export function groupStandings(db: Db, season: number, comp: number, grp: string): StandingRow[] {
  return db.rows<StandingRow>(
    `SELECT c.id AS club_id, c.name, c.short,
       COUNT(g.id) AS gp,
       COALESCE(SUM(CASE WHEN (g.home_id = c.id AND g.home_pts > g.away_pts) OR (g.away_id = c.id AND g.away_pts > g.home_pts) THEN 1 ELSE 0 END), 0) AS w,
       COALESCE(SUM(CASE WHEN (g.home_id = c.id AND g.home_pts < g.away_pts) OR (g.away_id = c.id AND g.away_pts < g.home_pts) THEN 1 ELSE 0 END), 0) AS l,
       COALESCE(SUM(CASE WHEN g.home_id = c.id THEN g.home_pts ELSE g.away_pts END), 0) AS pf,
       COALESCE(SUM(CASE WHEN g.home_id = c.id THEN g.away_pts ELSE g.home_pts END), 0) AS pa
     FROM comp_group k JOIN club c ON c.id = k.club_id
     LEFT JOIN game g ON g.season = k.season AND g.competition_id = k.competition_id AND g.stage = 'grupos' AND g.status = 'jugado' AND (g.home_id = c.id OR g.away_id = c.id)
     WHERE k.season = ? AND k.competition_id = ? AND k.grp = ?
     GROUP BY c.id ORDER BY w DESC, (pf - pa) DESC, pf DESC`,
    [season, comp, grp],
  );
}

function createSeries(db: Db, season: number, comp: number, pairs: [StandingRow, number, StandingRow, number][]) {
  pairs.forEach(([hi, hs, lo, ls], slot) => {
    db.exec('INSERT INTO playoff_series (season, competition_id, round, slot, high_id, low_id, high_seed, low_seed, best_of) VALUES (?,?,1,?,?,?,?,?,1)', [season, comp, slot, hi.club_id, lo.club_id, hs, ls]);
  });
}

/**
 * Lo que pasa después de jugar un día: Copa tras la jornada 17, cruces europeos tras la fase de grupos,
 * avance de eliminatorias, fichajes de urgencia de la IA. Devuelve noticias para el resumen.
 */
export function afterDay(db: Db, season: number, day: number, seed: number, stagesPlayed: Set<string>, compsPlayed: Set<number>): string[] {
  const ev: string[] = [];
  const has = (comp: number) => db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM playoff_series WHERE season = ? AND competition_id = ?', [season, comp])[0]!.n > 0;
  // Copa del Rey: los 8 primeros al acabar la primera vuelta.
  if (day === 17 && !has(3) && db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE season = ? AND competition_id = 1 AND stage = 'regular' AND day <= 17 AND status = 'pendiente'", [season])[0]!.n === 0) {
    const t = standings(db, season, COMP.ACB);
    if (t.length >= 8) {
      createSeries(db, season, 3, [[t[0]!, 1, t[7]!, 8], [t[3]!, 4, t[4]!, 5], [t[1]!, 2, t[6]!, 7], [t[2]!, 3, t[5]!, 6]]);
      scheduleKnockout(db, season, 3, 18, seed);
      ev.push(`Copa del Rey: ${t.slice(0, 8).map((r) => r.short).join(', ')} se clasifican para los cuartos (día 18).`);
    }
  }
  if (stagesPlayed.has('copa')) ev.push(...scheduleKnockout(db, season, 3, day + 1, seed, day).events);
  // Europa: cruces al acabar los grupos.
  for (const comp of EURO) {
    const groupsDone = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE season = ? AND competition_id = ? AND stage = 'grupos' AND status = 'pendiente'", [season, comp])[0]!.n === 0;
    const anyGroup = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE season = ? AND competition_id = ? AND stage = 'grupos'", [season, comp])[0]!.n > 0;
    if (compsPlayed.has(comp) && anyGroup && groupsDone && !has(comp)) {
      const A = groupStandings(db, season, comp, 'A');
      const B = groupStandings(db, season, comp, 'B');
      createSeries(db, season, comp, [[A[0]!, 1, B[3]!, 8], [B[1]!, 4, A[2]!, 5], [B[0]!, 2, A[3]!, 7], [A[1]!, 3, B[2]!, 6]]);
      scheduleKnockout(db, season, comp, Math.max(30, day + 2), seed);
      ev.push(`${COMP_INFO[comp]!.name}: se cierra la fase de grupos.`);
    } else if (compsPlayed.has(comp) && has(comp)) {
      ev.push(...scheduleKnockout(db, season, comp, day < 32 ? day + 2 : day + 1, seed, day).events);
    }
  }
  if (day % 4 === 0) aiInSeason(db, season, mixSeed(seed, day * 101));
  // Paciencia nueva a mitad de temporada (tras la primera vuelta).
  if (day === 17) db.exec('DELETE FROM negotiation WHERE season = ?', [season]);
  ev.push(...aiMarketDay(db, seed));
  return ev;
}

/* ───────────── IA durante la temporada ───────────── */

function freeAgentsByOvr(db: Db, season: number) {
  return db.rows<{ id: number; name: string; ovr: number; birth_year: number; potential_est: number; morale: number; nationality: string; pos1: Pos; pos2: Pos | null }>(
    `SELECT p.id, p.name, a.ovr, p.birth_year, p.potential_est, p.morale, p.nationality, p.pos1, p.pos2 FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     WHERE p.club_id IS NULL AND p.retired = 0 AND p.youth = 0 ORDER BY a.ovr DESC`,
    [season],
  );
}

/** Fichajes de urgencia: un club con menos de 10 jugadores sanos ficha al mejor agente libre que pueda pagar y le quepa en el cupo. */
export function aiSignFreeAgent(db: Db, clubId: number, season: number, until: number, rng: Rng): string | null {
  const c = db.rows<{ name: string; budget: number }>('SELECT name, budget FROM club WHERE id = ?', [clubId])[0]!;
  const room = c.budget - payroll(db, clubId);
  const needs = positionNeeds(db, clubId);
  const ok = (f: ReturnType<typeof freeAgentsByOvr>[number]) =>
    askSalary({ ovr: f.ovr, age: season - f.birth_year, potential_est: f.potential_est, morale: f.morale }) <= Math.max(room, 60_000) && !cupoAllowsIn(db, clubId, f.nationality);
  const fas = freeAgentsByOvr(db, season);
  // Primero, alguien del puesto que falta.
  const fa = (needs.length ? fas.find((f) => ok(f) && needs.includes(f.pos1)) : undefined) ?? fas.find(ok);
  if (!fa) return null;
  const ask = askSalary({ ovr: fa.ovr, age: season - fa.birth_year, potential_est: fa.potential_est, morale: fa.morale });
  const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND number IS NOT NULL', [clubId]).map((x) => x.number));
  db.exec('UPDATE player SET club_id = ?, number = ? WHERE id = ?', [clubId, freeNumber(rng, nums), fa.id]);
  db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until) VALUES (?,?,?,?)', [fa.id, clubId, Math.min(ask, Math.max(room, 60_000)), until]);
  db.exec('INSERT INTO transfer (season, day, player_id, from_club, to_club, fee, salary, until, kind) VALUES (?, (SELECT game_day FROM universe), ?, NULL, ?, 0, ?, ?, ?)', [season, fa.id, clubId, ask, until, 'libre']);
  return `${c.name} ficha a ${fa.name} (agente libre).`;
}

export function aiInSeason(db: Db, season: number, seed: number) {
  const u = getUniverse(db)!;
  const rng = new Rng(seed);
  for (const c of db.rows<{ id: number }>('SELECT id FROM club WHERE id IS NOT ?', [u.user_club_id])) {
    const healthy = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0 AND injury_games = 0', [c.id])[0]!.n;
    const total = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [c.id])[0]!.n;
    if ((healthy < 10 || positionNeeds(db, c.id).length > 0) && total < 16) {
      const msg = aiSignFreeAgent(db, c.id, season, season, rng);
      if (msg) addNews(db, 'fichaje', msg, c.id);
    }
  }
}

/** Puestos con menos de dos jugadores en plantilla (por posición principal; los lesionados cuentan). */
export function positionNeeds(db: Db, clubId: number): Pos[] {
  const n: Record<string, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const r of db.rows<{ pos1: string }>('SELECT pos1 FROM player WHERE club_id = ? AND retired = 0', [clubId])) n[r.pos1] = (n[r.pos1] ?? 0) + 1;
  return POSITIONS.filter((p) => n[p]! < 2);
}

/** En pretemporada: cada club de la IA cubre los puestos que le faltan (hasta 16 jugadores). */
export function aiFillNeeds(db: Db, season: number, userClub: number | null, rng: Rng, events: string[]) {
  for (const c of db.rows<{ id: number }>('SELECT id FROM club WHERE id IS NOT ?', [userClub])) {
    for (let k = 0; k < 3 && positionNeeds(db, c.id).length; k++) {
      if (db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [c.id])[0]!.n >= 16) break;
      const msg = aiSignFreeAgent(db, c.id, season, season + 1, rng);
      if (!msg) break;
      addNews(db, 'fichaje', msg, c.id);
    }
  }
  void events;
}

/* ───────────── Cantera y ojeadores ───────────── */

/** Ruido del potencial estimado según el nivel de los ojeadores (1-5): de ±8 a ±2 puntos. */
export const scoutNoise = (level: number) => 9.5 - level * 1.5;

export function addYouth(db: Db, rng: Rng, clubId: number, tier: number, scouting: number, season: number): number {
  const used = new Set<string>();
  const nat = rng.chance(0.85) ? 'ES' : pickNationality(rng);
  const age = rng.int(16, 17);
  const p = generatePlayer(rng, { pos: rng.pick(POSITIONS), quality: (tier === 1 ? 40 : 36) + rng.next() * 8, age, season, nationality: nat, name: makeName(rng, nat, used) });
  // Las joyas existen: un 8 % con un potencial muy alto.
  p.potential = Math.min(90, p.ovr + 14 + rng.int(0, 18) + (rng.chance(0.08) ? 10 : 0));
  p.potentialEst = Math.max(p.ovr, Math.round(p.potential + (rng.next() + rng.next() - 1) * scoutNoise(scouting)));
  const id = insertPlayer(db, p, null, null, season);
  db.exec('UPDATE player SET youth = ? WHERE id = ?', [clubId, id]);
  return id;
}

export function promoteYouth(db: Db, playerId: number, clubId: number): MarketResult {
  const p = db.rows<{ name: string; youth: number; nationality: string }>('SELECT name, youth, nationality FROM player WHERE id = ?', [playerId])[0];
  if (!p || p.youth !== clubId) return { ok: false, message: 'No es de tu cantera.' };
  const n = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [clubId])[0]!.n;
  if (n >= 16) return { ok: false, message: 'Tu plantilla ya tiene 16 jugadores.' };
  const cupo = cupoAllowsIn(db, clubId, p.nationality);
  if (cupo) return { ok: false, message: cupo };
  const u = getUniverse(db)!;
  transaction(db, () => {
    const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND number IS NOT NULL', [clubId]).map((x) => x.number));
    db.exec('UPDATE player SET youth = 0, club_id = ?, number = ?, morale = 80 WHERE id = ?', [clubId, freeNumber(new Rng(playerId), nums), playerId]);
    db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until) VALUES (?,?,?,?)', [playerId, clubId, 30_000, u.game_season + 3]);
    addNews(db, 'cantera', `${p.name} sube de la cantera al primer equipo.`, clubId, playerId);
    bumpRevision(db);
  });
  return { ok: true, message: `${p.name} sube al primer equipo con un contrato de formación de 4 temporadas.` };
}

export function releaseYouth(db: Db, playerId: number, clubId: number): MarketResult {
  const p = db.rows<{ name: string; youth: number }>('SELECT name, youth FROM player WHERE id = ?', [playerId])[0];
  if (!p || p.youth !== clubId) return { ok: false, message: 'No es de tu cantera.' };
  transaction(db, () => {
    db.exec('UPDATE player SET youth = 0 WHERE id = ?', [playerId]);
    bumpRevision(db);
  });
  return { ok: true, message: `${p.name} deja la cantera y queda libre.` };
}

/** En cada pretemporada: nuevos juveniles y decisión sobre los que cumplen 19. */
export function youthOffseason(db: Db, season: number, userClub: number | null, rng: Rng, events: string[]) {
  for (const c of db.rows<{ id: number; scouting: number; competition_id: number | null }>("SELECT id, scouting, competition_id FROM club WHERE country = 'ES'")) {
    for (let k = 0; k < (c.id === userClub ? 3 : 2); k++) addYouth(db, rng, c.id, c.competition_id ?? 2, c.scouting, season);
    for (const y of db.rows<{ id: number; name: string; birth_year: number; potential_est: number }>('SELECT id, name, birth_year, potential_est FROM player WHERE youth = ? AND retired = 0', [c.id])) {
      if (season - y.birth_year < 19) continue;
      if (c.id === userClub) {
        db.exec('UPDATE player SET youth = 0 WHERE id = ?', [y.id]);
        events.push(`${y.name} cumple 19 años sin subir al primer equipo y deja tu cantera.`);
      } else if (y.potential_est >= 60 && db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [c.id])[0]!.n < 15) {
        db.exec('UPDATE player SET youth = 0, club_id = ? WHERE id = ?', [c.id, y.id]);
        db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until) VALUES (?,?,?,?)', [y.id, c.id, 30_000, season + 2]);
      } else db.exec('UPDATE player SET youth = 0 WHERE id = ?', [y.id]);
    }
  }
}

/** Mejorar instalaciones (más desarrollo) u ojeadores (mejor estimación del potencial). */
export function upgradeClub(db: Db, clubId: number, what: 'facilities' | 'scouting'): MarketResult {
  const c = db.rows<{ cash: number; facilities: number; scouting: number }>('SELECT cash, facilities, scouting FROM club WHERE id = ?', [clubId])[0]!;
  const level = what === 'facilities' ? c.facilities : c.scouting;
  if (level >= 5) return { ok: false, message: 'Ya está al máximo nivel.' };
  const cost = upgradeCost(what, level);
  if (c.cash < cost) return { ok: false, message: `Hace falta ${Math.round(cost / 1000)} mil € de caja.` };
  transaction(db, () => {
    db.exec(`UPDATE club SET cash = cash - ?, ${what} = ${what} + 1 WHERE id = ?`, [cost, clubId]);
    bumpRevision(db);
  });
  return { ok: true, message: what === 'facilities' ? `Instalaciones mejoradas al nivel ${level + 1}.` : `Ojeadores mejorados al nivel ${level + 1}.` };
}
export const upgradeCost = (what: 'facilities' | 'scouting', level: number) => (what === 'facilities' ? 500_000 : 150_000) * level;

/* ───────────── Entrenamiento ───────────── */

export type Focus = 'equilibrado' | 'tiro' | 'creacion' | 'interior' | 'defensa' | 'fisico';
export type Intensity = 'suave' | 'normal' | 'duro';
export interface Training { focus: Focus; intensity: Intensity }
export const FOCUS_ATTRS: Record<Focus, AttrKey[]> = {
  equilibrado: [],
  tiro: ['sht2', 'sht3', 'ft', 'offb'],
  creacion: ['drive', 'hdl', 'vis', 'pas', 'cre'],
  interior: ['fin', 'post', 'oreb', 'dreb', 'str'],
  defensa: ['perd', 'intd', 'hlpd', 'ant', 'stl', 'blk', 'pnr', 'intim'],
  fisico: ['str', 'spd', 'agi', 'jmp', 'sta'],
};
export const INTENSITY = { suave: { dev: 0.7, injury: 0.8, morale: 0.2 }, normal: { dev: 1, injury: 1, morale: 0 }, duro: { dev: 1.4, injury: 1.3, morale: -0.4 } } as const;

export function getTraining(db: Db, clubId: number | null): Training {
  if (!clubId) return { focus: 'equilibrado', intensity: 'normal' };
  const t = db.rows<{ training: string | null }>('SELECT training FROM club WHERE id = ?', [clubId])[0]?.training;
  return t ? (JSON.parse(t) as Training) : { focus: 'equilibrado', intensity: 'normal' };
}
export function setTraining(db: Db, clubId: number, t: Training) {
  transaction(db, () => {
    db.exec('UPDATE club SET training = ? WHERE id = ?', [JSON.stringify(t), clubId]);
    bumpRevision(db);
  });
}

/**
 * Efecto del entrenamiento y las instalaciones en la evolución anual:
 *  - con foco: +1,5 (≤ 24 años), +0,8 (25-29) o +0,3 (30+) en los atributos del foco;
 *  - equilibrado: +0,4 en todos los ofensivos, defensivos y físicos;
 *  - todo × intensidad (0,7 / 1 / 1,4) × (1 + 0,15 · (instalaciones − 3)).
 */
export function trainingBonus(a: Attrs, age: number, t: Training, facilities: number, rng: Rng): Attrs {
  const base = age <= 24 ? 1.5 : age <= 29 ? 0.8 : 0.3;
  const k = INTENSITY[t.intensity].dev * (1 + 0.15 * (facilities - 3));
  const out = { ...a };
  const keys = t.focus === 'equilibrado' ? ATTRS.filter((x) => x.group !== 'men').map((x) => x.key) : FOCUS_ATTRS[t.focus];
  const amount = t.focus === 'equilibrado' ? 0.4 * (base / 1.5) * k : base * k;
  // Redondeo al azar para que 0,4 puntos no se pierdan: 40 % de probabilidad de +1.
  for (const key of keys) out[key] = Math.max(1, Math.min(99, out[key] + Math.floor(amount) + (rng.next() < amount - Math.floor(amount) ? 1 : 0)));
  return out;
}
export function ovrOf(a: Attrs, pos: Pos, height: number) {
  return overall(a, pos, height);
}
