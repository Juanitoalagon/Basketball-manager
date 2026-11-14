/**
 * Promesas y peticiones de salida (v0.9).
 *
 * Promesa: al fichar o renovar le prometes un papel (titular, rotación o unos minutos). A cambio pide menos:
 *   titular (25 min) −10 %, rotación (17 min) −5 %, minutos N: −10 % con 25 o más, −5 % con 17 o más, −2 % con 10 o más.
 * Tras cada partido se miran sus minutos de los últimos 5: si juega 4 o más por debajo de lo prometido,
 * suma un aviso (y −3 de moral); si cumple, se le quita uno. Con 5 avisos la promesa está rota: −15 de moral,
 * pide salir y ya no se cree tus promesas (no hay rebaja con él).
 *
 * Petición de salida: 8 partidos seguidos con la moral por debajo de 35 (o una promesa rota).
 * Mientras quiere salir rinde algo menos (−3 en todos sus atributos). Opciones: ponerlo en venta (le llegan más
 * ofertas), prometerle minutos (vuelve a estar contento si cumples) o hablar con él (sale bien con probabilidad
 * 0,35 + liderazgo / 200 + moral / 300; una vez cada 6 días).
 */
import { type Db, bumpRevision, transaction } from './schema';
import { getUniverse } from './season';
import { addNews, type MarketResult } from './market';

export type PromiseKind = 'titular' | 'rotacion' | 'minutos';
export interface PromiseTerms { kind: PromiseKind; minutes: number }
export const PROMISE_LABEL: Record<PromiseKind, string> = { titular: 'Titular', rotacion: 'Rotación', minutos: 'Minutos' };

export function promiseMinutes(t: PromiseTerms): number {
  return t.kind === 'titular' ? 25 : t.kind === 'rotacion' ? 17 : Math.max(5, Math.min(34, Math.round(t.minutes)));
}
export function promiseDiscount(t: PromiseTerms | null | undefined): number {
  if (!t) return 0;
  const m = promiseMinutes(t);
  return m >= 25 ? 0.1 : m >= 17 ? 0.05 : m >= 10 ? 0.02 : 0;
}
/** ¿Se fía todavía de tus promesas? Si le rompiste una, no. */
export function trustsPromises(db: Db, playerId: number, clubId: number): boolean {
  return !db.rows('SELECT 1 FROM promise WHERE player_id = ? AND club_id = ? AND broken = 1', [playerId, clubId]).length;
}
/** Rebaja efectiva para este jugador con este club. */
export function effectiveDiscount(db: Db, playerId: number, clubId: number, t: PromiseTerms | null | undefined): number {
  return t && trustsPromises(db, playerId, clubId) ? promiseDiscount(t) : 0;
}

export function makePromise(db: Db, playerId: number, clubId: number, t: PromiseTerms) {
  const u = getUniverse(db)!;
  const season = u.phase === 'fin' ? u.game_season + 1 : u.game_season;
  db.exec('INSERT OR REPLACE INTO promise (player_id, club_id, season, kind, minutes, strikes, broken) VALUES (?,?,?,?,?,0,0)', [playerId, clubId, season, t.kind, promiseMinutes(t)]);
}

export function promiseOf(db: Db, playerId: number) {
  return db.rows<{ club_id: number; season: number; kind: PromiseKind; minutes: number; strikes: number; broken: number }>('SELECT club_id, season, kind, minutes, strikes, broken FROM promise WHERE player_id = ?', [playerId])[0] ?? null;
}

/**
 * Tras un partido del club del usuario: revisa promesas y descontento. Devuelve el ajuste de moral de cada
 * jugador y una nota. `mins` son los minutos medios recientes y `injured` los lesionados (no cuentan).
 */
export function reviewPromises(db: Db, clubId: number, mins: Map<number, number>, injured: Set<number>): Map<number, { delta: number; note: string | null }> {
  const u = getUniverse(db)!;
  const out = new Map<number, { delta: number; note: string | null }>();
  for (const p of db.rows<{ player_id: number; minutes: number; strikes: number; broken: number; season: number; name: string }>(
    'SELECT k.player_id, k.minutes, k.strikes, k.broken, k.season, p.name FROM promise k JOIN player p ON p.id = k.player_id WHERE k.club_id = ? AND p.club_id = ?',
    [clubId, clubId],
  )) {
    if (p.broken || p.season !== u.game_season || injured.has(p.player_id)) continue;
    const got = mins.get(p.player_id) ?? 0;
    if (got < p.minutes - 4) {
      const strikes = p.strikes + 1;
      if (strikes >= 5) {
        db.exec('UPDATE promise SET strikes = ?, broken = 1 WHERE player_id = ?', [strikes, p.player_id]);
        db.exec('UPDATE player SET wants_out = 1 WHERE id = ?', [p.player_id]);
        addNews(db, 'peticion', `${p.name} se siente engañado: le prometiste unos ${p.minutes} minutos y juega ${got.toFixed(0)}. Pide salir.`, clubId, p.player_id, { type: 'request', id: p.player_id });
        out.set(p.player_id, { delta: -15, note: `No cumpliste tu promesa (${p.minutes} min): quiere irse` });
      } else {
        db.exec('UPDATE promise SET strikes = ? WHERE player_id = ?', [strikes, p.player_id]);
        if (strikes === 3) addNews(db, 'moral', `${p.name} te recuerda que le prometiste unos ${p.minutes} minutos (juega ${got.toFixed(0)}).`, clubId, p.player_id, { type: 'player', id: p.player_id });
        out.set(p.player_id, { delta: -3, note: `Le prometiste ${p.minutes} min y juega ${got.toFixed(0)}` });
      }
    } else if (p.strikes > 0) {
      db.exec('UPDATE promise SET strikes = strikes - 1 WHERE player_id = ?', [p.player_id]);
    }
  }
  return out;
}

