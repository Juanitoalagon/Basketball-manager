/**
 * Mercado de traspasos (v0.6): ventanas, negociación con contraoferta y paciencia, cláusulas de rescisión,
 * ofertas de la IA por tus jugadores, intercambios y traspasos entre clubes de la IA.
 *
 * Todo es determinista a partir de la semilla del universo y del día.
 */
import { leagueRoundPlayed } from './calendar';
import { Rng, mixSeed } from './rng';
import { type Db, bumpRevision, transaction } from './schema';
import { getUniverse, freeNumber } from './season';
import { cupoAllowsIn, cupoAllowsOut } from './world';
import { cupoOf, CUPO_RULES } from './names';
import { ROSTER_MAX, ROSTER_MIN, addNews, askSalary, econOf, marketValue, payroll, type MarketResult } from './market';

const round = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);
const eur = (x: number) => (Math.abs(x) >= 1e6 ? `${(x / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 2 })} M€` : `${Math.round(x / 1000).toLocaleString('es-ES')} mil €`);
const clubName = (db: Db, id: number | null) => (id ? db.rows<{ name: string }>('SELECT name FROM club WHERE id = ?', [id])[0]?.name ?? '¿?' : 'agente libre');
const rosterSize = (db: Db, clubId: number) => Number(db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [clubId])[0]!.n);

/* ───────────── Ventanas ───────────── */

export interface WindowState { open: boolean; name: 'verano' | 'temporada' | null; label: string }
/**
 * Mercado de traspasos: abierto en verano (temporada terminada) y durante la liga regular hasta jugar
 * la jornada 31, como en la ACB, donde se puede fichar hasta poco antes de los playoffs.
 * Los agentes libres se pueden fichar siempre, salvo en playoffs.
 */
export const MARKET_DEADLINE = 30;
export function windowState(db: Db): WindowState {
  const u = getUniverse(db)!;
  if (u.phase === 'fin' || u.phase === 'eleccion' || (u.phase === 'regular' && u.game_day === 0)) return { open: true, name: 'verano', label: 'Mercado de verano abierto' };
  if (u.phase === 'regular' && leagueRoundPlayed(db, u.game_season) < MARKET_DEADLINE) return { open: true, name: 'temporada', label: `Mercado abierto hasta la jornada ${MARKET_DEADLINE} (cierra al jugar la ${MARKET_DEADLINE + 1})` };
  if (u.phase === 'regular') return { open: false, name: null, label: 'Mercado de traspasos cerrado hasta el verano (cerró tras la jornada 30)' };
  return { open: false, name: null, label: 'Mercado cerrado durante los playoffs' };
}
const closedMsg = (w: WindowState): MarketResult => ({ ok: false, message: `${w.label}. Los agentes libres sí se pueden fichar.` });

/* ───────────── Negociación ───────────── */

/** Atractivo de un club para un jugador: reputación y competición europea. */
export function attractiveness(db: Db, clubId: number | null): number {
  if (!clubId) return 0.9;
  const u = getUniverse(db)!;
  const c = db.rows<{ reputation: number }>('SELECT reputation FROM club WHERE id = ?', [clubId])[0];
  const euro = db.rows<{ c: number }>('SELECT competition_id AS c FROM comp_group WHERE club_id = ? AND season = ?', [clubId, u.game_season])[0]?.c;
  return 1 + ((c?.reputation ?? 60) - 70) / 200 + (euro === 4 ? 0.06 : euro === 5 ? 0.03 : euro === 6 ? 0.02 : 0);
}
/** Años que prefiere firmar según su edad. */
export const preferredYears = (age: number) => (age < 24 ? 4 : age < 29 ? 3 : age < 33 ? 2 : 1);

