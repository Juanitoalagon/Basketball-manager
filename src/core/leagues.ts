/**
 * Ligas nacionales de otros países (v0.9): Francia, Italia, Alemania, Turquía, Grecia, NBA y NCAA.
 *
 * Se juegan con «simulación rápida»: no hay jugada a jugada, solo el resultado (según el nivel de cada
 * equipo, el factor cancha y algo de azar) y unas estadísticas de temporada repartidas entre los jugadores
 * según sus minutos y sus atributos. Cuesta una fracción de milisegundo por partido y ocupa una fila.
 *
 * Los clubes llevan nombres públicos; las plantillas son inventadas. Los partidos se guardan en la tabla
 * game con estado 'rapido' hasta que se simulan (así nunca se confunden con los partidos completos, que
 * van con estado 'pendiente') y con su propia fecha (columna date).
 */
import { ATTR_KEYS, type Attrs, type NewPlayer, POSITIONS, type Pos, generatePlayer } from './attributes';
import { generateRoster } from './generate';
import { BOX_FIELDS } from './engine';
import { makeName } from './names';
import { Rng, mixSeed } from './rng';
import type { Db } from './schema';
import { dateOfDay, seasonCalendar } from './calendar';
import { freeNumber, getUniverse, insertPlayer, roundRobin, standings } from './season';
import { creditGate } from './finance';

export const NBA = 12;
export const NCAA = 13;

interface ClubSeed { name: string; short: string; city: string; strength: number; colors: [string, string, string] }
export interface LeagueDef {
  id: number; name: string; short: string; country: string;
  /** Equipos que juegan los playoffs y partidos de cada ronda (mejor de N). */
  po: number; bestOf: number[];
  /** Puntos medios por equipo y minutos totales de equipo por partido. */
  pts: number; minutes: number; home: number;
  /** Plantilla: nacionalidad local (fracción) y nivel base (sobre la primera división, 61 de media). */
  local: number;
  /** Fechas de la fase regular: 'sabados' (como la ACB, para no chocar con Europa) o 'libre'. */
  dates: 'sabados' | 'libre';
  clubs: ClubSeed[];
}

const C = (name: string, short: string, city: string, strength: number, c1: string, c2 = '#ffffff', c3 = '#111111'): ClubSeed => ({ name, short, city, strength, colors: [c1, c2, c3] });

