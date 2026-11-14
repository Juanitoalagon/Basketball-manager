/**
 * Calendario de la temporada. Cada «día» del juego es una fecha real y ningún club juega dos veces el mismo día:
 *  - Liga (ACB y Primera FEB): sábados, 34 jornadas desde el primer sábado de octubre.
 *  - Europa: miércoles de las semanas impares 1-27 (14 jornadas de grupos); cuartos, semifinales y final
 *    los miércoles de las semanas 30, 32 y 33.
 *  - Copa del Rey: una semana propia tras la jornada 17 (sin liga ese fin de semana): cuartos el jueves,
 *    semifinales el sábado y final el domingo.
 *  - Playoffs ACB: desde el martes siguiente a la última jornada, un partido cada dos días.
 */
import { type Db, getSetting, setSetting } from './schema';

export type SlotKind = 'liga' | 'euro' | 'copa' | 'euroko' | 'playoffs';
export interface Slot { day: number; date: string; kind: SlotKind; round: number }
export interface SeasonCalendar {
  slots: Slot[];
  /** league[r] = día de la jornada r (1-34). */
  league: number[];
  /** euro[k] = día de la jornada k de grupos (1-14). */
  euro: number[];
  copa: number[];
  euroKo: number[];
  playoffs: number[];
}

export const LEAGUE_ROUNDS = 34;
export const EURO_ROUNDS = 14;
const EURO_WEEKS = Array.from({ length: EURO_ROUNDS }, (_, i) => 2 * i + 1); // 1, 3, … 27
const EURO_KO_WEEKS = [30, 32, 33];
const COPA_AFTER = 17;

const cache = new Map<number, SeasonCalendar>();

function firstSaturdayOfOctober(year: number): Date {
  const d = new Date(Date.UTC(year, 9, 1));
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function seasonCalendar(season: number): SeasonCalendar {
  const hit = cache.get(season);
  if (hit) return hit;
  const raw: { date: Date; kind: SlotKind; round: number }[] = [];
  let sat = firstSaturdayOfOctober(season);
  for (let w = 1; w <= LEAGUE_ROUNDS; w++) {
    const ek = EURO_WEEKS.indexOf(w);
    if (ek >= 0) raw.push({ date: plus(sat, -3), kind: 'euro', round: ek + 1 });
    const ko = EURO_KO_WEEKS.indexOf(w);
    if (ko >= 0) raw.push({ date: plus(sat, -3), kind: 'euroko', round: ko + 1 });
    raw.push({ date: sat, kind: 'liga', round: w });
    sat = plus(sat, 7);
    if (w === COPA_AFTER) {
      // Semana de la Copa: no hay liga ese fin de semana.
      raw.push({ date: plus(sat, -2), kind: 'copa', round: 1 });
      raw.push({ date: sat, kind: 'copa', round: 2 });
      raw.push({ date: plus(sat, 1), kind: 'copa', round: 3 });
      sat = plus(sat, 7);
    }
  }
  // Playoffs: hasta 13 partidos (3 + 5 + 5), uno cada dos días.
  const lastSat = plus(sat, -7);
  for (let i = 0; i < 16; i++) raw.push({ date: plus(lastSat, 3 + 2 * i), kind: 'playoffs', round: i + 1 });
  raw.sort((a, b) => a.date.getTime() - b.date.getTime());
  const slots = raw.map((s, i) => ({ day: i + 1, date: iso(s.date), kind: s.kind, round: s.round }));
  const pick = (k: SlotKind) => slots.filter((s) => s.kind === k).sort((a, b) => a.round - b.round).map((s) => s.day);
  const cal: SeasonCalendar = { slots, league: [0, ...pick('liga')], euro: [0, ...pick('euro')], copa: pick('copa'), euroKo: pick('euroko'), playoffs: pick('playoffs') };
  cache.set(season, cal);
  return cal;
}

export function dateOfDay(season: number, day: number): string | null {
  return seasonCalendar(season).slots[day - 1]?.date ?? null;
}

/** Última jornada de liga ya jugada (0 en pretemporada). */
export function leagueRoundPlayed(db: Db, season: number): number {
  return Number(db.rows<{ r: number | null }>("SELECT MAX(round) AS r FROM game WHERE season = ? AND competition_id = 1 AND stage = 'regular' AND status = 'jugado'", [season])[0]?.r ?? 0);
}

/** Siguiente día de una eliminatoria después de `day`. */
export function nextKoDay(season: number, comp: number, day: number): number {
  const cal = seasonCalendar(season);
  const list = comp === 3 ? cal.copa : comp >= 4 ? cal.euroKo : cal.playoffs;
  return list.find((d) => d > day) ?? day + 1;
}

/**
 * Partidas de versiones anteriores: el calendario viejo ponía Europa y liga el mismo día.
 * Se recolocan los partidos de la temporada en curso con el calendario nuevo (el orden se conserva).
 */
export function migrateCalendar(db: Db): void {
  if (getSetting(db, 'calendar') === '2') return;
  const u = db.rows<{ game_season: number }>('SELECT game_season FROM universe')[0];
  if (!u) {
    setSetting(db, 'calendar', '2');
    return;
  }
  const season = u.game_season;
  const cal = seasonCalendar(season);
  const map = (stage: string, day: number, round: number | null): number => {
    if (stage === 'regular') return cal.league[Math.min(LEAGUE_ROUNDS, round ?? day)] ?? day;
    if (stage === 'grupos') return cal.euro[Math.min(EURO_ROUNDS, Math.max(1, Math.round(day / 2)))] ?? day;
    if (stage === 'copa') return cal.copa[Math.min(2, Math.max(0, day - 18))] ?? day;
    if (stage === 'eliminatoria') return cal.euroKo[day <= 30 ? 0 : day <= 32 ? 1 : 2] ?? day;
    return cal.playoffs[Math.max(0, day - 35)] ?? day; // playoffs
  };
  for (const g of db.rows<{ id: number; stage: string; day: number; round: number | null }>('SELECT id, stage, day, round FROM game WHERE season = ?', [season])) {
    const nd = map(g.stage, g.day, g.round);
    const round = g.stage === 'grupos' ? Math.max(1, Math.round(g.day / 2)) : g.round;
    db.exec('UPDATE game SET day = ?, round = ? WHERE id = ?', [nd, round, g.id]);
  }
  const played = db.rows<{ d: number | null }>("SELECT MAX(day) AS d FROM game WHERE season = ? AND status = 'jugado'", [season])[0]?.d ?? 0;
  db.exec('UPDATE universe SET game_day = ?', [played ?? 0]);
  setSetting(db, 'calendar', '2');
}