interface Mood { attempts: number; mood: number }
function moodKey(db: Db, playerId: number, party: number): Mood {
  const u = getUniverse(db)!;
  return db.rows<Mood>('SELECT attempts, mood FROM negotiation WHERE player_id = ? AND club_id = ? AND season = ?', [playerId, party, u.game_season])[0] ?? { attempts: 0, mood: 100 };
}
function setMood(db: Db, playerId: number, party: number, m: Mood) {
  const u = getUniverse(db)!;
  db.exec('INSERT OR REPLACE INTO negotiation (player_id, club_id, season, attempts, mood) VALUES (?,?,?,?,?)', [playerId, party, u.game_season, m.attempts, m.mood]);
}
/** Paciencia del jugador (party = club que negocia) o del club vendedor (party = −club que compra). */
export function patience(db: Db, playerId: number, party: number): number {
  return moodKey(db, playerId, party).mood;
}
function spendPatience(db: Db, playerId: number, party: number, shortfall: number) {
  const m = moodKey(db, playerId, party);
  m.attempts += 1;
  m.mood = Math.max(0, m.mood - (shortfall > 0.25 ? 45 : shortfall > 0.1 ? 30 : 20));
  setMood(db, playerId, party, m);
  return m.mood;
}

export interface Terms { salary: number; years: number; clause: number | null }
/**
 * Lo que necesita un jugador para firmar con un club: sueldo pedido ajustado por el atractivo del club,
 * los años ofrecidos frente a los que prefiere, su moral y la cláusula.
 *   necesario = pide · moral / (atractivo · encaje de años) · efecto de la cláusula
 */
export function requiredSalary(db: Db, playerId: number, clubId: number, years: number, clause: number | null, renewal = false): number {
  const e = econOf(db, playerId);
  const pref = preferredYears(e.econ.age);
  const fit = 1 - 0.05 * Math.abs(years - pref);
  const att = renewal ? Math.max(1.02, attractiveness(db, clubId)) : attractiveness(db, clubId);
  const moodF = e.econ.morale < 40 ? 1.12 : e.econ.morale >= 75 && renewal ? 0.96 : 1;
  const value = Math.max(e.value, 50_000);
  const clauseF = clause === null ? 1 : clause < value * 1.5 ? 0.96 : clause > value * 4 ? 1.06 : 1;
  return round((e.ask * moodF * clauseF) / (att * fit), 5_000);
}

/** El jugador decide. Si no acepta, devuelve la cifra que aceptaría con esos años y pierde paciencia. */
export function playerDecision(db: Db, playerId: number, clubId: number, t: Terms, renewal = false): MarketResult & { counter?: number; patience?: number } {
  const e = econOf(db, playerId);
  const party = clubId;
  if (patience(db, playerId, party) <= 0) return { ok: false, message: `${e.name} no quiere seguir negociando contigo esta temporada.`, patience: 0 };
  const need = requiredSalary(db, playerId, clubId, t.years, t.clause, renewal);
  if (t.salary >= need) return { ok: true, message: 'Acepta.' };
  const short = (need - t.salary) / need;
  const left = spendPatience(db, playerId, party, short);
  const pref = preferredYears(e.econ.age);
  const hint = t.years !== pref ? ` Prefiere ${pref} ${pref === 1 ? 'temporada' : 'temporadas'}.` : '';
  const tone = short > 0.25 ? 'Se siente ofendido por la oferta.' : short > 0.1 ? 'Le parece poco.' : 'Está cerca.';
  return {
    ok: false,
    counter: need,
    patience: left,
    message: left <= 0
      ? `${e.name} rompe las negociaciones: no volverá a escucharte esta temporada.`
      : `${tone} ${e.name} firmaría por ${eur(need)} por temporada.${hint} Paciencia: ${left} %.`,
  };
}