/** Los clubes extranjeros que ya juegan en Europa entran en la liga de su país; aquí, los que faltan. */
export const LEAGUES: LeagueDef[] = [
  {
    id: 7, name: 'Betclic ÉLITE (Francia)', short: 'FRA', country: 'FR', po: 8, bestOf: [3, 5, 5], pts: 82, minutes: 200, home: 3, local: 0.5, dates: 'sabados',
    clubs: [
      C('LDLC ASVEL', 'ASV', 'Villeurbanne', 2, '#0b2a6b', '#c8102e'), C('Cholet Basket', 'CHO', 'Cholet', -3, '#c8102e'),
      C('SIG Strasbourg', 'SIG', 'Estrasburgo', -2, '#c8102e', '#111111'), C('JDA Dijon', 'DIJ', 'Dijon', -2, '#c8102e', '#111111'),
      C('Limoges CSP', 'LIM', 'Limoges', -3, '#0b7a3e'), C('JL Bourg', 'JLB', 'Bourg-en-Bresse', -2, '#c8102e', '#ffffff'),
      C('BCM Gravelines-Dunkerque', 'BCM', 'Gravelines', -4, '#0b2a6b', '#f6d200'), C('Saint-Quentin Basket', 'SQB', 'Saint-Quentin', -4, '#0b2a6b'),
      C('Élan Chalon', 'ELC', 'Chalon-sur-Saône', -4, '#c8102e', '#0b2a6b'), C('ESSM Le Portel', 'ESS', 'Le Portel', -5, '#e30613'),
      C('Metropolitans 92', 'M92', 'Boulogne-Levallois', -3, '#111111', '#7ec8f2'), C('SLUC Nancy', 'SLU', 'Nancy', -5, '#0b7a3e', '#c8102e'),
    ],
  },
  {
    id: 8, name: 'Serie A (Italia)', short: 'ITA', country: 'IT', po: 8, bestOf: [5, 5, 7], pts: 81, minutes: 200, home: 3, local: 0.5, dates: 'sabados',
    clubs: [
      C('Germani Brescia', 'BRS', 'Brescia', -1, '#0b2a6b'), C('Derthona Tortona', 'DER', 'Tortona', -2, '#0b2a6b', '#7ec8f2'),
      C('Napoli Basket', 'NAP', 'Nápoles', -4, '#4fa3e0'), C('Pallacanestro Reggiana', 'REG', 'Reggio Emilia', -3, '#7a1f2b'),
      C('Pallacanestro Trieste', 'TRI', 'Trieste', -3, '#c8102e'), C('Nutribullet Treviso', 'TRV', 'Treviso', -4, '#0b7a3e'),
      C('Pallacanestro Varese', 'VAR', 'Varese', -4, '#c8102e', '#ffffff'), C('Vanoli Cremona', 'CRM', 'Cremona', -5, '#0b2a6b', '#c8102e'),
      C('Estra Pistoia', 'PIS', 'Pistoia', -5, '#c8102e'), C('Givova Scafati', 'SCA', 'Scafati', -5, '#111111', '#f6d200'),
      C('Trapani Shark', 'TRA', 'Trapani', -2, '#c8102e', '#111111'),
    ],
  },
  {
    id: 9, name: 'BBL (Alemania)', short: 'GER', country: 'DE', po: 8, bestOf: [5, 5, 5], pts: 84, minutes: 200, home: 3, local: 0.5, dates: 'sabados',
    clubs: [
      C('ALBA Berlin', 'BER', 'Berlín', 1, '#f6d200', '#0b2a6b'), C('Telekom Baskets Bonn', 'BON', 'Bonn', -2, '#e20074', '#ffffff'),
      C('EWE Baskets Oldenburg', 'OLD', 'Oldemburgo', -3, '#0b2a6b', '#ffffff'), C('Bamberg Baskets', 'BMB', 'Bamberg', -3, '#0b2a6b', '#ffffff'),
      C('MHP Riesen Ludwigsburg', 'LUD', 'Ludwigsburgo', -3, '#f47b20', '#111111'), C('Würzburg Baskets', 'WUR', 'Wurzburgo', -2, '#0b2a6b', '#7ec8f2'),
      C('BG Göttingen', 'GOT', 'Gotinga', -5, '#7a1f6b'), C('Basketball Löwen Braunschweig', 'BRA', 'Brunswick', -5, '#c8102e', '#f6d200'),
      C('MLP Academics Heidelberg', 'HEI', 'Heidelberg', -5, '#0b2a6b', '#c8102e'), C('Rasta Vechta', 'VEC', 'Vechta', -4, '#f6d200', '#111111'),
      C('Syntainics MBC', 'MBC', 'Weißenfels', -5, '#0b7a3e', '#ffffff'), C('Rostock Seawolves', 'ROS', 'Rostock', -4, '#0b2a6b', '#7ec8f2'),
      C('Skyliners Frankfurt', 'FRK', 'Fráncfort', -5, '#111111', '#7ec8f2'), C('medi Bayreuth', 'BYR', 'Bayreuth', -6, '#f6d200', '#0b2a6b'),
    ],
  },
  {
    id: 10, name: 'Süper Lig (Turquía)', short: 'TUR', country: 'TR', po: 8, bestOf: [3, 5, 7], pts: 82, minutes: 200, home: 3, local: 0.5, dates: 'sabados',
    clubs: [
      C('Beşiktaş', 'BJK', 'Estambul', 0, '#111111', '#ffffff'), C('Darüşşafaka', 'DAR', 'Estambul', -3, '#f6d200', '#0b2a6b'),
      C('Bursaspor', 'BSP', 'Bursa', -3, '#0b7a3e', '#ffffff'), C('Manisa Basket', 'MNS', 'Manisa', -3, '#0b2a6b', '#c8102e'),
      C('Aliağa Petkimspor', 'PET', 'Esmirna', -4, '#0b2a6b', '#7ec8f2'), C('Büyükçekmece', 'BUY', 'Estambul', -5, '#c8102e'),
      C('Mersin MSK', 'MER', 'Mersin', -4, '#0b2a6b', '#ffffff'), C('Merkezefendi', 'MRK', 'Denizli', -5, '#0b2a6b', '#f6d200'),
      C('Esenler Erokspor', 'ESE', 'Estambul', -5, '#f47b20', '#111111'),
    ],
  },
  {
    id: 11, name: 'Basket League (Grecia)', short: 'GRE', country: 'GR', po: 8, bestOf: [3, 3, 5], pts: 79, minutes: 200, home: 3, local: 0.55, dates: 'sabados',
    clubs: [
      C('PAOK', 'PAK', 'Salónica', -2, '#111111', '#ffffff'), C('Aris', 'ARS', 'Salónica', -2, '#f6d200', '#111111'),
      C('Promitheas Patras', 'PRO', 'Patras', -4, '#0b2a6b', '#f6d200'), C('Kolossos Rodou', 'KOL', 'Rodas', -5, '#c8102e', '#0b2a6b'),
      C('Lavrio', 'LAV', 'Laurión', -5, '#f6d200', '#0b2a6b'), C('Maroussi', 'MRS', 'Maroussi', -6, '#0b2a6b', '#ffffff'),
      C('Karditsa', 'KAR', 'Karditsa', -6, '#0b7a3e', '#ffffff'), C('Panionios', 'PNI', 'Atenas', -6, '#c8102e', '#0b2a6b'),
    ],
  },
  {
    id: NBA, name: 'NBA', short: 'NBA', country: 'US', po: 16, bestOf: [7, 7, 7, 7], pts: 113, minutes: 240, home: 2.5, local: 0.72, dates: 'libre',
    clubs: [
      C('Atlanta Hawks', 'ATL', 'Atlanta', 14, '#e03a3e', '#c1d32f'), C('Boston Celtics', 'BOS', 'Boston', 17, '#007a33', '#ffffff'),
      C('Brooklyn Nets', 'BKN', 'Nueva York', 12, '#111111', '#ffffff'), C('Charlotte Hornets', 'CHA', 'Charlotte', 13, '#1d1160', '#00788c'),
      C('Chicago Bulls', 'CHI', 'Chicago', 14, '#ce1141', '#111111'), C('Cleveland Cavaliers', 'CLE', 'Cleveland', 16, '#860038', '#fdbb30'),
      C('Dallas Mavericks', 'DAL', 'Dallas', 15, '#00538c', '#b8c4ca'), C('Denver Nuggets', 'DEN', 'Denver', 16, '#0e2240', '#fec524'),
      C('Detroit Pistons', 'DET', 'Detroit', 14, '#c8102e', '#1d42ba'), C('Golden State Warriors', 'GSW', 'San Francisco', 15, '#1d428a', '#ffc72c'),
      C('Houston Rockets', 'HOU', 'Houston', 16, '#ce1141', '#ffffff'), C('Indiana Pacers', 'IND', 'Indianápolis', 15, '#002d62', '#fdbb30'),
      C('Los Angeles Clippers', 'LAC', 'Los Ángeles', 15, '#c8102e', '#1d428a'), C('Los Angeles Lakers', 'LAL', 'Los Ángeles', 15, '#552583', '#fdb927'),
      C('Memphis Grizzlies', 'MEM', 'Memphis', 14, '#5d76a9', '#12173f'), C('Miami Heat', 'MIA', 'Miami', 14, '#98002e', '#f9a01b'),
      C('Milwaukee Bucks', 'MKE', 'Milwaukee', 15, '#00471b', '#eee1c6'), C('Minnesota Timberwolves', 'MIN', 'Minneapolis', 16, '#0c2340', '#78be20'),
      C('New Orleans Pelicans', 'NOP', 'Nueva Orleans', 13, '#0c2340', '#c8102e'), C('New York Knicks', 'NYK', 'Nueva York', 16, '#006bb6', '#f58426'),
      C('Oklahoma City Thunder', 'OKC', 'Oklahoma City', 17, '#007ac1', '#ef3b24'), C('Orlando Magic', 'ORL', 'Orlando', 15, '#0077c0', '#c4ced4'),
      C('Philadelphia 76ers', 'PHI', 'Filadelfia', 14, '#006bb6', '#ed174c'), C('Phoenix Suns', 'PHX', 'Phoenix', 14, '#1d1160', '#e56020'),
      C('Portland Trail Blazers', 'POR', 'Portland', 13, '#e03a3e', '#111111'), C('Sacramento Kings', 'SAC', 'Sacramento', 13, '#5a2d81', '#63727a'),
      C('San Antonio Spurs', 'SPU', 'San Antonio', 14, '#111111', '#c4ced4'), C('Toronto Raptors', 'TOR', 'Toronto', 13, '#ce1141', '#111111'),
      C('Utah Jazz', 'UTA', 'Salt Lake City', 12, '#002b5c', '#f9a01b'), C('Washington Wizards', 'WAS', 'Washington', 12, '#002b5c', '#e31837'),
    ],
  },
  {
    id: NCAA, name: 'NCAA', short: 'NCAA', country: 'US', po: 8, bestOf: [1, 1, 1], pts: 72, minutes: 200, home: 3.5, local: 0.5, dates: 'libre',
    clubs: [
      C('Duke', 'DUK', 'Durham', 6, '#003087'), C('Kentucky', 'KEN', 'Lexington', 5, '#0033a0'),
      C('North Carolina', 'UNC', 'Chapel Hill', 5, '#7bafd4', '#ffffff', '#13294b'), C('Kansas', 'KAN', 'Lawrence', 5, '#0051ba', '#e8000d'),
      C('UCLA', 'UCL', 'Los Ángeles', 4, '#2d68c4', '#f2a900'), C('Gonzaga', 'GON', 'Spokane', 4, '#002967', '#c8102e'),
      C('UConn', 'UCO', 'Storrs', 5, '#000e2f', '#ffffff'), C('Villanova', 'VIL', 'Villanova', 3, '#00205b', '#13b5ea'),
      C('Michigan State', 'MSU', 'East Lansing', 3, '#18453b'), C('Arizona', 'ARI', 'Tucson', 4, '#cc0033', '#003366'),
      C('Houston', 'UHO', 'Houston', 4, '#c8102e'), C('Purdue', 'PUR', 'West Lafayette', 3, '#111111', '#cfb991'),
      C('Indiana', 'IND2', 'Bloomington', 2, '#990000'), C('Syracuse', 'SYR', 'Syracuse', 2, '#f76900', '#000e54'),
      C('Louisville', 'LOU', 'Louisville', 2, '#ad0000', '#111111'), C('Texas', 'TEX', 'Austin', 3, '#bf5700'),
    ],
  },
];
export const LEAGUE_BY_ID = new Map(LEAGUES.map((l) => [l.id, l]));
/** Equipos que juegan los playoffs en cada liga extranjera (para la clasificación). */
export const PO_SIZE: Record<number, number> = Object.fromEntries(LEAGUES.map((l) => [l.id, l.po]));
export const isFastComp = (comp: number | null | undefined) => comp !== null && comp !== undefined && LEAGUE_BY_ID.has(comp);
export const FAST_COMPS = LEAGUES.map((l) => l.id);
export const NCAA_MSG = 'Juega en la NCAA: no se puede fichar ni ceder hasta que acabe su etapa universitaria.';

