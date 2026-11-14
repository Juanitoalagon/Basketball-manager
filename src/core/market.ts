/**
 * Mercado, contratos y economía.
 *
 * Cada club tiene:
 *  - presupuesto salarial (club.budget): lo máximo que puede pagar en sueldos por temporada;
 *  - caja (club.cash): dinero para traspasos e indemnizaciones.
 * Sueldo pedido y valor de mercado dependen de media, edad, potencial y moral (fórmulas en FORMULAS.md).
 * Las decisiones de la IA son deterministas a partir de la semilla del universo.
 */
import { generatePlayer, POSITIONS } from './attributes';
import { makeName, pickNationality } from './names';
import { Rng, mixSeed } from './rng';
import { type Db, bumpRevision, getSetting, setSetting, transaction } from './schema';
import { getUniverse, insertPlayer, freeNumber } from './season';
import { cupoAllowsIn, cupoAllowsOut } from './world';
import { objectiveDelta } from './club';
import { seasonIncome } from './finance';
import { NCAA, NCAA_MSG, isNcaaClub } from './leagues';
import { type PromiseTerms, makePromise, trustsPromises } from './promises';
import { clubDecision, currentNeed, currentSellerWants, defaultClause, patience, playerDecision, preferredYears, windowState } from './transfers';

export const ROSTER_MAX = 16;
export const ROSTER_MIN = 10;
const round = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);

/**
 * Sueldo de mercado de un jugador según su media (escala v0.9, con presupuestos ACB de 4 a 13 M€):
 * 72.000 € con 45, ~210.000 € con 55, ~1,1 M€ con 70, ~3,4 M€ con 80, ~10 M€ con 90.
 */
export const salaryForOvr = (ovr: number) => 72_000 * Math.exp((ovr - 45) * 0.11);
/** Escala anterior (hasta la v0.8), solo para convertir partidas antiguas. */
const oldSalaryForOvr = (ovr: number) => 50_000 * Math.exp((ovr - 45) * 0.085);
/** Sueldo mínimo de un profesional y de un joven de cantera. */
export const MIN_SALARY = 75_000;
export const ROOKIE_SALARY = 50_000;

export interface PlayerEcon { ovr: number; age: number; potential_est: number; morale: number }

/**
 * Factor de edad del sueldo: a partir de los 30, cada año pide un 9 % menos de lo que marcaría su media
 * (sabe que va a bajar y que pocos clubes le quieren): 31 → 0,91, 33 → 0,73, 35 → 0,55, mínimo 0,35.
 */
export const ageSalaryFactor = (age: number) => (age <= 30 ? 1 : Math.max(0.35, 1 - 0.09 * (age - 30)));

/** Lo que pide por temporada para firmar o renovar. */
export function askSalary(p: PlayerEcon): number {
  const level = p.age < 25 ? p.ovr + (p.potential_est - p.ovr) * 0.4 : p.ovr;
  const ageF = ageSalaryFactor(p.age);
  const moodF = p.morale < 40 ? 1.1 : 1;
  return round(salaryForOvr(level) * ageF * moodF, 5_000);
}

/** Valor de traspaso. Un contrato que termina esta temporada vale bastante menos. */
export function marketValue(p: PlayerEcon, yearsLeft: number): number {
  const ageF = p.age <= 21 ? 3 : p.age <= 24 ? 2.5 : p.age <= 27 ? 2 : p.age <= 30 ? 1.5 : p.age <= 32 ? 0.9 : 0.4;
  const contractF = yearsLeft <= 0 ? 0.5 : yearsLeft === 1 ? 0.8 : 1;
  return round(askSalary({ ...p, morale: 70 }) * ageF * contractF, 10_000);
}

/** Masa salarial: contratos propios (menos la parte que paga el club donde está cedido) más la parte de los cedidos que recibe. */
export function payroll(db: Db, clubId: number): number {
  const own = db.rows<{ s: number | null }>(
    'SELECT SUM(CASE WHEN l.player_id IS NULL THEN c.salary ELSE c.salary * (1 - l.share) END) AS s FROM contract c LEFT JOIN loan l ON l.player_id = c.player_id WHERE c.club_id = ?',
    [clubId],
  )[0]?.s ?? 0;
  const loanedIn = db.rows<{ s: number | null }>('SELECT SUM(c.salary * l.share) AS s FROM loan l JOIN contract c ON c.player_id = l.player_id WHERE l.club_id = ?', [clubId])[0]?.s ?? 0;
  return Math.round(Number(own) + Number(loanedIn));
}
function rosterSize(db: Db, clubId: number): number {
  return Number(db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [clubId])[0]!.n);
}

export function econOf(db: Db, playerId: number) {
  const u = getUniverse(db)!;
  const r = db.rows<{ id: number; name: string; club_id: number | null; birth_year: number; potential_est: number; morale: number; ovr: number; salary: number | null; until: number | null; retired: number; injury_games: number; nationality: string; youth: number }>(
    `SELECT p.id, p.name, p.club_id, p.birth_year, p.potential_est, p.morale, p.retired, p.injury_games, p.nationality, p.youth, a.ovr, c.salary, c.until
     FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? LEFT JOIN contract c ON c.player_id = p.id WHERE p.id = ?`,
    [u.game_season, playerId],
  )[0];
  if (!r) throw new Error('Jugador no encontrado.');
  const e: PlayerEcon = { ovr: r.ovr, age: u.game_season - r.birth_year, potential_est: r.potential_est, morale: r.morale };
  const yearsLeft = r.until === null ? 0 : r.until - u.game_season;
  return { ...r, econ: e, ask: askSalary(e), value: marketValue(e, yearsLeft), yearsLeft, season: u.game_season, day: u.game_day, phase: u.phase, userClub: u.user_club_id };
}