/** Lo que quiere el club vendedor. Si hay cláusula y la pagas, no puede negarse. */
export function sellerWants(db: Db, playerId: number): { wanted: number; clause: number | null; key: boolean } {
  const e = econOf(db, playerId);
  const rank = db.rows<{ id: number }>(
    'SELECT p.id FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC',
    [e.season, e.club_id],
  ).findIndex((x) => x.id === playerId);
  const clause = db.rows<{ clause: number | null }>('SELECT clause FROM contract WHERE player_id = ?', [playerId])[0]?.clause ?? null;
  const key = rank >= 0 && rank < 3;
  return { wanted: round(e.value * (key ? 1.3 : 1) * (e.yearsLeft >= 2 ? 1.05 : 1), 5_000), clause, key };
}
export function clubDecision(db: Db, playerId: number, buyer: number, fee: number): MarketResult & { counter?: number; patience?: number; byClause?: boolean } {
  const e = econOf(db, playerId);
  const w = sellerWants(db, playerId);
  if (w.clause !== null && fee >= w.clause) return { ok: true, message: `Pagas la cláusula de rescisión (${eur(w.clause)}).`, byClause: true };
  const party = -buyer;
  if (patience(db, playerId, party) <= 0) return { ok: false, message: `${clubName(db, e.club_id)} no quiere hablar más contigo de ${e.name} esta temporada.`, patience: 0 };
  if (fee >= w.wanted) return { ok: true, message: 'El club acepta.' };
  const short = (w.wanted - fee) / w.wanted;
  const left = spendPatience(db, playerId, party, short);
  return {
    ok: false,
    counter: w.wanted,
    patience: left,
    message: left <= 0
      ? `${clubName(db, e.club_id)} da por cerradas las negociaciones por ${e.name}.`
      : `${clubName(db, e.club_id)} rechaza ${eur(fee)}. Lo dejaría ir por ${eur(w.wanted)}${w.clause ? ` (cláusula: ${eur(w.clause)})` : ''}. Paciencia: ${left} %.`,
  };
}

/** Cláusula por defecto de un contrato de la IA: entre 2,4 y 4 veces su valor. */
export function defaultClause(value: number, rng: Rng) {
  return round(Math.max(150_000, value) * (2.4 + rng.next() * 1.6), 10_000);
}

/* ───────────── Movimiento de un jugador entre clubes ───────────── */

function movePlayer(db: Db, playerId: number, from: number, to: number, fee: number, kind: string) {
  const u = getUniverse(db)!;
  db.exec('UPDATE club SET cash = cash + ? WHERE id = ?', [fee, from]);
  db.exec('UPDATE club SET cash = cash - ? WHERE id = ?', [fee, to]);
  db.exec('DELETE FROM lineup WHERE player_id = ?', [playerId]);
  db.exec('DELETE FROM player_tendency WHERE player_id = ?', [playerId]);
  const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND number IS NOT NULL AND id <> ?', [to, playerId]).map((x) => x.number));
  const cur = db.rows<{ number: number | null }>('SELECT number FROM player WHERE id = ?', [playerId])[0]?.number ?? null;
  db.exec('UPDATE player SET club_id = ?, number = ? WHERE id = ?', [to, cur === null || nums.has(cur) ? freeNumber(new Rng(playerId + u.game_day), nums) : cur, playerId]);
  db.exec('UPDATE contract SET club_id = ? WHERE player_id = ?', [to, playerId]);
  const c = db.rows<{ salary: number; until: number }>('SELECT salary, until FROM contract WHERE player_id = ?', [playerId])[0];
  db.exec('INSERT INTO transfer (season, day, player_id, from_club, to_club, fee, salary, until, kind) VALUES (?,?,?,?,?,?,?,?,?)', [u.game_season, u.game_day, playerId, from, to, fee, c?.salary ?? null, c?.until ?? null, kind]);
}

/* ───────────── Ofertas de la IA por tus jugadores ───────────── */

export interface IncomingOffer { id: number; player_id: number; player: string; from_club: number; club: string; fee: number; expires_day: number; note: string | null; status: string; value: number; clause: number | null }
export function incomingOffers(db: Db): IncomingOffer[] {
  const u = getUniverse(db)!;
  return db.rows<Omit<IncomingOffer, 'value'>>(
    `SELECT o.id, o.player_id, p.name AS player, o.from_club, c.name AS club, o.fee, o.expires_day, o.note, o.status, k.clause
     FROM market_offer o JOIN player p ON p.id = o.player_id JOIN club c ON c.id = o.from_club LEFT JOIN contract k ON k.player_id = o.player_id
     WHERE o.to_club = ? AND o.season = ? AND o.status = 'pendiente' ORDER BY o.fee DESC`,
    [u.user_club_id, u.game_season],
  ).map((o) => ({ ...o, value: econOf(db, o.player_id).value }));
}