/** Universitarios: no tienen contrato ni se pueden fichar hasta que acaban. */
export function isNcaaClub(db: Db, clubId: number | null): boolean {
  if (clubId === null) return false;
  return db.rows<{ c: number | null }>('SELECT competition_id AS c FROM club WHERE id = ?', [clubId])[0]?.c === NCAA;
}

const INTL = ['FR', 'RS', 'LT', 'AR', 'SN', 'NG', 'CA', 'DE', 'IT', 'GR', 'TR', 'SI', 'HR', 'BR', 'ME', 'ES', 'ES', 'ES'];

/** Universitarios de 18 a 22 años: los mayores, mejores; potencial alto (los de 18-19 crecen mucho). */
function ncaaPlayer(rng: Rng, pos: Pos, age: number, strength: number, season: number, used: Set<string>): NewPlayer {
  const nat = rng.chance(0.5) ? 'US' : rng.pick(INTL);
  return generatePlayer(rng, { pos, quality: 44 + (age - 18) * 3.4 + strength * 0.8 + (rng.next() - 0.5) * 8, age, season, nationality: nat, name: makeName(rng, nat, used) });
}
const NCAA_AGES = [18, 18, 18, 19, 19, 19, 20, 20, 20, 21, 21, 22, 22];

function insertClub(db: Db, id: number, seed: ClubSeed, comp: number, country: string, rep: number) {
  db.exec(
    'INSERT INTO club (id, name, short, city, country, reputation, budget, competition_id, cash, colors, facilities, scouting, training) VALUES (?,?,?,?,?,?,0,?,0,?,?,?,?)',
    [id, seed.name, seed.short, seed.city, country, rep, comp, JSON.stringify(seed.colors), Math.max(1, Math.min(5, 3 + Math.round(seed.strength / 4))), 3, '{"focus":"equilibrado","intensity":"normal"}'],
  );
}