export function addNews(db: Db, kind: string, text: string, clubId: number | null = null, playerId: number | null = null, action: Record<string, unknown> | null = null) {
  const u = getUniverse(db)!;
  db.exec('INSERT INTO news (season, day, club_id, player_id, kind, text, action) VALUES (?,?,?,?,?,?,?)', [u.game_season, u.game_day, clubId, playerId, kind, text, action ? JSON.stringify(action) : null]);
}
function logTransfer(db: Db, playerId: number, from: number | null, to: number | null, fee: number, salary: number | null, until: number | null, kind: string) {
  const u = getUniverse(db)!;
  db.exec('INSERT INTO transfer (season, day, player_id, from_club, to_club, fee, salary, until, kind) VALUES (?,?,?,?,?,?,?,?,?)', [u.game_season, u.game_day, playerId, from, to, fee, salary, until, kind]);
}
const clubName = (db: Db, id: number | null) => (id ? db.rows<{ name: string }>('SELECT name FROM club WHERE id = ?', [id])[0]?.name ?? '¿?' : 'agente libre');
const eur = (x: number) => `${Math.round(x / 1000).toLocaleString('es-ES')}.000 €`;

/**
 * Crea contratos, presupuestos y caja donde falten (universos nuevos o partidas de versiones anteriores).
 * No abre transacción: la abre quien lo llama.
 */