/** Cuenta los partidos seguidos con la moral baja y, si se alarga, el jugador pide salir. */
export function trackUnhappiness(db: Db, clubId: number, playerId: number, name: string, morale: number) {
  if (morale < 35) {
    const p = db.rows<{ unhappy: number; wants_out: number }>('SELECT unhappy, wants_out FROM player WHERE id = ?', [playerId])[0]!;
    const n = p.unhappy + 1;
    db.exec('UPDATE player SET unhappy = ? WHERE id = ?', [n, playerId]);
    if (n >= 8 && !p.wants_out) {
      db.exec('UPDATE player SET wants_out = 1 WHERE id = ?', [playerId]);
      addNews(db, 'peticion', `${name} pide salir: lleva semanas descontento. Puedes venderlo, prometerle minutos o hablar con él.`, clubId, playerId, { type: 'request', id: playerId });
    }
  } else {
    db.exec('UPDATE player SET unhappy = MAX(0, unhappy - 1) WHERE id = ?', [playerId]);
  }
}

/** Respuesta del entrenador a una petición de salida. */
export function handleRequest(db: Db, playerId: number, action: 'vender' | 'prometer' | 'hablar' | 'quitar', minutes?: number): MarketResult {
  const u = getUniverse(db)!;
  const p = db.rows<{ name: string; club_id: number | null; wants_out: number; morale: number; lead: number; last_talk: number | null; listed: number }>(
    'SELECT p.name, p.club_id, p.wants_out, p.morale, a.lead, p.last_talk, p.listed FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.id = ?',
    [u.game_season, playerId],
  )[0];
  if (!p || p.club_id !== u.user_club_id) return { ok: false, message: 'No es jugador tuyo.' };
  return transaction(db, () => {
    let r: MarketResult;
    if (action === 'vender') {
      db.exec('UPDATE player SET listed = 1 WHERE id = ?', [playerId]);
      r = { ok: true, message: `${p.name} está en la lista de transferibles: le llegarán más ofertas (y algo más baratas).` };
    } else if (action === 'quitar') {
      db.exec('UPDATE player SET listed = 0 WHERE id = ?', [playerId]);
      r = { ok: true, message: `${p.name} sale de la lista de transferibles.` };
    } else if (action === 'prometer') {
      if (!trustsPromises(db, playerId, p.club_id!)) {
        r = { ok: false, message: `${p.name} ya no se cree tus promesas.` };
      } else {
        makePromise(db, playerId, p.club_id!, { kind: 'minutos', minutes: minutes ?? 20 });
        db.exec('UPDATE player SET wants_out = 0, unhappy = 0, morale = MIN(100, morale + 10), mood_note = ? WHERE id = ?', [`Le has prometido unos ${minutes ?? 20} minutos`, playerId]);
        r = { ok: true, message: `${p.name} se queda… si le das unos ${minutes ?? 20} minutos. Pon sus minutos en Quinteto.` };
      }
    } else {
      if (p.last_talk !== null && u.game_day - p.last_talk < 6 && u.game_day >= p.last_talk) {
        r = { ok: false, message: `Ya hablaste con ${p.name} hace poco. Espera unos días.` };
      } else {
        db.exec('UPDATE player SET last_talk = ? WHERE id = ?', [u.game_day, playerId]);
        const chance = 0.35 + p.lead / 200 + p.morale / 300;
        const roll = ((playerId * 9301 + u.game_day * 49297 + u.game_season) % 233280) / 233280;
        if (roll < chance) {
          db.exec('UPDATE player SET wants_out = 0, unhappy = 0, morale = MIN(100, morale + 12), mood_note = ? WHERE id = ?', ['Ha hablado con el entrenador y está más tranquilo', playerId]);
          r = { ok: true, message: `Buena charla: ${p.name} se calma y se compromete con el equipo.` };
        } else {
          db.exec('UPDATE player SET morale = MAX(0, morale - 5) WHERE id = ? ', [playerId]);
          r = { ok: false, message: `${p.name} no queda convencido. Sigue queriendo salir.` };
        }
      }
    }
    bumpRevision(db);
    return r;
  });
}