/**
 * Crea las ligas que falten: competiciones, clubes nuevos con plantilla y los clubes extranjeros que ya
 * existían metidos en la liga de su país. Sin transacción propia.
 */
export function setupLeagues(db: Db): void {
  const u = getUniverse(db);
  if (!u) return;
  for (const L of LEAGUES) db.exec('INSERT OR IGNORE INTO competition (id, name, short, kind, country, tier) VALUES (?,?,?,?,?,1)', [L.id, L.name, L.short, 'extranjera', L.country]);
  if (!db.rows('SELECT 1 FROM club WHERE competition_id = ? LIMIT 1', [NBA]).length) createLeagueClubs(db);
  scheduleFast(db, u.game_season, u.seed);
}

function createLeagueClubs(db: Db): void {
  const u = getUniverse(db)!;
  const rng = new Rng(mixSeed(u.seed, 9090));
  const used = new Set(db.rows<{ name: string }>('SELECT name FROM player').map((p) => p.name));
  const shorts = new Set(db.rows<{ short: string }>('SELECT short FROM club').map((c) => c.short));
  let id = Number(db.rows<{ m: number }>('SELECT MAX(id) AS m FROM club')[0]!.m);
  for (const L of LEAGUES) {
    // Los que ya jugaban en Europa entran en la liga de su país.
    if (L.country !== 'US') db.exec("UPDATE club SET competition_id = ? WHERE country = ? AND competition_id IS NULL", [L.id, L.country]);
    for (const seed of L.clubs) {
      id++;
      let short = seed.short.slice(0, 3);
      for (let k = 2; shorts.has(short); k++) short = seed.short.slice(0, 2) + k;
      shorts.add(short);
      const rep = L.id === NBA ? 90 + Math.round(seed.strength / 3) : L.id === NCAA ? 72 + seed.strength * 2 : Math.round(55 + seed.strength * 4);
      insertClub(db, id, { ...seed, short }, L.id, L.country, rep);
      const nums = new Set<number>();
      if (L.id === NCAA) {
        const pos = rng.shuffle([...POSITIONS, ...POSITIONS, rng.pick(POSITIONS), rng.pick(POSITIONS), rng.pick(POSITIONS)]);
        NCAA_AGES.forEach((age, i) => insertPlayer(db, ncaaPlayer(rng, pos[i]!, age, seed.strength, u.game_season, used), id, freeNumber(rng, nums), u.game_season));
        continue;
      }
      const roster = generateRoster(rng, { tier: 1, season: u.game_season, strength: seed.strength + (rng.next() - 0.5) * 2, used });
      if (L.id === NBA) roster.push(...generateRoster(rng, { tier: 1, season: u.game_season, strength: seed.strength - 8, used }).slice(0, 1));
      for (const p of roster) {
        used.delete(p.name);
        p.nationality = rng.chance(L.local) ? L.country : L.id === NBA ? rng.pick(INTL) : p.nationality === 'ES' ? rng.pick(INTL) : p.nationality;
        p.name = makeName(rng, p.nationality, used);
        insertPlayer(db, p, id, freeNumber(rng, nums), u.game_season);
      }
    }
  }
}

/* ───────────── Calendario ───────────── */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(s) + n * 86_400_000));
/** Día del juego (para ordenar) de una fecha: el último día del calendario español que no la supera. */
function dayOf(season: number, date: string): number {
  const slots = seasonCalendar(season).slots;
  let d = 0;
  for (const s of slots) if (s.date <= date) d = s.day;
  return Math.max(1, d);
}

/** Partidos de la fase regular de las ligas extranjeras (si aún no existen para la temporada). */
export function scheduleFast(db: Db, season: number, seed: number): void {
  if (db.rows("SELECT 1 FROM game WHERE season = ? AND competition_id >= 7 LIMIT 1", [season]).length) return;
  const cal = seasonCalendar(season);
  const rng = new Rng(mixSeed(seed, season * 4091));
  const sat = (r: number) => dateOfDay(season, cal.league[r]!)!;
  for (const L of LEAGUES) {
    const ids = db.rows<{ id: number }>('SELECT id FROM club WHERE competition_id = ? ORDER BY id', [L.id]).map((c) => c.id);
    if (ids.length < 4) continue;
    const games = roundRobin(ids, rng);
    const R = Math.max(...games.map((g) => g[0]));
    // Europa juega los miércoles: las ligas europeas, en los sábados de la ACB (repartidos entre las 34 jornadas).
    // La NBA y la NCAA, en fechas propias: la NBA de octubre a mediados de abril; la NCAA, de noviembre a principios de marzo.
    const start = L.id === NCAA ? addDays(sat(1), 35) : L.id === NBA ? addDays(sat(1), 17) : sat(1);
    const end = L.id === NCAA ? addDays(start, 120) : L.id === NBA ? addDays(start, 175) : sat(34);
    const span = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    const dateOf = (r: number) => (L.dates === 'sabados' ? sat(Math.min(34, Math.round(1 + ((r - 1) * 33) / Math.max(1, R - 1)))) : addDays(start, Math.round(((r - 1) * span) / Math.max(1, R - 1))));
    for (const [r, h, a] of games) {
      const date = dateOf(r);
      db.exec("INSERT INTO game (season, competition_id, stage, day, round, home_id, away_id, seed, status, date, engine_version) VALUES (?,?, 'regular', ?,?,?,?,?, 'rapido', ?, 'rapido')", [
        season, L.id, dayOf(season, date), r, h, a, rng.int(1, 2 ** 31 - 1), date,
      ]);
    }
  }
}

/* ───────────── Simulación rápida ───────────── */