function canBuy(db: Db, buyer: number, playerId: number, fee: number, salary: number): boolean {
  const c = db.rows<{ cash: number; budget: number }>('SELECT cash, budget FROM club WHERE id = ?', [buyer])[0]!;
  const e = econOf(db, playerId);
  return fee <= c.cash && payroll(db, buyer) + salary <= c.budget * 1.05 && rosterSize(db, buyer) < 15 && !cupoAllowsIn(db, buyer, e.nationality);
}
/** Media del n-ésimo mejor jugador de un club (para saber si alguien le mejora). */
function nthBest(db: Db, clubId: number, n: number, season: number): number {
  return db.rows<{ ovr: number }>(
    'SELECT a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.club_id = ? AND p.retired = 0 ORDER BY a.ovr DESC LIMIT 1 OFFSET ?',
    [season, clubId, n - 1],
  )[0]?.ovr ?? 0;
}

/**
 * Con la ventana abierta, cada día la IA puede pujar por tus jugadores (o pagar su cláusula si es baja).
 * Devuelve noticias para el resumen del día.
 */
export function aiMarketDay(db: Db, seed: number): string[] {
  const w = windowState(db);
  const u = getUniverse(db)!;
  const ev: string[] = [];
  // Caducan las ofertas viejas o las de una ventana cerrada.
  db.exec("UPDATE market_offer SET status = 'caducada' WHERE status = 'pendiente' AND (season <> ? OR expires_day < ?)", [u.game_season, u.game_day]);
  if (!w.open) {
    db.exec("UPDATE market_offer SET status = 'caducada' WHERE status = 'pendiente'");
    return ev;
  }
  const rng = new Rng(mixSeed(seed, u.game_season * 977 + u.game_day * 13));
  if (u.user_club_id) {
    const mine = db.rows<{ id: number; ovr: number }>(
      'SELECT p.id, a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.club_id = ? AND p.retired = 0 AND p.id NOT IN (SELECT player_id FROM loan) ORDER BY a.ovr DESC',
      [u.game_season, u.user_club_id],
    );
    const pending = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM market_offer WHERE status = 'pendiente' AND to_club = ?", [u.user_club_id])[0]!.n;
    // En verano hay más movimiento; durante la temporada, alguna oferta suelta.
    if (pending < 4 && rng.chance(w.name === 'verano' ? 0.45 : 0.16)) {
      const clubs = rng.shuffle(db.rows<{ id: number; name: string; cash: number }>('SELECT id, name, cash FROM club WHERE id <> ? ORDER BY id', [u.user_club_id]));
      for (const c of clubs.slice(0, 12)) {
        const target = mine.find((p, i) => i < 9 && p.ovr >= nthBest(db, c.id, 5, u.game_season) && !db.rows("SELECT 1 FROM market_offer WHERE status = 'pendiente' AND player_id = ?", [p.id]).length);
        if (!target) continue;
        const e = econOf(db, target.id);
        if (!canBuy(db, c.id, target.id, e.value * 0.8, e.salary ?? e.ask)) continue;
        const clause = db.rows<{ clause: number | null }>('SELECT clause FROM contract WHERE player_id = ?', [target.id])[0]?.clause ?? null;
        // Cláusula baja y club con dinero: la pagan y se lo llevan.
        if (clause !== null && clause <= e.value * 2.2 && clause <= c.cash * 0.9 && rng.chance(0.35) && mine.length > ROSTER_MIN && !cupoAllowsOut(db, u.user_club_id, e.nationality)) {
          transaction(db, () => {
            movePlayer(db, target.id, u.user_club_id!, c.id, clause, 'clausula');
            addNews(db, 'venta', `${c.name} paga la cláusula de ${e.name} (${eur(clause)}) y se lo lleva.`, u.user_club_id, target.id);
          });
          ev.push(`${c.name} paga la cláusula de rescisión de ${e.name} (${eur(clause)}). Ya no es tu jugador.`);
          break;
        }
        const fee = round(e.value * (0.8 + rng.next() * 0.35), 5_000);
        if (fee > c.cash) continue;
        db.exec("INSERT INTO market_offer (season, day, player_id, from_club, to_club, fee, status, expires_day, note) VALUES (?,?,?,?,?,?, 'pendiente', ?, ?)", [
          u.game_season, u.game_day, target.id, c.id, u.user_club_id, fee, u.game_day + 6, String(round(fee * (1.08 + rng.next() * 0.14), 5_000)),
        ]);
        addNews(db, 'oferta', `${c.name} ofrece ${eur(fee)} por ${e.name}. Responde en su ficha.`, u.user_club_id, target.id, { type: 'player', id: target.id });
        ev.push(`Oferta: ${c.name} ofrece ${eur(fee)} por ${e.name}. Responde en Jugadores › Ofertas o en su ficha.`);
        break;
      }
    }
  }
  if (u.phase === 'fin' || u.game_day <= 2) ev.push(...aiTransfers(db, rng, 2));
  else if (u.game_day % 4 === 0) ev.push(...aiTransfers(db, rng, 1));
  return ev;
}