export function ensureEconomy(db: Db): void {
  const u = getUniverse(db);
  if (!u) return;
  const amateur = `AND p.club_id NOT IN (SELECT id FROM club WHERE competition_id = ${NCAA})`;
  const missing = db.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM player p LEFT JOIN contract c ON c.player_id = p.id WHERE p.club_id IS NOT NULL AND p.retired = 0 AND c.player_id IS NULL ${amateur}`)[0]!.n;
  if (!missing) return;
  const rng = new Rng(mixSeed(u.seed, 4242));
  const rows = db.rows<{ id: number; club_id: number; birth_year: number; potential_est: number; morale: number; ovr: number }>(
    `SELECT p.id, p.club_id, p.birth_year, p.potential_est, p.morale, a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     LEFT JOIN contract c ON c.player_id = p.id WHERE p.club_id IS NOT NULL AND p.retired = 0 AND c.player_id IS NULL ${amateur}`,
    [u.game_season],
  );
  const touched = new Set(rows.map((r) => r.club_id));
  for (const r of rows) {
    const ask = askSalary({ ovr: r.ovr, age: u.game_season - r.birth_year, potential_est: r.potential_est, morale: r.morale });
    db.exec('INSERT INTO contract (player_id, club_id, salary, until) VALUES (?,?,?,?)', [r.id, r.club_id, round(ask * (0.85 + rng.next() * 0.3), 5_000), u.game_season + rng.int(0, 3)]);
  }
  // Presupuesto: lo que ya paga más un margen; caja: entre un 40 % y un 70 % del presupuesto.
  // Solo los clubes que no tenían contratos (en una partida antigua, los clubes europeos recién añadidos).
  for (const c of db.rows<{ id: number; competition_id: number }>('SELECT id, competition_id FROM club')) {
    if (!touched.has(c.id)) continue;
    const pay = payroll(db, c.id);
    const budget = round(pay * (1.04 + rng.next() * 0.1), 50_000);
    db.exec('UPDATE club SET budget = ?, cash = ? WHERE id = ?', [budget, round(budget * (0.4 + rng.next() * 0.3), 10_000), c.id]);
  }
  // Un mercado de agentes libres con el que empezar.
  if (db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id IS NULL AND retired = 0 AND youth = 0')[0]!.n < 10) addFreeAgents(db, rng, 30);
  assignClauses(db);
}

/**
 * Partidas anteriores a la v0.9: pasa sueldos, cláusulas, presupuestos y caja a la escala nueva
 * (cada contrato según la media del jugador; cada club en la proporción de su masa salarial).
 */
export function rescaleEconomy(db: Db): void {
  if (getSetting(db, 'econ') === '2') return;
  const u = getUniverse(db);
  if (u) {
    const before = new Map(db.rows<{ id: number }>('SELECT id FROM club').map((c) => [c.id, payroll(db, c.id)]));
    for (const k of db.rows<{ player_id: number; salary: number; clause: number | null; ovr: number }>(
      'SELECT c.player_id, c.salary, c.clause, a.ovr FROM contract c JOIN player_attributes a ON a.player_id = c.player_id AND a.season = ?',
      [u.game_season],
    )) {
      const f = salaryForOvr(k.ovr) / oldSalaryForOvr(k.ovr);
      db.exec('UPDATE contract SET salary = ?, clause = ? WHERE player_id = ?', [round(k.salary * f, 5_000), k.clause === null ? null : round(k.clause * f, 10_000), k.player_id]);
    }
    for (const [id, old] of before) {
      if (!old) continue;
      const f = payroll(db, id) / old;
      db.exec('UPDATE club SET budget = ROUND(budget * ?), cash = ROUND(cash * ?), budget_extra = ROUND(budget_extra * ?) WHERE id = ?', [f, f, f, id]);
    }
  }
  setSetting(db, 'econ', '2');
}

/** Cláusulas de rescisión para los contratos de la IA que no tienen (entre 2,4 y 4 veces su valor). */
export function assignClauses(db: Db) {
  const u = getUniverse(db);
  if (!u) return;
  const rng = new Rng(mixSeed(u.seed, u.game_season * 71 + 9));
  for (const c of db.rows<{ player_id: number }>('SELECT player_id FROM contract WHERE clause IS NULL AND club_id IS NOT ?', [u.user_club_id])) {
    db.exec('UPDATE contract SET clause = ? WHERE player_id = ?', [defaultClause(econOf(db, c.player_id).value, rng), c.player_id]);
  }
}

/** Agentes libres generados: veteranos, jugadores de rotación y jóvenes. */
export function addFreeAgents(db: Db, rng: Rng, n: number, seasonArg?: number) {
  const season = seasonArg ?? getUniverse(db)!.game_season;
  const used = new Set(db.rows<{ name: string }>('SELECT name FROM player').map((p) => p.name));
  for (let i = 0; i < n; i++) {
    const nat = pickNationality(rng);
    const age = rng.int(20, 34);
    const p = generatePlayer(rng, { pos: rng.pick(POSITIONS), quality: 44 + rng.next() * 18 + (rng.chance(0.15) ? 6 : 0), age, season, nationality: nat, name: makeName(rng, nat, used) });
    insertPlayer(db, p, null, null, season);
  }
}

const loaned = (db: Db, playerId: number) => db.rows('SELECT 1 FROM loan WHERE player_id = ?', [playerId]).length > 0;
const LOAN_MSG = { ok: false, message: 'Está cedido: hasta que termine la cesión no se puede traspasar, rescindir ni renovar.' } as const;
export type MarketResult = { ok: boolean; message: string; counter?: number; patience?: number };
function blockedWindow(phase: string): string | null {
  return phase === 'playoffs' ? 'El mercado está cerrado durante los playoffs.' : null;
}

/** Fichar a un agente libre. */
export function signFreeAgent(db: Db, clubId: number, playerId: number, salary: number, years: number, clause: number | null = null, promise: PromiseTerms | null = null): MarketResult {
  const e = econOf(db, playerId);
  const closed = blockedWindow(e.phase);
  if (closed) return { ok: false, message: closed };
  if (e.club_id !== null || e.retired || e.youth) return { ok: false, message: 'No es agente libre.' };
  const cupoIn = cupoAllowsIn(db, clubId, e.nationality);
  if (cupoIn) return { ok: false, message: cupoIn };
  if (rosterSize(db, clubId) >= ROSTER_MAX) return { ok: false, message: `Tu plantilla ya tiene ${ROSTER_MAX} jugadores.` };
  const budget = db.rows<{ budget: number }>('SELECT budget FROM club WHERE id = ?', [clubId])[0]!.budget;
  if (payroll(db, clubId) + salary > budget) return { ok: false, message: `No cabe en tu presupuesto salarial: te quedan ${eur(Math.max(0, budget - payroll(db, clubId)))}.` };
  years = Math.max(1, Math.min(4, Math.round(years)));
  const say = playerDecision(db, playerId, clubId, { salary, years, clause, promise });
  if (!say.ok) return say;
  const until = e.season + years - 1 + (e.phase === 'fin' ? 1 : 0);
  transaction(db, () => {
    if (promise) makePromise(db, playerId, clubId, promise);
    db.exec('UPDATE player SET club_id = ?, morale = MAX(morale, 70) WHERE id = ?', [clubId, playerId]);
    const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND number IS NOT NULL', [clubId]).map((x) => x.number));
    db.exec('UPDATE player SET number = ? WHERE id = ?', [freeNumber(new Rng(playerId), nums), playerId]);
    db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until, clause) VALUES (?,?,?,?,?)', [playerId, clubId, salary, until, clause]);
    logTransfer(db, playerId, null, clubId, 0, salary, until, 'libre');
    addNews(db, 'fichaje', `${clubName(db, clubId)} ficha a ${e.name} (agente libre) hasta ${until + 1}: ${eur(salary)} por temporada.`, clubId, playerId);
    bumpRevision(db);
  });
  return { ok: true, message: `${e.name} firma hasta el final de la temporada ${until}-${String((until + 1) % 100).padStart(2, '0')}.` };
}

/** Comprar a un jugador de otro club: el club decide por el traspaso y el jugador por el sueldo. */
export function buyPlayer(db: Db, buyer: number, playerId: number, fee: number, salary: number, years: number, clause: number | null = null, promise: PromiseTerms | null = null): MarketResult {
  if (loaned(db, playerId)) return { ...LOAN_MSG };
  const e = econOf(db, playerId);
  if (e.club_id === null) return signFreeAgent(db, buyer, playerId, salary, years, clause, promise);
  if (isNcaaClub(db, e.club_id)) return { ok: false, message: NCAA_MSG };
  const w = windowState(db);
  if (!w.open) return { ok: false, message: `${w.label}. Los agentes libres sí se pueden fichar.` };
  if (e.club_id === buyer) return { ok: false, message: 'Ya es tu jugador.' };
  const seller = e.club_id;
  if (rosterSize(db, buyer) >= ROSTER_MAX) return { ok: false, message: `Tu plantilla ya tiene ${ROSTER_MAX} jugadores.` };
  if (rosterSize(db, seller) <= ROSTER_MIN + 1) return { ok: false, message: `${clubName(db, seller)} no vende: se quedaría sin jugadores suficientes.` };
  const cupoIn = cupoAllowsIn(db, buyer, e.nationality);
  if (cupoIn) return { ok: false, message: cupoIn };
  if (cupoAllowsOut(db, seller, e.nationality)) return { ok: false, message: `${clubName(db, seller)} no vende: se quedaría sin el mínimo de nacionales.` };
  const cash = db.rows<{ cash: number; budget: number }>('SELECT cash, budget FROM club WHERE id = ?', [buyer])[0]!;
  if (fee > cash.cash) return { ok: false, message: `No tienes caja suficiente: dispones de ${eur(cash.cash)}.` };
  if (payroll(db, buyer) + salary > cash.budget) return { ok: false, message: `El sueldo no cabe en tu presupuesto: te quedan ${eur(Math.max(0, cash.budget - payroll(db, buyer)))}.` };
  years = Math.max(1, Math.min(4, Math.round(years)));
  // Primero el club (traspaso o cláusula), después el jugador (contrato).
  const club = clubDecision(db, playerId, buyer, fee);
  if (!club.ok) return club;
  const say = playerDecision(db, playerId, buyer, { salary, years, clause, promise });
  if (!say.ok) return { ...say, message: `El club acepta ${eur(fee)}, pero falta el jugador. ${say.message}` };
  const until = e.season + years - 1 + (e.phase === 'fin' ? 1 : 0);
  transaction(db, () => {
    db.exec('UPDATE club SET cash = cash - ? WHERE id = ?', [fee, buyer]);
    db.exec('UPDATE club SET cash = cash + ? WHERE id = ?', [fee, seller]);
    db.exec('DELETE FROM lineup WHERE player_id = ?', [playerId]);
    db.exec('UPDATE player SET wants_out = 0, unhappy = 0, listed = 0 WHERE id = ?', [playerId]);
    db.exec('DELETE FROM promise WHERE player_id = ?', [playerId]);
    if (promise) makePromise(db, playerId, buyer, promise);
    db.exec('UPDATE player SET club_id = ?, morale = MAX(morale, 72) WHERE id = ?', [buyer, playerId]);
    const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND number IS NOT NULL AND id <> ?', [buyer, playerId]).map((x) => x.number));
    if (nums.has(Number(db.rows<{ number: number }>('SELECT number FROM player WHERE id = ?', [playerId])[0]!.number))) {
      db.exec('UPDATE player SET number = ? WHERE id = ?', [freeNumber(new Rng(playerId), nums), playerId]);
    }
    db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until, clause) VALUES (?,?,?,?,?)', [playerId, buyer, salary, until, clause]);
    db.exec('DELETE FROM player_tendency WHERE player_id = ?', [playerId]);
    logTransfer(db, playerId, seller, buyer, fee, salary, until, club.byClause ? 'clausula' : 'traspaso');
    addNews(db, 'fichaje', `${clubName(db, buyer)} compra a ${e.name} a ${clubName(db, seller)} por ${eur(fee)}.`, buyer, playerId);
    bumpRevision(db);
  });
  return { ok: true, message: `¡Fichado! ${e.name} llega por ${eur(fee)} y cobrará ${eur(salary)} por temporada.` };
}

/** Ofertas de otros clubes por un jugador (deterministas para el mismo día). */
export function offersFor(db: Db, playerId: number): { club_id: number; club: string; fee: number }[] {
  const e = econOf(db, playerId);
  if (e.club_id === null) return [];
  const u = getUniverse(db)!;
  const rng = new Rng(mixSeed(u.seed, playerId * 1000 + u.game_season * 50 + u.game_day));
  const clubs = db.rows<{ id: number; name: string; cash: number; budget: number }>('SELECT id, name, cash, budget FROM club WHERE id <> ?', [e.club_id]);
  const out: { club_id: number; club: string; fee: number }[] = [];
  for (const c of clubs) {
    if (rosterSize(db, c.id) >= 15) continue;
    if (cupoAllowsIn(db, c.id, e.nationality)) continue;
    if (payroll(db, c.id) + (e.salary ?? e.ask) > c.budget * 1.05) continue;
    // Solo pujan si el jugador estaría entre sus 9 mejores.
    const ninth = db.rows<{ ovr: number }>(
      'SELECT a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC LIMIT 1 OFFSET 8',
      [u.game_season, c.id],
    )[0]?.ovr ?? 0;
    if (e.econ.ovr < ninth) continue;
    const fee = round(e.value * (0.72 + rng.next() * 0.4), 5_000);
    if (fee > c.cash) continue;
    out.push({ club_id: c.id, club: c.name, fee });
  }
  return out.sort((a, b) => b.fee - a.fee).slice(0, 3);
}

export function sellPlayer(db: Db, playerId: number, toClub: number): MarketResult {
  if (loaned(db, playerId)) return { ...LOAN_MSG };
  const e = econOf(db, playerId);
  const w = windowState(db);
  if (!w.open) return { ok: false, message: w.label };
  const offer = offersFor(db, playerId).find((o) => o.club_id === toClub);
  if (!offer) return { ok: false, message: 'Esa oferta ya no está disponible.' };
  if (rosterSize(db, e.club_id!) <= ROSTER_MIN) return { ok: false, message: `No puedes quedarte con menos de ${ROSTER_MIN} jugadores.` };
  const cupoOut = cupoAllowsOut(db, e.club_id!, e.nationality);
  if (cupoOut) return { ok: false, message: cupoOut };
  const from = e.club_id!;
  transaction(db, () => {
    db.exec('UPDATE club SET cash = cash + ? WHERE id = ?', [offer.fee, from]);
    db.exec('UPDATE club SET cash = cash - ? WHERE id = ?', [offer.fee, toClub]);
    db.exec('DELETE FROM lineup WHERE player_id = ?', [playerId]);
    db.exec('UPDATE player SET club_id = ?, wants_out = 0, unhappy = 0, listed = 0 WHERE id = ?', [toClub, playerId]);
    db.exec('DELETE FROM promise WHERE player_id = ?', [playerId]);
    db.exec('UPDATE contract SET club_id = ? WHERE player_id = ?', [toClub, playerId]);
    logTransfer(db, playerId, from, toClub, offer.fee, e.salary, e.until, 'traspaso');
    addNews(db, 'venta', `${clubName(db, from)} vende a ${e.name} a ${offer.club} por ${eur(offer.fee)}.`, from, playerId);
    bumpRevision(db);
  });
  return { ok: true, message: `${e.name} se marcha a ${offer.club}. Ingresas ${eur(offer.fee)}.` };
}

/**
 * Pasar dinero de la caja (traspasos) al presupuesto salarial de esta temporada, o devolver a la caja
 * lo que se pasó y no se está usando. Al acabar la temporada, lo que sobra del presupuesto vuelve a la caja
 * y el presupuesto de la siguiente parte del base (sin lo añadido).
 */
export function moveCash(db: Db, clubId: number, amount: number): MarketResult {
  const c = db.rows<{ cash: number; budget: number; budget_extra: number }>('SELECT cash, budget, budget_extra FROM club WHERE id = ?', [clubId])[0];
  if (!c) return { ok: false, message: 'Club no encontrado.' };
  amount = Math.round(amount / 5_000) * 5_000;
  if (!amount) return { ok: false, message: 'Indica una cantidad.' };
  if (amount > 0 && amount > c.cash) return { ok: false, message: `Solo tienes ${eur(Math.max(0, c.cash))} en caja.` };
  if (amount < 0) {
    const back = Math.min(c.budget_extra, c.budget - payroll(db, clubId));
    if (-amount > back) return { ok: false, message: back > 0 ? `Solo puedes devolver ${eur(back)} (lo que pasaste y no estás usando).` : 'No hay nada que devolver: o no pasaste dinero o ya lo usas en sueldos.' };
  }
  transaction(db, () => {
    db.exec('UPDATE club SET cash = cash - ?, budget = budget + ?, budget_extra = budget_extra + ? WHERE id = ?', [amount, amount, amount, clubId]);
    bumpRevision(db);
  });
  return { ok: true, message: amount > 0 ? `Pasas ${eur(amount)} de la caja a salarios para esta temporada.` : `Devuelves ${eur(-amount)} a la caja.` };
}

/** Rescindir: se paga la mitad de lo que queda de contrato y el jugador queda libre. */
export function releaseCost(db: Db, playerId: number): number {
  const e = econOf(db, playerId);
  return e.salary ? round(0.5 * e.salary * Math.max(1, e.yearsLeft + 1), 5_000) : 0;
}
export function releasePlayer(db: Db, playerId: number): MarketResult {
  if (loaned(db, playerId)) return { ...LOAN_MSG };
  const e = econOf(db, playerId);
  if (e.club_id === null) return { ok: false, message: 'No tiene contrato.' };
  if (rosterSize(db, e.club_id) <= ROSTER_MIN) return { ok: false, message: `No puedes quedarte con menos de ${ROSTER_MIN} jugadores.` };
  const cupoOut = cupoAllowsOut(db, e.club_id, e.nationality);
  if (cupoOut) return { ok: false, message: cupoOut };
  const cost = releaseCost(db, playerId);
  const from = e.club_id;
  transaction(db, () => {
    db.exec('UPDATE club SET cash = cash - ? WHERE id = ?', [cost, from]);
    db.exec('DELETE FROM lineup WHERE player_id = ?', [playerId]);
    db.exec('DELETE FROM contract WHERE player_id = ?', [playerId]);
    db.exec('UPDATE player SET club_id = NULL, number = NULL, wants_out = 0, unhappy = 0, listed = 0 WHERE id = ?', [playerId]);
    db.exec('DELETE FROM promise WHERE player_id = ?', [playerId]);
    logTransfer(db, playerId, from, null, cost, null, null, 'rescision');
    addNews(db, 'rescision', `${clubName(db, from)} rescinde el contrato de ${e.name} (indemnización: ${eur(cost)}).`, from, playerId);
    bumpRevision(db);
  });
  return { ok: true, message: `Contrato rescindido. Indemnización pagada: ${eur(cost)}.` };
}

/** Renovar: solo en el último año de contrato. Si está descontento, pide más. */
export function renewPlayer(db: Db, playerId: number, salary: number, years: number, clause: number | null = null, promise: PromiseTerms | null = null): MarketResult {
  if (loaned(db, playerId)) return { ...LOAN_MSG };
  const e = econOf(db, playerId);
  if (e.club_id === null || e.until === null) return { ok: false, message: 'No tiene contrato.' };
  if (e.yearsLeft > 0) return { ok: false, message: 'Solo se renueva en el último año de contrato.' };
  const budget = db.rows<{ budget: number }>('SELECT budget FROM club WHERE id = ?', [e.club_id])[0]!.budget;
  if (payroll(db, e.club_id) - (e.salary ?? 0) + salary > budget * 1.02) return { ok: false, message: 'Ese sueldo no cabe en tu presupuesto salarial.' };
  years = Math.max(1, Math.min(4, Math.round(years)));
  const say = playerDecision(db, playerId, e.club_id, { salary, years, clause, promise }, true);
  if (!say.ok) return say;
  const until = e.until + years;
  transaction(db, () => {
    if (promise) makePromise(db, playerId, e.club_id!, promise);
    db.exec('UPDATE contract SET salary = ?, until = ?, clause = ? WHERE player_id = ?', [salary, until, clause, playerId]);
    db.exec('UPDATE player SET morale = MIN(100, morale + 8) WHERE id = ?', [playerId]);
    logTransfer(db, playerId, e.club_id, e.club_id, 0, salary, until, 'renovacion');
    addNews(db, 'renovacion', `${e.name} renueva con ${clubName(db, e.club_id)} hasta ${until}-${String((until + 1) % 100).padStart(2, '0')}.`, e.club_id, playerId);
    bumpRevision(db);
  });
  return { ok: true, message: `${e.name} renueva hasta ${until}-${String((until + 1) % 100).padStart(2, '0')} por ${eur(salary)} por temporada.` };
}

export function marketInfo(db: Db, playerId: number) {
  const e = econOf(db, playerId);
  return {
    club_id: e.club_id, youth: e.youth, nationality: e.nationality, salary: e.salary, until: e.until, ask: e.ask, value: e.value, yearsLeft: e.yearsLeft,
    releaseCost: e.club_id ? releaseCost(db, playerId) : 0, morale: e.econ.morale, injury_games: e.injury_games,
    canRenew: e.club_id !== null && e.yearsLeft <= 0, marketOpen: blockedWindow(e.phase) === null, phase: e.phase,
    window: windowState(db),
    loan: db.rows<{ owner_id: number; club_id: number; owner: string; club: string; share: number }>(
      'SELECT l.owner_id, l.club_id, o.name AS owner, c.name AS club, l.share FROM loan l JOIN club o ON o.id = l.owner_id JOIN club c ON c.id = l.club_id WHERE l.player_id = ?',
      [playerId],
    )[0] ?? null,
    clause: db.rows<{ clause: number | null }>('SELECT clause FROM contract WHERE player_id = ?', [playerId])[0]?.clause ?? null,
    age: e.econ.age,
    preferredYears: preferredYears(e.econ.age),
    patience: e.userClub ? patience(db, playerId, e.userClub) : 100,
    clubPatience: e.userClub ? patience(db, playerId, -e.userClub) : 100,
    need: e.userClub && e.club_id !== e.userClub ? currentNeed(db, playerId, e.userClub, preferredYears(e.econ.age), null) : e.userClub && e.club_id === e.userClub ? currentNeed(db, playerId, e.userClub, preferredYears(e.econ.age), null, true) : e.ask,
    sellerWants: e.club_id !== null && e.club_id !== e.userClub && e.userClub ? currentSellerWants(db, playerId, e.userClub) : null,
    trusts: e.userClub ? trustsPromises(db, playerId, e.userClub) : true,
    offers: db.rows<{ id: number; club: string; fee: number; expires_day: number }>("SELECT o.id, c.name AS club, o.fee, o.expires_day FROM market_offer o JOIN club c ON c.id = o.from_club WHERE o.player_id = ? AND o.status = 'pendiente'", [playerId]),
  };
}

export function finances(db: Db, clubId: number) {
  const u = getUniverse(db)!;
  const club = db.rows<{ id: number; name: string; budget: number; cash: number; gate: number; budget_extra: number }>('SELECT id, name, budget, cash, gate, budget_extra FROM club WHERE id = ?', [clubId])[0]!;
  const income = { gate: club.gate, ...seasonIncome(db, clubId, u.game_season, club.budget - club.budget_extra) };
  const contracts = db.rows<{ id: number; name: string; pos1: string; ovr: number; birth_year: number; potential_est: number; morale: number; salary: number; until: number; injury_games: number }>(
    `SELECT p.id, p.name, p.pos1, a.ovr, p.birth_year, p.potential_est, p.morale, p.injury_games, c.salary, c.until FROM contract c JOIN player p ON p.id = c.player_id
     JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE c.club_id = ? ORDER BY c.salary DESC`,
    [u.game_season, clubId],
  ).map((r) => {
    const econ = { ovr: r.ovr, age: u.game_season - r.birth_year, potential_est: r.potential_est, morale: r.morale };
    return { ...r, age: econ.age, ask: askSalary(econ), value: marketValue(econ, r.until - u.game_season) };
  });
  const history = db.rows('SELECT * FROM club_season_finance WHERE club_id = ? ORDER BY season DESC', [clubId]);
  const transfers = db.rows<{ season: number; day: number; name: string; from_club: string | null; to_club: string | null; fee: number; kind: string }>(
    `SELECT t.season, t.day, p.name, cf.name AS from_club, ct.name AS to_club, t.fee, t.kind FROM transfer t JOIN player p ON p.id = t.player_id
     LEFT JOIN club cf ON cf.id = t.from_club LEFT JOIN club ct ON ct.id = t.to_club WHERE t.from_club = ? OR t.to_club = ? ORDER BY t.id DESC LIMIT 30`,
    [clubId, clubId],
  );
  return { club, income, season: u.game_season, payroll: contracts.reduce((a, c) => a + c.salary, 0), contracts, history, transfers };
}

/** Premios en metálico de una temporada: título y final de cada competición y 350.000 € por jugar los playoffs ACB. */
export function seasonPrizes(db: Db, season: number): Map<number, number> {
  const results = db.rows<{ competition_id: number; champion_id: number | null; runner_up_id: number | null }>('SELECT competition_id, champion_id, runner_up_id FROM season_result WHERE season = ?', [season]);
  const prize = new Map<number, number>();
  const PRIZE: Record<number, [number, number]> = { 1: [2_000_000, 750_000], 2: [600_000, 0], 3: [1_000_000, 400_000], 4: [4_000_000, 1_500_000], 5: [1_500_000, 600_000], 6: [1_200_000, 500_000] };
  for (const r of results) {
    const [win, fin] = PRIZE[r.competition_id] ?? [0, 0];
    if (r.champion_id) prize.set(r.champion_id, (prize.get(r.champion_id) ?? 0) + win);
    if (r.runner_up_id) prize.set(r.runner_up_id, (prize.get(r.runner_up_id) ?? 0) + fin);
  }
  for (const s of db.rows<{ high_id: number; low_id: number }>('SELECT high_id, low_id FROM playoff_series WHERE season = ? AND round = 1 AND competition_id = 1', [season])) {
    for (const id of [s.high_id, s.low_id]) prize.set(id, (prize.get(id) ?? 0) + 350_000);
  }
  return prize;
}

/**
 * Cuentas de la temporada que acaba (antes de cerrarla): lo mismo que hará el verano, para el resumen.
 * El presupuesto previsto no incluye aún el efecto del objetivo si no se ha evaluado.
 */
export function seasonForecast(db: Db, clubId: number, season: number) {
  const c = db.rows<{ budget: number; cash: number; budget_extra: number; gate: number }>('SELECT budget, cash, budget_extra, gate FROM club WHERE id = ?', [clubId])[0]!;
  const base = c.budget - c.budget_extra;
  const wages = payroll(db, clubId);
  const pz = seasonPrizes(db, season).get(clubId) ?? 0;
  const inc = seasonIncome(db, clubId, season, base);
  const cash = c.cash + (c.budget - wages) + pz + inc.sponsor - inc.costs;
  const obj = objectiveDelta(db, season, clubId);
  const net = c.gate + inc.sponsor + pz - inc.costs;
  const factor = Math.max(0.82, Math.min(1.25, 1 + (net / Math.max(1, base)) * 0.5 + obj + (cash > base * 0.9 ? 0.05 : 0) + (cash < 0 ? -0.1 : 0)));
  return { budget: c.budget, base, wages, gate: c.gate, sponsor: inc.sponsor, costs: inc.costs, prizes: pz, cashNow: c.cash, cashEnd: cash, nextBudget: Math.round((base * factor) / 50_000) * 50_000, objective: obj };
}

/**
 * Pretemporada de los clubes de la IA y paso de la economía a la temporada nueva.
 * Se llama dentro de la transacción de startNewSeason, con la temporada nueva ya fijada.
 */
export function offseason(db: Db, oldSeason: number, newSeason: number, userClub: number | null, events: string[]): void {
  const u = getUniverse(db)!;
  const rng = new Rng(mixSeed(u.seed, newSeason * 31337));
  const ovrOf = (id: number) => db.rows<{ ovr: number }>('SELECT ovr FROM player_attributes WHERE player_id = ? AND season = ?', [id, newSeason])[0]?.ovr ?? 40;

  // 1. Economía de la temporada que termina: sueldos pagados, premios, caja y presupuesto nuevo.
  const prize = seasonPrizes(db, oldSeason);
  for (const c0 of db.rows<{ id: number; budget: number; cash: number; budget_extra: number; gate: number; competition_id: number | null }>('SELECT id, budget, cash, budget_extra, gate, competition_id FROM club')) {
    const c = { ...c0, base: c0.budget - (c0.budget_extra ?? 0) };
    const wages = payroll(db, c.id);
    const tIn = Number(db.rows<{ s: number | null }>("SELECT SUM(fee) AS s FROM transfer WHERE season = ? AND to_club = ? AND kind = 'traspaso'", [oldSeason, c.id])[0]!.s ?? 0);
    const tOut = Number(db.rows<{ s: number | null }>("SELECT SUM(fee) AS s FROM transfer WHERE season = ? AND from_club = ? AND kind = 'traspaso'", [oldSeason, c.id])[0]!.s ?? 0);
    const pz = prize.get(c.id) ?? 0;
    // Ingresos y gastos: la taquilla ya entró en la caja partido a partido; el patrocinio y los gastos fijos, ahora.
    const inc = seasonIncome(db, c.id, oldSeason, c.base);
    const cash = c.cash + (c.budget - wages) + pz + inc.sponsor - inc.costs;
    db.exec(
      'INSERT OR REPLACE INTO club_season_finance (season, club_id, budget, wages, prizes, transfers_in, transfers_out, cash_end, gate, sponsor, costs) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [oldSeason, c.id, c.budget, wages, pz, tIn, tOut, cash, c.gate ?? 0, inc.sponsor, inc.costs],
    );
    // Presupuesto nuevo: lo que el club ha generado (taquilla, patrocinio y premios menos gastos), el objetivo
    // de la directiva, las deudas y la caja de sobra que se reinvierte.
    const obj = objectiveDelta(db, oldSeason, c.id);
    const reinvest = cash > c.base * 0.9 ? 0.05 : 0;
    const net = (c.gate ?? 0) + inc.sponsor + pz - inc.costs;
    const factor = Math.max(0.82, Math.min(1.25, 1 + (net / Math.max(1, c.base)) * 0.5 + obj + reinvest + (cash < 0 ? -0.1 : 0)));
    // La caja pasada a salarios solo vale para la temporada en que se pasó: el presupuesto nuevo parte del base.
    db.exec('UPDATE club SET cash = ?, budget = ?, budget_extra = 0, gate = 0 WHERE id = ?', [cash, c.base > 0 ? round(c.base * factor, 50_000) : 0, c.id]);
  }

  // 2. Contratos que terminan: la IA renueva a los que le sirven; el resto, y los del usuario no renovados, quedan libres.
  const expiring = db.rows<{ player_id: number; club_id: number; salary: number }>('SELECT player_id, club_id, salary FROM contract WHERE until < ?', [newSeason]);
  let freed = 0;
  for (const c of expiring) {
    const p = db.rows<{ name: string; birth_year: number; potential_est: number; morale: number }>('SELECT name, birth_year, potential_est, morale FROM player WHERE id = ?', [c.player_id])[0]!;
    const econ = { ovr: ovrOf(c.player_id), age: newSeason - p.birth_year, potential_est: p.potential_est, morale: p.morale };
    let renew = false;
    if (c.club_id !== userClub) {
      const median = db.rows<{ ovr: number }>(
        'SELECT a.ovr FROM player x JOIN player_attributes a ON a.player_id = x.id AND a.season = ? WHERE x.club_id = ? AND x.retired = 0 ORDER BY a.ovr DESC LIMIT 1 OFFSET 6',
        [newSeason, c.club_id],
      )[0]?.ovr ?? 0;
      const budget = db.rows<{ budget: number }>('SELECT budget FROM club WHERE id = ?', [c.club_id])[0]!.budget;
      const ask = askSalary(econ);
      renew = econ.ovr >= median && econ.age <= 33 && payroll(db, c.club_id) - c.salary + ask <= budget;
      if (renew) db.exec('UPDATE contract SET salary = ?, until = ? WHERE player_id = ?', [ask, newSeason + rng.int(0, 2), c.player_id]);
    }
    if (!renew) {
      db.exec('DELETE FROM contract WHERE player_id = ?', [c.player_id]);
      db.exec('DELETE FROM lineup WHERE player_id = ?', [c.player_id]);
      db.exec('UPDATE player SET club_id = NULL, number = NULL WHERE id = ?', [c.player_id]);
      freed++;
      if (c.club_id === userClub) events.push(`${p.name} termina contrato y deja tu club.`);
    }
  }
  if (freed) events.push(`${freed} jugadores acaban contrato y salen al mercado.`);

  // 3. Nuevos agentes libres generados para que el mercado no se seque.
  addFreeAgents(db, rng, 24, newSeason);

  // 4. La IA completa plantillas con agentes libres (mejor media que quepa en su presupuesto).
  const freeAgents = () =>
    db.rows<{ id: number; name: string; ovr: number; birth_year: number; potential_est: number; morale: number; nationality: string }>(
      `SELECT p.id, p.name, a.ovr, p.birth_year, p.potential_est, p.morale, p.nationality FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
       WHERE p.club_id IS NULL AND p.retired = 0 AND p.youth = 0 ORDER BY a.ovr DESC`,
      [newSeason],
    );
  let signed = 0;
  for (const c of db.rows<{ id: number; name: string; budget: number; country: string }>(`SELECT id, name, budget, country FROM club WHERE id IS NOT ? AND competition_id IS NOT ${NCAA} ORDER BY reputation DESC`, [userClub])) {
    let n = rosterSize(db, c.id);
    let guard = 0;
    while (n < 12 && guard++ < 6) {
      const room = c.budget - payroll(db, c.id);
      const nac = db.rows<{ nationality: string }>('SELECT nationality FROM player WHERE club_id = ? AND retired = 0', [c.id]).filter((x) => x.nationality === 'ES').length;
      const needNac = c.country === 'ES' && nac < 4 + Math.max(0, n - 11);
      const fa = freeAgents().find((f) => askSalary({ ovr: f.ovr, age: newSeason - f.birth_year, potential_est: f.potential_est, morale: f.morale }) <= Math.max(room, MIN_SALARY) && !cupoAllowsIn(db, c.id, f.nationality) && (!needNac || f.nationality === 'ES'));
      if (!fa) break;
      const ask = askSalary({ ovr: fa.ovr, age: newSeason - fa.birth_year, potential_est: fa.potential_est, morale: fa.morale });
      const until = newSeason + rng.int(0, 2);
      db.exec('UPDATE player SET club_id = ? WHERE id = ?', [c.id, fa.id]);
      const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND number IS NOT NULL', [c.id]).map((x) => x.number));
      db.exec('UPDATE player SET number = ? WHERE id = ?', [freeNumber(rng, nums), fa.id]);
      db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until) VALUES (?,?,?,?)', [fa.id, c.id, ask, until]);
      db.exec('INSERT INTO transfer (season, day, player_id, from_club, to_club, fee, salary, until, kind) VALUES (?,?,?,?,?,?,?,?,?)', [newSeason, 0, fa.id, null, c.id, 0, ask, until, 'libre']);
      if (fa.ovr >= 62) db.exec('INSERT INTO news (season, day, club_id, player_id, kind, text) VALUES (?,?,?,?,?,?)', [newSeason, 0, c.id, fa.id, 'fichaje', `${c.name} ficha a ${fa.name} (agente libre).`]);
      n++;
      signed++;
    }
  }
  if (signed) events.push(`Los clubes firman a ${signed} agentes libres en pretemporada.`);
}

/** Contrato mínimo para los jóvenes de cantera y los fichajes de relleno. */
export function rookieContract(db: Db, playerId: number, clubId: number, season: number) {
  db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until) VALUES (?,?,?,?)', [playerId, clubId, ROOKIE_SALARY, season + 2]);
}