interface FP { id: number; ovr: number; a: Attrs; h: number }
interface FTeam { id: number; rating: number; players: FP[] }
const W = [1, 1, 1, 1, 1, 0.7, 0.55, 0.4, 0.3];
const MIN40 = [32, 30, 29, 27, 25, 20, 16, 12, 9];

function loadFastTeams(db: Db, season: number, clubs: number[]): Map<number, FTeam> {
  const out = new Map<number, FTeam>();
  if (!clubs.length) return out;
  const rows = db.rows<Record<string, number>>(
    `SELECT p.id, p.club_id, p.height_cm, a.* FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     WHERE p.club_id IN (${clubs.join(',')}) AND p.retired = 0 AND p.injury_games = 0 ORDER BY a.ovr DESC`,
    [season],
  );
  for (const r of rows) {
    const t = out.get(r.club_id!) ?? out.set(r.club_id!, { id: r.club_id!, rating: 0, players: [] }).get(r.club_id!)!;
    t.players.push({ id: r.player_id ?? r.id!, ovr: r.ovr!, h: r.height_cm!, a: Object.fromEntries(ATTR_KEYS.map((k) => [k, r[k]!])) as Attrs });
  }
  for (const t of out.values()) {
    const top = t.players.slice(0, 9);
    const ws = W.slice(0, top.length);
    t.rating = top.reduce((s, p, i) => s + p.ovr * ws[i]!, 0) / Math.max(1, ws.reduce((s, x) => s + x, 0));
  }
  return out;
}

const gauss = (rng: Rng) => rng.next() + rng.next() + rng.next() + rng.next() - 2; // ~N(0, 0,58)
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
type Acc = Map<string, { comp: number; stage: string; pid: number; club: number; gp: number; gs: number; f: number[] }>;
const FI = Object.fromEntries(BOX_FIELDS.map((f, i) => [f, i])) as Record<(typeof BOX_FIELDS)[number], number>;

/** Reparte los números del equipo entre sus jugadores según minutos y atributos. */
function distribute(acc: Acc, comp: number, stage: string, t: FTeam, L: LeagueDef, pts: number, margin: number, rng: Rng) {
  const ps = t.players.slice(0, 9);
  if (!ps.length) return;
  const base = MIN40.slice(0, ps.length);
  const k = L.minutes / base.reduce((s, x) => s + x, 0);
  const min = base.map((m) => Math.max(0, m * k + gauss(rng) * 4));
  const scale = L.minutes / min.reduce((s, x) => s + x, 0);
  for (let i = 0; i < min.length; i++) min[i]! *= scale;
  const share = (w: (p: FP, i: number) => number) => {
    const xs = ps.map((p, i) => w(p, i) * min[i]!);
    const s = xs.reduce((a, b) => a + b, 0) || 1;
    return xs.map((x) => x / s);
  };
  const scorer = share((p) => Math.exp(0.035 * ((p.a.sht3 + p.a.sht2 + p.a.fin + p.a.drive + p.a.cre) / 5 - 60)));
  const rebW = share((p) => Math.exp(0.025 * ((p.a.oreb + p.a.dreb) / 2 + (p.h - 200) / 2 - 60)));
  const astW = share((p) => Math.exp(0.04 * ((p.a.pas + p.a.vis) / 2 - 60)));
  const stlW = share((p) => Math.exp(0.05 * (p.a.stl - 60)));
  const blkW = share((p) => Math.exp(0.07 * (p.a.blk - 55)));
  const tovW = share((p, i) => scorer[i]! * 4 + Math.exp(0.03 * (60 - p.a.hdl)));
  const nba = L.id === NBA ? 1 : 0;
  const teamReb = (36 + nba * 8) + gauss(rng) * 5;
  const teamStl = 7 + gauss(rng) * 3;
  const teamBlk = 3.5 + nba + gauss(rng) * 2;
  const teamTov = 13 + gauss(rng) * 4;
  const teamPf = 19 + gauss(rng) * 4;
  let teamFgm = 0;
  const lines = ps.map((p, i) => {
    const f = new Array(BOX_FIELDS.length).fill(0) as number[];
    const pp = pts * scorer[i]!;
    const ftShare = clamp(0.12 + (0.12 * (p.a.drive + p.a.fin - 100)) / 100, 0.08, 0.28);
    const ftPct = clamp(0.5 + 0.004 * p.a.ft, 0.45, 0.92);
    const ftm = pp * ftShare;
    const fgPts = pp - ftm;
    const f3 = clamp(0.1 + (p.a.sht3 - 50) * 0.01, 0.02, 0.62) * (1 + 0.15 * nba);
    const fgm3 = (fgPts * f3) / 3;
    const fgm2 = (fgPts - 3 * fgm3) / 2;
    const p2 = clamp(0.38 + ((p.a.fin + p.a.sht2) / 2) * 0.0025, 0.38, 0.65);
    const p3 = clamp(0.22 + p.a.sht3 * 0.0022, 0.2, 0.45);
    teamFgm += fgm2 + fgm3;
    f[FI.sec] = min[i]! * 60;
    f[FI.pts] = pp;
    f[FI.ftm] = ftm;
    f[FI.fta] = ftm / ftPct;
    f[FI.fgm3] = fgm3;
    f[FI.fga3] = fgm3 / p3;
    f[FI.fgm2] = fgm2;
    f[FI.fga2] = fgm2 / p2;
    f[FI.orb] = teamReb * rebW[i]! * 0.27;
    f[FI.drb] = teamReb * rebW[i]! * 0.73;
    f[FI.stl] = teamStl * stlW[i]!;
    f[FI.blk] = teamBlk * blkW[i]!;
    f[FI.tov] = teamTov * tovW[i]!;
    f[FI.pf] = (teamPf * min[i]!) / L.minutes;
    f[FI.fd] = f[FI.fta]! / 2.2;
    f[FI.pm] = (margin * min[i]!) / (L.minutes / 5);
    return f;
  });
  const teamAst = teamFgm * (L.id === NCAA ? 0.55 : 0.58);
  ps.forEach((p, i) => {
    const f = lines[i]!;
    f[FI.ast] = teamAst * astW[i]!;
    if (min[i]! < 0.5) return;
    const key = `${comp}|${stage}|${p.id}|${t.id}`;
    const a = acc.get(key) ?? acc.set(key, { comp, stage, pid: p.id, club: t.id, gp: 0, gs: 0, f: new Array(BOX_FIELDS.length).fill(0) }).get(key)!;
    a.gp += 1;
    a.gs += i < 5 ? 1 : 0;
    for (let j = 0; j < f.length; j++) a.f[j]! += f[j]!;
  });
}