/** Responder a una oferta recibida: aceptar, rechazar o pedir más (una vez). */
export function respondOffer(db: Db, offerId: number, action: 'aceptar' | 'rechazar' | 'subir', ask?: number): MarketResult {
  const u = getUniverse(db)!;
  const o = db.rows<{ id: number; player_id: number; from_club: number; to_club: number; fee: number; status: string; note: string | null }>('SELECT * FROM market_offer WHERE id = ?', [offerId])[0];
  if (!o || o.status !== 'pendiente' || o.to_club !== u.user_club_id) return { ok: false, message: 'Esa oferta ya no está disponible.' };
  const e = econOf(db, o.player_id);
  const club = clubName(db, o.from_club);
  if (action === 'rechazar') {
    db.exec("UPDATE market_offer SET status = 'rechazada' WHERE id = ?", [offerId]);
    bumpRevision(db);
    return { ok: true, message: `Rechazas la oferta de ${club} por ${e.name}.` };
  }
  const max = Number(o.note ?? o.fee);
  let fee = o.fee;
  if (action === 'subir') {
    const want = Math.round(ask ?? 0);
    if (want <= o.fee) return { ok: false, message: 'Pide más de lo que ofrecen.' };
    if (want > max) {
      db.exec("UPDATE market_offer SET status = 'rechazada' WHERE id = ?", [offerId]);
      bumpRevision(db);
      return { ok: false, message: `${club} no llega a ${eur(want)} y se retira. (Habrían pagado hasta unos ${eur(max)}.)` };
    }
    fee = want;
  }
  if (!windowState(db).open) return closedMsg(windowState(db));
  if (rosterSize(db, o.to_club) <= ROSTER_MIN) return { ok: false, message: `No puedes quedarte con menos de ${ROSTER_MIN} jugadores.` };
  const out = cupoAllowsOut(db, o.to_club, e.nationality);
  if (out) return { ok: false, message: out };
  if (cupoAllowsIn(db, o.from_club, e.nationality) || rosterSize(db, o.from_club) >= ROSTER_MAX) return { ok: false, message: `${club} ya no puede inscribirlo.` };
  transaction(db, () => {
    movePlayer(db, o.player_id, o.to_club, o.from_club, fee, 'traspaso');
    db.exec("UPDATE market_offer SET status = 'aceptada', fee = ? WHERE id = ?", [fee, offerId]);
    db.exec("UPDATE market_offer SET status = 'caducada' WHERE status = 'pendiente' AND player_id = ?", [o.player_id]);
    addNews(db, 'venta', `${clubName(db, o.to_club)} vende a ${e.name} a ${club} por ${eur(fee)}.`, o.to_club, o.player_id);
    bumpRevision(db);
  });
  return { ok: true, message: `${e.name} se marcha a ${club}. Ingresas ${eur(fee)}.` };
}

/* ───────────── Traspasos entre clubes de la IA ───────────── */