/** Resultado de un partido rápido: diferencia según el nivel y la pista; total de puntos según la liga. */
function playFast(h: FTeam, a: FTeam, L: LeagueDef, neutral: boolean, rng: Rng): { hp: number; ap: number; ot: number } {
  const margin = (h.rating - a.rating) * 1.1 + (neutral ? 0 : L.home) + gauss(rng) * 19;
  const total = 2 * L.pts + gauss(rng) * 20;
  let hp = Math.round((total + margin) / 2);
  let ap = Math.round((total - margin) / 2);
  let ot = 0;
  while (hp === ap) {
    ot++;
    hp += 5 + rng.int(0, 8);
    ap += 5 + rng.int(0, 8);
  }
  return { hp, ap, ot };
}

function flush(db: Db, season: number, acc: Acc) {
  const cols = BOX_FIELDS.join(', ');
  for (const a of acc.values()) {
    db.exec(
      `INSERT INTO player_season_stats (season, competition_id, stage, player_id, club_id, source, gp, gs, ${cols})
       VALUES (?,?,?,?,?, 'sim', ?, ?, ${BOX_FIELDS.map(() => '?').join(',')})
       ON CONFLICT(season, competition_id, stage, player_id, club_id, source) DO UPDATE SET
       gp = gp + excluded.gp, gs = gs + excluded.gs, ${BOX_FIELDS.map((f) => `${f} = ${f} + excluded.${f}`).join(', ')}`,
      [season, a.comp, a.stage, a.pid, a.club, a.gp, a.gs, ...a.f.map((x) => Math.round(x))],
    );
  }
  acc.clear();
}

/** Simula los partidos rápidos hasta una fecha (incluida) y programa los playoffs que toquen. Devuelve noticias. */
export function progressFast(db: Db, season: number, until: string): string[] {
  const ev: string[] = [];
  const u = getUniverse(db)!;
  for (let guard = 0; guard < 80; guard++) {
    const games = db.rows<{ id: number; competition_id: number; stage: string; home_id: number; away_id: number; seed: number; series_id: number | null; date: string }>(
      "SELECT id, competition_id, stage, home_id, away_id, seed, series_id, date FROM game WHERE season = ? AND status = 'rapido' AND date <= ? ORDER BY date, id",
      [season, until],
    );
    if (games.length) {
      const clubs = [...new Set(games.flatMap((g) => [g.home_id, g.away_id]))];
      const teams = loadFastTeams(db, season, clubs);
      const acc: Acc = new Map();
      for (const g of games) {
        const L = LEAGUE_BY_ID.get(g.competition_id)!;
        const h = teams.get(g.home_id) ?? { id: g.home_id, rating: 50, players: [] };
        const a = teams.get(g.away_id) ?? { id: g.away_id, rating: 50, players: [] };
        const rng = new Rng(mixSeed(u.seed, g.seed));
        const r = playFast(h, a, L, L.id === NCAA && g.stage === 'playoffs', rng);
        db.exec("UPDATE game SET home_pts = ?, away_pts = ?, ot = ?, status = 'jugado' WHERE id = ?", [r.hp, r.ap, r.ot, g.id]);
        distribute(acc, g.competition_id, g.stage, h, L, r.hp, r.hp - r.ap, rng);
        distribute(acc, g.competition_id, g.stage, a, L, r.ap, r.ap - r.hp, rng);
        if (g.series_id) seriesWin(db, g.series_id, r.hp > r.ap ? g.home_id : g.away_id);
        creditGate(db, season, g.home_id, g.away_id, g.stage);
      }
      flush(db, season, acc);
    }
    const scheduled = scheduleLeaguePlayoffs(db, season, ev);
    if (!games.length && !scheduled) break;
  }
  return ev;
}

/** Termina todo lo que quede de las ligas rápidas (al cerrar la temporada española). */
export function finishLeagues(db: Db, season: number): string[] {
  return progressFast(db, season, '9999-12-31');
}

function seriesWin(db: Db, seriesId: number, winner: number) {
  const s = db.rows<{ high_id: number; low_id: number; best_of: number; high_wins: number; low_wins: number }>('SELECT * FROM playoff_series WHERE id = ?', [seriesId])[0]!;
  const hw = s.high_wins + (winner === s.high_id ? 1 : 0);
  const lw = s.low_wins + (winner === s.low_id ? 1 : 0);
  const need = Math.ceil(s.best_of / 2);
  db.exec('UPDATE playoff_series SET high_wins = ?, low_wins = ?, winner_id = ? WHERE id = ?', [hw, lw, hw >= need ? s.high_id : lw >= need ? s.low_id : null, seriesId]);
}

/** Orden del cuadro: 1-8, 4-5, 2-7, 3-6 (y su versión de 16). */
const BRACKET: Record<number, [number, number][]> = {
  8: [[1, 8], [4, 5], [2, 7], [3, 6]],
  16: [[1, 16], [8, 9], [4, 13], [5, 12], [2, 15], [7, 10], [3, 14], [6, 11]],
};
const ROUND_LABEL = (rounds: number, r: number) => (r === rounds ? 'la final' : r === rounds - 1 ? 'semifinales' : r === rounds - 2 ? 'cuartos' : 'octavos');