function aiTransfers(db: Db, rng: Rng, max: number): string[] {
  const u = getUniverse(db)!;
  const ev: string[] = [];
  const buyers = rng.shuffle(db.rows<{ id: number; name: string; cash: number; budget: number }>("SELECT id, name, cash, budget FROM club WHERE id IS NOT ? AND country = 'ES' ORDER BY id", [u.user_club_id]));
  let done = 0;
  for (const b of buyers) {
    if (done >= max) break;
    if (!rng.chance(0.25)) continue;
    // Su puesto más flojo: el mejor que tiene en cada posición.
    const best: Record<string, number> = {};
    for (const r of db.rows<{ pos1: string; ovr: number }>('SELECT p.pos1, a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.club_id = ? AND p.retired = 0', [u.game_season, b.id])) best[r.pos1] = Math.max(best[r.pos1] ?? 0, r.ovr);
    const pos = (['PG', 'SG', 'SF', 'PF', 'C'] as const).reduce((a, p) => ((best[p] ?? 0) < (best[a] ?? 0) ? p : a), 'PG' as string);
    const cands = db.rows<{ id: number; club_id: number; ovr: number }>(
      `SELECT p.id, p.club_id, a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
       WHERE p.pos1 = ? AND p.club_id IS NOT NULL AND p.club_id NOT IN (?, ?) AND p.retired = 0 AND p.injury_games = 0 AND a.ovr >= ? AND p.id NOT IN (SELECT player_id FROM loan) ORDER BY a.ovr ASC LIMIT 8`,
      [u.game_season, pos, b.id, u.user_club_id ?? -1, (best[pos] ?? 0) + 3],
    );
    for (const c of cands) {
      const e = econOf(db, c.id);
      const w = sellerWants(db, c.id);
      if (w.key) continue;
      const fee = round(w.wanted * (1 + rng.next() * 0.1), 5_000);
      if (!canBuy(db, b.id, c.id, fee, e.salary ?? e.ask) || fee > b.cash * 0.6) continue;
      if (rosterSize(db, c.club_id) <= 11 || cupoAllowsOut(db, c.club_id, e.nationality)) continue;
      transaction(db, () => {
        movePlayer(db, c.id, c.club_id, b.id, fee, 'traspaso');
        addNews(db, 'fichaje', `${b.name} ficha a ${e.name} (${clubName(db, c.club_id)}) por ${eur(fee)}.`, b.id, c.id);
      });
      ev.push(`${b.name} ficha a ${e.name} por ${eur(fee)}.`);
      done++;
      break;
    }
  }
  return ev;
}

/* ───────────── Intercambios ───────────── */

export interface TradeProposal { give: number[]; get: number; cash: number }
/** Cómo valora el otro club lo que le das: entero si entraría en su rotación de 8; si no, el 60 %. */
export function tradeValue(db: Db, p: TradeProposal) {
  const u = getUniverse(db)!;
  const target = econOf(db, p.get);
  const other = target.club_id!;
  const eighth = nthBest(db, other, 8, u.game_season);
  const parts = p.give.map((id) => {
    const e = econOf(db, id);
    const f = e.econ.ovr >= eighth ? 1 : 0.6;
    return { id, name: e.name, value: e.value, counted: round(e.value * f, 5_000), salary: e.salary ?? 0 };
  });
  const offered = parts.reduce((a, x) => a + x.counted, 0) + Math.max(0, p.cash);
  const w = sellerWants(db, p.get);
  return { other, parts, offered, wanted: round(w.wanted * 1.05, 5_000), target: { id: target.id, name: target.name, value: target.value, salary: target.salary ?? 0 } };
}