function scheduleLeaguePlayoffs(db: Db, season: number, ev: string[]): boolean {
  let changed = false;
  const u = getUniverse(db)!;
  const names = new Map(db.rows<{ id: number; name: string }>('SELECT id, name FROM club WHERE competition_id >= 7').map((c) => [c.id, c.name]));
  for (const L of LEAGUES) {
    const pendingReg = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE season = ? AND competition_id = ? AND stage = 'regular' AND status = 'rapido'", [season, L.id])[0]!.n;
    const anyReg = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE season = ? AND competition_id = ? AND stage = 'regular'", [season, L.id])[0]!.n;
    if (!anyReg || pendingReg) continue;
    if (db.rows('SELECT 1 FROM season_result WHERE season = ? AND competition_id = ? AND champion_id IS NOT NULL', [season, L.id]).length) continue;
    type S = { id: number; round: number; slot: number; high_id: number; low_id: number; high_seed: number; low_seed: number; best_of: number; high_wins: number; low_wins: number; winner_id: number | null };
    const all = db.rows<S>('SELECT * FROM playoff_series WHERE season = ? AND competition_id = ? ORDER BY round, slot', [season, L.id]);
    const lastDate = (where: string, args: unknown[]) => db.rows<{ d: string | null }>(`SELECT MAX(date) AS d FROM game WHERE season = ? AND competition_id = ? ${where}`, [season, L.id, ...args])[0]?.d ?? null;
    const rng = new Rng(mixSeed(u.seed, season * 31 + L.id * 977 + all.length));
    const addGame = (s: S, date: string) => {
      const played = s.high_wins + s.low_wins;
      // Casa del mejor clasificado: 2-2-1-1-1 (mejor de 7), 2-2-1 (de 5), 1-1-1 (de 3).
      const highHome = s.best_of === 7 ? [0, 1, 4, 6].includes(played) : s.best_of === 5 ? [0, 1, 4].includes(played) : s.best_of === 3 ? played !== 1 : true;
      db.exec("INSERT INTO game (season, competition_id, stage, day, series_id, home_id, away_id, seed, status, date, engine_version) VALUES (?,?, 'playoffs', ?,?,?,?,?, 'rapido', ?, 'rapido')", [
        season, L.id, dayOf(season, date), s.id, highHome ? s.high_id : s.low_id, highHome ? s.low_id : s.high_id, rng.int(1, 2 ** 31 - 1), date,
      ]);
    };
    const rounds = L.bestOf.length;
    if (!all.length) {
      const t = standings(db, season, L.id);
      if (t.length < L.po) continue;
      db.exec('INSERT OR REPLACE INTO season_result (season, competition_id, regular_first_id) VALUES (?,?,?)', [season, L.id, t[0]!.club_id]);
      const start = addDays(lastDate("AND stage = 'regular'", [])!, 3);
      BRACKET[L.po]!.forEach(([hi, lo], slot) => {
        db.exec('INSERT INTO playoff_series (season, competition_id, round, slot, high_id, low_id, high_seed, low_seed, best_of) VALUES (?,?,1,?,?,?,?,?,?)', [season, L.id, slot, t[hi - 1]!.club_id, t[lo - 1]!.club_id, hi, lo, L.bestOf[0]!]);
      });
      for (const s of db.rows<S>('SELECT * FROM playoff_series WHERE season = ? AND competition_id = ? AND round = 1', [season, L.id])) addGame(s, start);
      changed = true;
      continue;
    }
    const round = Math.max(...all.map((s) => s.round));
    const cur = all.filter((s) => s.round === round);
    const pendingPo = db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM game WHERE season = ? AND competition_id = ? AND stage = 'playoffs' AND status = 'rapido'", [season, L.id])[0]!.n;
    if (pendingPo) continue;
    const last = lastDate("AND stage = 'playoffs'", [])!;
    if (cur.every((s) => s.winner_id)) {
      if (round >= rounds) {
        const f = cur[0]!;
        const loser = f.winner_id === f.high_id ? f.low_id : f.high_id;
        db.exec('INSERT OR IGNORE INTO season_result (season, competition_id) VALUES (?,?)', [season, L.id]);
        db.exec('UPDATE season_result SET champion_id = ?, runner_up_id = ? WHERE season = ? AND competition_id = ?', [f.winner_id, loser, season, L.id]);
        ev.push(`🏆 ${names.get(f.winner_id!)} gana ${L.id === NBA ? 'el anillo de la NBA' : L.id === NCAA ? 'la NCAA' : `la liga de ${L.name.replace(/.*\((.*)\)/, '$1')}`}.`);
        changed = true;
        continue;
      }
      const winners = cur.map((s) => ({ id: s.winner_id!, seed: s.winner_id === s.high_id ? s.high_seed : s.low_seed }));
      for (let k = 0; k < winners.length / 2; k++) {
        const [x, y] = [winners[2 * k]!, winners[2 * k + 1]!].sort((p, q) => p.seed - q.seed);
        db.exec('INSERT INTO playoff_series (season, competition_id, round, slot, high_id, low_id, high_seed, low_seed, best_of) VALUES (?,?,?,?,?,?,?,?,?)', [season, L.id, round + 1, k, x!.id, y!.id, x!.seed, y!.seed, L.bestOf[round] ?? 1]);
      }
      for (const s of db.rows<S>('SELECT * FROM playoff_series WHERE season = ? AND competition_id = ? AND round = ?', [season, L.id, round + 1])) addGame(s, addDays(last, 3));
      if (round + 1 === rounds) ev.push(`${L.short}: ${db.rows<S>('SELECT * FROM playoff_series WHERE season = ? AND competition_id = ? AND round = ?', [season, L.id, round + 1]).map((s) => `${names.get(s.high_id)} y ${names.get(s.low_id)}`).join('; ')} jugarán ${ROUND_LABEL(rounds, round + 1)}.`);
      changed = true;
      continue;
    }
    for (const s of cur) {
      if (s.winner_id) continue;
      addGame(s, addDays(last, 2));
      changed = true;
    }
  }
  return changed;
}

/* ───────────── Verano: universitarios que acaban y plantillas ───────────── */

/**
 * Antes del mercado de verano: los universitarios de 23 años (o de 21-22 con nivel para dar el salto) dejan la
 * NCAA. Los mejores entran en la NBA por el draft (eligen primero los peores de la temporada, dos rondas); el
 * resto sale al mercado como agentes libres y cualquier club, también el tuyo, los puede fichar.
 */
export function collegeExit(db: Db, oldSeason: number, newSeason: number, rng: Rng, events: string[]): void {
  const rows = db.rows<{ id: number; name: string; club_id: number; birth_year: number; ovr: number; potential_est: number }>(
    `SELECT p.id, p.name, p.club_id, p.birth_year, p.potential_est, a.ovr FROM player p JOIN club c ON c.id = p.club_id AND c.competition_id = ?
     JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.retired = 0`,
    [NCAA, newSeason],
  );
  const out = rows.filter((r) => {
    const age = newSeason - r.birth_year;
    return age >= 23 || (age >= 21 && r.ovr >= 64) || (age >= 20 && r.ovr >= 69);
  }).sort((a, b) => b.ovr + 0.5 * (b.potential_est - b.ovr) - (a.ovr + 0.5 * (a.potential_est - a.ovr)));
  if (!out.length) return;
  for (const r of out) {
    db.exec('UPDATE player SET club_id = NULL, number = NULL WHERE id = ?', [r.id]);
    db.exec("INSERT INTO transfer (season, day, player_id, from_club, to_club, fee, salary, until, kind) VALUES (?,0,?,?,NULL,0,NULL,NULL,'universidad')", [newSeason, r.id, r.club_id]);
  }
  // Draft: orden inverso a la clasificación de la NBA; solo entran los que tienen nivel de NBA (58 o más).
  const order = standings(db, oldSeason, NBA).map((t) => t.club_id).reverse();
  const pool = out.filter((r) => r.ovr >= 58);
  const picks: string[] = [];
  for (let round = 0; round < 2; round++) {
    for (const club of order) {
      const size = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [club])[0]!.n;
      if (size >= 15 || !pool.length) continue;
      const p = pool.shift()!;
      const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND number IS NOT NULL', [club]).map((x) => x.number));
      const salary = Math.max(600_000, Math.round(1_200_000 * Math.exp((p.ovr - 62) * 0.08) / 10_000) * 10_000);
      db.exec('UPDATE player SET club_id = ?, number = ?, morale = MAX(morale, 75) WHERE id = ?', [club, freeNumber(rng, nums), p.id]);
      db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until) VALUES (?,?,?,?)', [p.id, club, salary, newSeason + 3]);
      db.exec("INSERT INTO transfer (season, day, player_id, from_club, to_club, fee, salary, until, kind) VALUES (?,0,?,NULL,?,0,?,?,'draft')", [newSeason, p.id, club, salary, newSeason + 3]);
      if (picks.length < 3) picks.push(p.name);
    }
  }
  const drafted = out.length - out.filter((r) => db.rows<{ c: number | null }>('SELECT club_id AS c FROM player WHERE id = ?', [r.id])[0]?.c === null).length;
  events.push(`${out.length} universitarios dejan la NCAA: ${drafted} entran en la NBA por el draft${picks.length ? ` (los primeros, ${picks.join(', ')})` : ''} y el resto sale al mercado.`);
}

/** Después del mercado: la NCAA recluta novatos de 18 años y la NBA completa plantilla si le falta gente. */
export function leaguesRefill(db: Db, season: number, rng: Rng): void {
  const used = new Set(db.rows<{ name: string }>('SELECT name FROM player').map((p) => p.name));
  for (const c of db.rows<{ id: number; competition_id: number; reputation: number }>('SELECT id, competition_id, reputation FROM club WHERE competition_id IN (?, ?)', [NCAA, NBA])) {
    const nums = new Set(db.rows<{ number: number }>('SELECT number FROM player WHERE club_id = ? AND retired = 0 AND number IS NOT NULL', [c.id]).map((x) => x.number));
    let n = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE club_id = ? AND retired = 0', [c.id])[0]!.n;
    const strength = (c.reputation - 72) / 2;
    while (n < 13) {
      const have: Record<string, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
      for (const r of db.rows<{ pos1: string }>('SELECT pos1 FROM player WHERE club_id = ? AND retired = 0', [c.id])) have[r.pos1] = (have[r.pos1] ?? 0) + 1;
      const pos = POSITIONS.reduce((a, p) => (have[p]! < have[a]! ? p : a), 'PG' as Pos);
      if (c.competition_id === NCAA) {
        insertPlayer(db, ncaaPlayer(rng, pos, rng.chance(0.8) ? 18 : 19, strength, season, used), c.id, freeNumber(rng, nums), season);
      } else {
        // Novato que llega a la NBA desde fuera del mercado (nivel de suplente).
        const nat = rng.chance(0.7) ? 'US' : rng.pick(INTL);
        const pid = insertPlayer(db, generatePlayer(rng, { pos, quality: 62 + rng.next() * 6, age: rng.int(20, 23), season, nationality: nat, name: makeName(rng, nat, used) }), c.id, freeNumber(rng, nums), season);
        db.exec('INSERT OR REPLACE INTO contract (player_id, club_id, salary, until) VALUES (?,?,?,?)', [pid, c.id, 900_000, season + 2]);
      }
      n++;
    }
  }
}