export function proposeTrade(db: Db, p: TradeProposal): MarketResult & { counter?: number } {
  const u = getUniverse(db)!;
  const me = u.user_club_id!;
  const w = windowState(db);
  if (!w.open) return closedMsg(w);
  if (!p.give.length && p.cash <= 0) return { ok: false, message: 'Ofrece al menos un jugador o dinero.' };
  const target = econOf(db, p.get);
  if (target.club_id === null || target.club_id === me) return { ok: false, message: 'Elige un jugador de otro club.' };
  const other = target.club_id;
  for (const id of p.give) if (econOf(db, id).club_id !== me) return { ok: false, message: 'Solo puedes ofrecer jugadores tuyos.' };
  const cash = Math.max(0, Math.round(p.cash));
  const myCash = db.rows<{ cash: number; budget: number }>('SELECT cash, budget FROM club WHERE id = ?', [me])[0]!;
  if (cash > myCash.cash) return { ok: false, message: `No tienes esa caja: dispones de ${eur(myCash.cash)}.` };
  // Plantillas y cupos después del cambio.
  const mySize = rosterSize(db, me) - p.give.length + 1;
  const otherSize = rosterSize(db, other) + p.give.length - 1;
  if (mySize > ROSTER_MAX || otherSize > ROSTER_MAX) return { ok: false, message: 'Alguna plantilla pasaría de 16 jugadores.' };
  if (mySize < ROSTER_MIN || otherSize < ROSTER_MIN) return { ok: false, message: `Alguna plantilla bajaría de ${ROSTER_MIN} jugadores.` };
  const nat = (id: number) => econOf(db, id).nationality;
  const cupoAfter = (clubId: number, out: number[], inn: number[]) => {
    const ids = db.rows<{ id: number }>('SELECT id FROM player WHERE club_id = ? AND retired = 0', [clubId]).map((x) => x.id).filter((x) => !out.includes(x));
    const all = [...ids.map(nat), ...inn.map(nat)].map(cupoOf);
    return { nac: all.filter((x) => x === 'NAC').length, ext: all.filter((x) => x === 'EXT').length };
  };
  const mine = cupoAfter(me, p.give, [p.get]);
  if (mine.nac < CUPO_RULES.minNac) return { ok: false, message: `Te quedarías con menos de ${CUPO_RULES.minNac} nacionales.` };
  if (mine.ext > CUPO_RULES.maxExt) return { ok: false, message: `Tendrías más de ${CUPO_RULES.maxExt} extracomunitarios.` };
  const isEs = db.rows<{ country: string }>('SELECT country FROM club WHERE id = ?', [other])[0]?.country === 'ES';
  if (isEs) {
    const theirs = cupoAfter(other, [p.get], p.give);
    if (theirs.nac < CUPO_RULES.minNac || theirs.ext > CUPO_RULES.maxExt) return { ok: false, message: `${clubName(db, other)} no puede: rompería sus cupos.` };
  }
  // Sueldos: los dos clubes tienen que poder pagar lo que entra.
  const salIn = target.salary ?? 0;
  const salOut = p.give.reduce((a, id) => a + (econOf(db, id).salary ?? 0), 0);
  if (payroll(db, me) - salOut + salIn > myCash.budget) return { ok: false, message: 'Con ese cambio te pasas del presupuesto salarial.' };
  const theirBudget = db.rows<{ budget: number }>('SELECT budget FROM club WHERE id = ?', [other])[0]!.budget;
  if (payroll(db, other) - salIn + salOut > theirBudget * 1.05) return { ok: false, message: `${clubName(db, other)} no puede asumir esos sueldos.` };
  const party = -me;
  if (patience(db, p.get, party) <= 0) return { ok: false, message: `${clubName(db, other)} no quiere hablar más de ${target.name} esta temporada.` };
  const v = tradeValue(db, p);
  if (v.offered < v.wanted) {
    const left = spendPatience(db, p.get, party, (v.wanted - v.offered) / v.wanted);
    return {
      ok: false,
      counter: v.wanted - v.offered + cash,
      message: left <= 0
        ? `${clubName(db, other)} da por cerradas las negociaciones por ${target.name}.`
        : `${clubName(db, other)} lo rechaza: valora lo que ofreces en ${eur(v.offered)} y quiere ${eur(v.wanted)}. Añadiendo ${eur(v.wanted - v.offered)} en dinero, aceptaría. Paciencia: ${left} %.`,
    };
  }
  transaction(db, () => {
    movePlayer(db, p.get, other, me, 0, 'cambio');
    for (const id of p.give) movePlayer(db, id, me, other, 0, 'cambio');
    if (cash) {
      db.exec('UPDATE club SET cash = cash - ? WHERE id = ?', [cash, me]);
      db.exec('UPDATE club SET cash = cash + ? WHERE id = ?', [cash, other]);
    }
    db.exec('UPDATE player SET morale = MAX(0, morale - 6) WHERE id IN (' + [p.get, ...p.give].join(',') + ')');
    const names = p.give.map((id) => econOf(db, id).name).join(' y ');
    addNews(db, 'cambio', `Intercambio: ${target.name} llega desde ${clubName(db, other)}${names ? ` a cambio de ${names}` : ''}${cash ? ` y ${eur(cash)}` : ''}.`, me, p.get);
    bumpRevision(db);
  });
  return { ok: true, message: `¡Hecho! ${target.name} es tu jugador.` };
}

/** Datos para la pantalla de mercado. */
export function marketOverview(db: Db) {
  return { window: windowState(db), offers: incomingOffers(db) };
}

export { marketValue, askSalary };
