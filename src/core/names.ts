/** Nombres y clubes ficticios para universos generados. No corresponden a personas ni clubes reales. */
import { Rng } from './rng';

const POOLS: Record<string, { first: string[]; last: string[] }> = {
  ES: {
    first: ['Álex', 'Adrián', 'Alberto', 'Álvaro', 'Andrés', 'Bruno', 'Carlos', 'Dani', 'David', 'Diego', 'Eduardo', 'Enrique', 'Fernando', 'Gonzalo', 'Guillermo', 'Héctor', 'Hugo', 'Iker', 'Ignacio', 'Iván', 'Jaime', 'Javier', 'Jorge', 'Juan', 'Lucas', 'Luis', 'Manuel', 'Marc', 'Mario', 'Martín', 'Miguel', 'Nacho', 'Nicolás', 'Óscar', 'Pablo', 'Pau', 'Pedro', 'Rafa', 'Raúl', 'Rubén', 'Samuel', 'Sergio', 'Sergi', 'Tomás', 'Unai', 'Víctor', 'Xabi', 'Yeray'],
    last: ['Abad', 'Aguilar', 'Alonso', 'Arias', 'Benítez', 'Blanco', 'Bravo', 'Caballero', 'Calvo', 'Campos', 'Cano', 'Castillo', 'Cortés', 'Crespo', 'Delgado', 'Díez', 'Domínguez', 'Duran', 'Esteban', 'Ferrer', 'Flores', 'Fuentes', 'Gallego', 'Garrido', 'Gil', 'Giménez', 'Herrera', 'Ibáñez', 'Iglesias', 'Lara', 'León', 'Lorenzo', 'Lozano', 'Marín', 'Medina', 'Molina', 'Mora', 'Nieto', 'Ortega', 'Pascual', 'Peña', 'Prieto', 'Ramos', 'Reyes', 'Rubio', 'Sáez', 'Santana', 'Serrano', 'Soler', 'Suárez', 'Torres', 'Vargas', 'Vega', 'Vidal'],
  },
  US: {
    first: ['Aaron', 'Brandon', 'Cameron', 'Darius', 'DeShawn', 'Elijah', 'Isaiah', 'Jalen', 'Jamal', 'Jordan', 'Justin', 'Kendrick', 'Malik', 'Marcus', 'Nate', 'Quincy', 'Terrence', 'Tyler', 'Xavier', 'Zion'],
    last: ['Bennett', 'Brooks', 'Carter', 'Coleman', 'Davis', 'Ellis', 'Foster', 'Grant', 'Hayes', 'Henderson', 'Jackson', 'Jenkins', 'Mitchell', 'Morris', 'Porter', 'Reed', 'Russell', 'Simmons', 'Turner', 'Walker', 'Washington', 'Wright'],
  },
  RS: { first: ['Aleksa', 'Dušan', 'Marko', 'Miloš', 'Nikola', 'Stefan', 'Uroš', 'Vasilije'], last: ['Jović', 'Lazić', 'Marković', 'Nikolić', 'Petrović', 'Radić', 'Stanković', 'Vuković'] },
  LT: { first: ['Arnas', 'Dovydas', 'Ignas', 'Lukas', 'Mantas', 'Rokas', 'Tomas'], last: ['Butkus', 'Jankauskas', 'Kazlauskas', 'Petrauskas', 'Stankevičius', 'Vaitkus'] },
  FR: { first: ['Antoine', 'Bastien', 'Hugo', 'Killian', 'Mathis', 'Théo', 'Yanis'], last: ['Bernard', 'Dubois', 'Durand', 'Lefèvre', 'Moreau', 'Petit', 'Roux'] },
  AR: { first: ['Facundo', 'Lautaro', 'Nahuel', 'Santiago', 'Tomás', 'Valentín'], last: ['Acosta', 'Benítez', 'Ferreyra', 'Gómez', 'Romero', 'Sosa'] },
  SN: { first: ['Abdou', 'Cheikh', 'Mamadou', 'Ousmane', 'Pape'], last: ['Diallo', 'Diop', 'Faye', 'Ndiaye', 'Sow'] },
  IT: { first: ['Alessandro', 'Davide', 'Lorenzo', 'Matteo', 'Riccardo'], last: ['Bianchi', 'Colombo', 'Esposito', 'Ferrari', 'Ricci'] },
  GR: { first: ['Giorgos', 'Kostas', 'Nikos', 'Dimitris', 'Vasilis', 'Ioannis', 'Thanasis'], last: ['Papadopoulos', 'Papanikolaou', 'Georgiou', 'Kalaitzakis', 'Mitoglou', 'Larentzakis', 'Lountzis'] },
  TR: { first: ['Ahmet', 'Mehmet', 'Emre', 'Can', 'Burak', 'Kerem', 'Ercan'], last: ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Arslan', 'Öztürk'] },
  IL: { first: ['Yovel', 'Tamir', 'Roman', 'Guy', 'Itay', 'Yam'], last: ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Friedman'] },
  DE: { first: ['Lukas', 'Jonas', 'Leon', 'Moritz', 'Niklas', 'Felix'], last: ['Müller', 'Schmidt', 'Weber', 'Becker', 'Hoffmann', 'Wagner'] },
  SI: { first: ['Luka', 'Jaka', 'Žiga', 'Matej', 'Klemen'], last: ['Novak', 'Kovačič', 'Horvat', 'Krajnc', 'Zupan'] },
  HR: { first: ['Ivan', 'Marko', 'Ante', 'Mario', 'Dario'], last: ['Horvat', 'Babić', 'Marić', 'Jurić', 'Novak'] },
  ME: { first: ['Nikola', 'Vladimir', 'Bojan', 'Marko'], last: ['Ivanović', 'Popović', 'Vučević', 'Dubljević'] },
  BR: { first: ['Lucas', 'Gabriel', 'Mateus', 'Rafael'], last: ['Silva', 'Santos', 'Oliveira', 'Souza'] },
  CA: { first: ['Kyle', 'Andrew', 'Tyler', 'Owen'], last: ['Thompson', 'Campbell', 'Murray', 'Wilson'] },
  NG: { first: ['Chukwuemeka', 'Obinna', 'Tobi', 'Emeka'], last: ['Okafor', 'Adeyemi', 'Okonkwo', 'Eze'] },
  PT: { first: ['João', 'Tiago', 'Rui', 'Diogo'], last: ['Ferreira', 'Pereira', 'Costa', 'Martins'] },
};

/** Reparto aproximado de nacionalidades en una plantilla española generada. */
const NAT_WEIGHTS: [string, number][] = [['ES', 46], ['US', 22], ['RS', 6], ['LT', 5], ['FR', 6], ['AR', 6], ['SN', 5], ['IT', 4]];

export function pickNationality(rng: Rng): string {
  const total = NAT_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [n, w] of NAT_WEIGHTS) {
    r -= w;
    if (r < 0) return n;
  }
  return 'ES';
}

export function makeName(rng: Rng, nat: string, used: Set<string>): string {
  const pool = POOLS[nat] ?? POOLS.ES!;
  for (let i = 0; i < 40; i++) {
    const n = nat === 'ES' && rng.chance(0.5)
      ? `${rng.pick(pool.first)} ${rng.pick(pool.last)} ${rng.pick(pool.last)}`
      : `${rng.pick(pool.first)} ${rng.pick(pool.last)}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  const n = `${rng.pick(pool.first)} ${rng.pick(pool.last)} ${used.size}`;
  used.add(n);
  return n;
}

export const COUNTRY_LABEL: Record<string, string> = { UE: 'Comunitario', EXT: 'Extracomunitario', '?': 'Cupo desconocido', ES: 'España', US: 'EE. UU.', RS: 'Serbia', LT: 'Lituania', FR: 'Francia', AR: 'Argentina', SN: 'Senegal', IT: 'Italia', GR: 'Grecia', TR: 'Turquía', IL: 'Israel', DE: 'Alemania', SI: 'Eslovenia', HR: 'Croacia', ME: 'Montenegro', BR: 'Brasil', CA: 'Canadá', NG: 'Nigeria', PT: 'Portugal' };

/** 36 ciudades: 18 para la primera división y 18 para la segunda. Nombres de club inventados. */
export const CLUB_CITIES: [string, string][] = [
  ['Madrid', 'MAD'], ['Barcelona', 'BAR'], ['Valencia', 'VAL'], ['Málaga', 'MAL'], ['Vitoria', 'VIT'], ['Bilbao', 'BIL'],
  ['Zaragoza', 'ZAR'], ['Sevilla', 'SEV'], ['Murcia', 'MUR'], ['Gran Canaria', 'GCA'], ['Tenerife', 'TEN'], ['Granada', 'GRA'],
  ['Badalona', 'BAD'], ['Manresa', 'MAN'], ['Girona', 'GIR'], ['Burgos', 'BUR'], ['Lleida', 'LLE'], ['Andorra', 'AND'],
  ['Valladolid', 'VLL'], ['Palencia', 'PAL'], ['Ourense', 'OUR'], ['Lugo', 'LUG'], ['Oviedo', 'OVI'], ['Gijón', 'GIJ'],
  ['Santiago', 'SAN'], ['Cáceres', 'CAC'], ['Huesca', 'HUE'], ['Castellón', 'CAS'], ['Alicante', 'ALI'], ['Almería', 'ALM'],
  ['Córdoba', 'COR'], ['León', 'LEO'], ['Melilla', 'MEL'], ['Menorca', 'MEN'], ['Navarra', 'NAV'], ['Salamanca', 'SAL'],
];
const CLUB_PATTERNS = ['Baloncesto {c}', 'CB {c}', '{c} Basket', 'Club {c}', 'Atlético {c}', 'Deportivo {c}'];
export function clubName(rng: Rng, city: string): string {
  return rng.pick(CLUB_PATTERNS).replace('{c}', city);
}

/**
 * Clubes reales de la temporada 2026-27 (nombres públicos). Las plantillas son inventadas.
 * strength: nivel relativo aproximado de partida (lo afina la temporada; no es un dato oficial).
 * Primera FEB según el calendario publicado por la FEB para 2026-27.
 */
export interface ClubDef { name: string; short: string; city: string; tier: 1 | 2; strength: number; budgetM: number; colors?: [string, string, string] }
export const REAL_CLUBS: ClubDef[] = [
  { name: 'Real Madrid', short: 'RMA', city: 'Madrid', tier: 1, strength: 6, budgetM: 14 },
  { name: 'Barça', short: 'FCB', city: 'Barcelona', tier: 1, strength: 5, budgetM: 12 },
  { name: 'Valencia Basket', short: 'VBC', city: 'Valencia', tier: 1, strength: 4, budgetM: 9 },
  { name: 'Unicaja', short: 'UNI', city: 'Málaga', tier: 1, strength: 4, budgetM: 8 },
  { name: 'Kosner Baskonia', short: 'BAS', city: 'Vitoria', tier: 1, strength: 3, budgetM: 8 },
  { name: 'La Laguna Tenerife', short: 'CAN', city: 'San Cristóbal de La Laguna', tier: 1, strength: 3, budgetM: 6 },
  { name: 'UCAM Murcia', short: 'MUR', city: 'Murcia', tier: 1, strength: 1, budgetM: 5 },
  { name: 'Asisa Joventut', short: 'JOV', city: 'Badalona', tier: 1, strength: 1, budgetM: 4.5 },
  { name: 'Surne Bilbao Basket', short: 'BLB', city: 'Bilbao', tier: 1, strength: 0, budgetM: 4.5 },
  { name: 'Casademont Zaragoza', short: 'ZAR', city: 'Zaragoza', tier: 1, strength: 0, budgetM: 4.5 },
  { name: 'Río Breogán', short: 'BRE', city: 'Lugo', tier: 1, strength: 0, budgetM: 4 },
  { name: 'Ilerna Lleida', short: 'ILE', city: 'Lleida', tier: 1, strength: -1, budgetM: 3.5 },
  { name: 'Fiatc Girona', short: 'GIR', city: 'Girona', tier: 1, strength: -1, budgetM: 3.5 },
  { name: 'MoraBanc Andorra', short: 'AND', city: 'Andorra la Vella', tier: 1, strength: -1, budgetM: 3.5 },
  { name: 'Kidsandus Manresa', short: 'MAN', city: 'Manresa', tier: 1, strength: -1, budgetM: 3.5 },
  { name: 'Recoletas Salud San Pablo Burgos', short: 'BUR', city: 'Burgos', tier: 1, strength: -2, budgetM: 3.5 },
  { name: 'Leyma Coruña', short: 'COR', city: 'A Coruña', tier: 1, strength: -2, budgetM: 3 },
  { name: 'Monbus Obradoiro', short: 'OBR', city: 'Santiago de Compostela', tier: 1, strength: -3, budgetM: 3 },
  { name: 'Gran Canaria CB', short: 'GCA', city: 'Las Palmas de Gran Canaria', tier: 2, strength: 4, budgetM: 2.5 },
  { name: 'Covirán Granada', short: 'GRA', city: 'Granada', tier: 2, strength: 3, budgetM: 2 },
  { name: 'Movistar Estudiantes', short: 'EST', city: 'Madrid', tier: 2, strength: 3, budgetM: 2 },
  { name: 'Súper Agropal Palencia', short: 'PAL', city: 'Palencia', tier: 2, strength: 2, budgetM: 1.5 },
  { name: 'Flexicar Fuenlabrada', short: 'FUE', city: 'Fuenlabrada', tier: 2, strength: 1, budgetM: 1.5 },
  { name: 'Alimerka Oviedo Baloncesto', short: 'OVI', city: 'Oviedo', tier: 2, strength: 1, budgetM: 1.3 },
  { name: 'Inveready Gipuzkoa', short: 'GBC', city: 'San Sebastián', tier: 2, strength: 0, budgetM: 1.3 },
  { name: 'Hestia Menorca', short: 'MEN', city: 'Mahón', tier: 2, strength: 0, budgetM: 1.2 },
  { name: 'Grupo Ureta Tizona Burgos', short: 'TIZ', city: 'Burgos', tier: 2, strength: 0, budgetM: 1.2 },
  { name: 'Club Ourense Baloncesto', short: 'OUR', city: 'Ourense', tier: 2, strength: 0, budgetM: 1.2 },
  { name: 'Alicante', short: 'ALI', city: 'Alicante', tier: 2, strength: 0, budgetM: 1.2 },
  { name: 'Grupo Alega Cantabria', short: 'CTB', city: 'Torrelavega', tier: 2, strength: -1, budgetM: 1.1 },
  { name: 'Zamora', short: 'ZAM', city: 'Zamora', tier: 2, strength: -1, budgetM: 1 },
  { name: 'Palmer Basket Mallorca', short: 'PMB', city: 'Palma', tier: 2, strength: -1, budgetM: 1 },
  { name: 'Fibwi Mallorca', short: 'FIB', city: 'Palma', tier: 2, strength: -1, budgetM: 1 },
  { name: 'Cajasol Coto Córdoba', short: 'COT', city: 'Córdoba', tier: 2, strength: -2, budgetM: 1 },
  { name: 'Insolac Caja 87', short: 'C87', city: 'Sevilla', tier: 2, strength: -2, budgetM: 0.9 },
  { name: 'Bueno Arenas Albacete', short: 'ALB', city: 'Albacete', tier: 2, strength: -2, budgetM: 0.9 },
];

/**
 * Cupos de la liga española (ACB y FEB): mínimo 4 jugadores de formación nacional y máximo 2 extracomunitarios.
 * Simplificación: España = nacional; UE y países del Acuerdo de Cotonú (Senegal, Nigeria) = comunitario; resto = extracomunitario.
 */
export type Cupo = 'NAC' | 'COM' | 'EXT';
export const CUPO_RULES = { minNac: 4, maxExt: 2 } as const;
const COMMUNITY = new Set(['FR', 'IT', 'LT', 'DE', 'GR', 'SI', 'HR', 'PT', 'UE', 'SN', 'NG']);
export function cupoOf(nationality: string): Cupo {
  if (nationality === 'ES') return 'NAC';
  return COMMUNITY.has(nationality) ? 'COM' : 'EXT';
}
export const CUPO_LABEL: Record<Cupo, string> = { NAC: 'Nacional', COM: 'Comunitario', EXT: 'Extracomunitario' };

/** Colores (principal, secundario, detalle) de los clubes españoles para camisetas y escudos. */
export const CLUB_COLORS: Record<string, [string, string, string]> = {
  RMA: ['#ffffff', '#5b2a86', '#d4af37'], FCB: ['#a50044', '#004d98', '#edbb00'], VBC: ['#f47b20', '#111111', '#ffffff'], UNI: ['#006a35', '#7a1f6b', '#ffffff'],
  BAS: ['#1d3c8f', '#c8102e', '#ffffff'], CAN: ['#0b3c8c', '#f6c400', '#ffffff'], MUR: ['#b31f2f', '#1a1a1a', '#ffffff'], JOV: ['#0e8a3f', '#111111', '#ffffff'],
  BLB: ['#111111', '#c8102e', '#ffffff'], ZAR: ['#c8102e', '#ffffff', '#1a1a1a'], BRE: ['#5ab4e5', '#ffffff', '#0b3c8c'], ILE: ['#d01f2e', '#1a1a1a', '#ffffff'],
  GIR: ['#c8102e', '#ffffff', '#111111'], AND: ['#003da5', '#fce300', '#d52b1e'], MAN: ['#cf1f2d', '#111111', '#ffffff'], BUR: ['#6a2a8a', '#ffffff', '#c8a400'],
  COR: ['#0057a8', '#ffffff', '#c8102e'], OBR: ['#003b7a', '#ffffff', '#7ec8f2'], GCA: ['#f7d116', '#0057a8', '#ffffff'], GRA: ['#b31f2f', '#ffffff', '#1a8a3a'],
  EST: ['#0057a8', '#ffffff', '#111111'], PAL: ['#5b2a86', '#ffffff', '#d4af37'], FUE: ['#f47b20', '#003b7a', '#ffffff'], OVI: ['#003b7a', '#ffffff', '#5ab4e5'],
  GBC: ['#0057a8', '#ffffff', '#111111'], MEN: ['#e3001b', '#ffffff', '#111111'], TIZ: ['#7a1f2b', '#ffffff', '#d4af37'], OUR: ['#1a1a1a', '#ffffff', '#c8102e'],
  ALI: ['#0057a8', '#ffffff', '#c8102e'], CTB: ['#008f4c', '#ffffff', '#111111'], ZAM: ['#7a1f2b', '#ffffff', '#111111'], PMB: ['#b31f2f', '#ffffff', '#0057a8'],
  FIB: ['#d01f2e', '#ffffff', '#111111'], COT: ['#008f4c', '#ffffff', '#d4af37'], C87: ['#0b3c8c', '#f6c400', '#ffffff'], ALB: ['#c8102e', '#ffffff', '#111111'],
};

/**
 * Clubes extranjeros (nombres públicos) para las competiciones europeas. Las plantillas son inventadas y la
 * participación de cada club no reproduce una temporada concreta.
 */
export interface ForeignClub { name: string; short: string; city: string; country: string; comp: 4 | 5 | 6; strength: number; colors: [string, string, string] }
export const FOREIGN_CLUBS: ForeignClub[] = [
  { name: 'Olympiacos', short: 'OLY', city: 'El Pireo', country: 'GR', comp: 4, strength: 6, colors: ['#c8102e', '#ffffff', '#111111'] },
  { name: 'Panathinaikos', short: 'PAO', city: 'Atenas', country: 'GR', comp: 4, strength: 6, colors: ['#0b7a3e', '#ffffff', '#111111'] },
  { name: 'Fenerbahçe', short: 'FEN', city: 'Estambul', country: 'TR', comp: 4, strength: 6, colors: ['#0b1e5b', '#f6d200', '#ffffff'] },
  { name: 'Anadolu Efes', short: 'EFS', city: 'Estambul', country: 'TR', comp: 4, strength: 4, colors: ['#0b2a6b', '#e30613', '#ffffff'] },
  { name: 'Žalgiris Kaunas', short: 'ZAL', city: 'Kaunas', country: 'LT', comp: 4, strength: 4, colors: ['#0b7a3e', '#ffffff', '#111111'] },
  { name: 'Partizan', short: 'PAR', city: 'Belgrado', country: 'RS', comp: 4, strength: 4, colors: ['#111111', '#ffffff', '#888888'] },
  { name: 'Crvena zvezda', short: 'CZV', city: 'Belgrado', country: 'RS', comp: 4, strength: 4, colors: ['#c8102e', '#ffffff', '#111111'] },
  { name: 'AS Monaco', short: 'MON', city: 'Mónaco', country: 'FR', comp: 4, strength: 5, colors: ['#c8102e', '#ffffff', '#111111'] },
  { name: 'Maccabi Tel Aviv', short: 'MTA', city: 'Tel Aviv', country: 'IL', comp: 4, strength: 3, colors: ['#f6d200', '#0b2a6b', '#ffffff'] },
  { name: 'Virtus Bologna', short: 'VIR', city: 'Bolonia', country: 'IT', comp: 4, strength: 3, colors: ['#111111', '#ffffff', '#888888'] },
  { name: 'Olimpia Milano', short: 'MIL', city: 'Milán', country: 'IT', comp: 4, strength: 4, colors: ['#e30613', '#ffffff', '#111111'] },
  { name: 'Bayern Múnich', short: 'BAY', city: 'Múnich', country: 'DE', comp: 4, strength: 3, colors: ['#dc052d', '#ffffff', '#0066b2'] },
  { name: 'Hapoel Jerusalén', short: 'HJE', city: 'Jerusalén', country: 'IL', comp: 5, strength: 2, colors: ['#e30613', '#ffffff', '#111111'] },
  { name: 'Lietkabelis', short: 'LIE', city: 'Panevėžys', country: 'LT', comp: 5, strength: 1, colors: ['#f47b20', '#111111', '#ffffff'] },
  { name: 'Bahçeşehir Koleji', short: 'BAH', city: 'Estambul', country: 'TR', comp: 5, strength: 1, colors: ['#0b2a6b', '#f6d200', '#ffffff'] },
  { name: 'Türk Telekom', short: 'TTA', city: 'Ankara', country: 'TR', comp: 5, strength: 1, colors: ['#e30613', '#0b2a6b', '#ffffff'] },
  { name: 'Ratiopharm Ulm', short: 'ULM', city: 'Ulm', country: 'DE', comp: 5, strength: 1, colors: ['#f47b20', '#0b2a6b', '#ffffff'] },
  { name: 'Aquila Trento', short: 'TRE', city: 'Trento', country: 'IT', comp: 5, strength: 1, colors: ['#003b7a', '#ffffff', '#111111'] },
  { name: 'Reyer Venezia', short: 'VEN', city: 'Venecia', country: 'IT', comp: 5, strength: 1, colors: ['#7a1f2b', '#d4af37', '#ffffff'] },
  { name: 'Cedevita Olimpija', short: 'CED', city: 'Liubliana', country: 'SI', comp: 5, strength: 1, colors: ['#0b7a3e', '#f6d200', '#ffffff'] },
  { name: 'Budućnost', short: 'BUD', city: 'Podgorica', country: 'ME', comp: 5, strength: 1, colors: ['#0b2a6b', '#ffffff', '#111111'] },
  { name: 'Paris Basketball', short: 'PAB', city: 'París', country: 'FR', comp: 5, strength: 2, colors: ['#111111', '#ffffff', '#c8102e'] },
  { name: 'Wolves Vilnius', short: 'WOL', city: 'Vilna', country: 'LT', comp: 5, strength: 0, colors: ['#111111', '#c8102e', '#ffffff'] },
  { name: 'Hamburg Towers', short: 'HAM', city: 'Hamburgo', country: 'DE', comp: 5, strength: 0, colors: ['#111111', '#ffffff', '#f47b20'] },
  { name: 'AEK Atenas', short: 'AEK', city: 'Atenas', country: 'GR', comp: 6, strength: 1, colors: ['#f6d200', '#111111', '#ffffff'] },
  { name: 'Rytas Vilnius', short: 'RYT', city: 'Vilna', country: 'LT', comp: 6, strength: 1, colors: ['#0b2a6b', '#7ec8f2', '#ffffff'] },
  { name: 'Galatasaray', short: 'GAL', city: 'Estambul', country: 'TR', comp: 6, strength: 1, colors: ['#a90432', '#fdb912', '#ffffff'] },
  { name: 'Tofaş', short: 'TOF', city: 'Bursa', country: 'TR', comp: 6, strength: 0, colors: ['#0b2a6b', '#ffffff', '#111111'] },
  { name: 'Karşıyaka', short: 'KSK', city: 'Esmirna', country: 'TR', comp: 6, strength: 0, colors: ['#0b7a3e', '#c8102e', '#ffffff'] },
  { name: 'Nanterre 92', short: 'NAN', city: 'Nanterre', country: 'FR', comp: 6, strength: 0, colors: ['#c8102e', '#ffffff', '#111111'] },
  { name: 'Le Mans Sarthe', short: 'LEM', city: 'Le Mans', country: 'FR', comp: 6, strength: 0, colors: ['#111111', '#7ec8f2', '#ffffff'] },
  { name: 'Peristeri', short: 'PER', city: 'Atenas', country: 'GR', comp: 6, strength: -1, colors: ['#0b2a6b', '#ffffff', '#111111'] },
  { name: 'Niners Chemnitz', short: 'CHE', city: 'Chemnitz', country: 'DE', comp: 6, strength: -1, colors: ['#5b2a86', '#ffffff', '#111111'] },
  { name: 'Bnei Herzliya', short: 'BNE', city: 'Herzliya', country: 'IL', comp: 6, strength: -1, colors: ['#f47b20', '#111111', '#ffffff'] },
  { name: 'Igokea', short: 'IGO', city: 'Aleksandrovac', country: 'RS', comp: 6, strength: -1, colors: ['#c8102e', '#ffffff', '#0b2a6b'] },
  { name: 'Dinamo Sassari', short: 'SAS', city: 'Sassari', country: 'IT', comp: 6, strength: -1, colors: ['#0b2a6b', '#ffffff', '#111111'] },
];
/** Nombre corto de las competiciones. */
export const COMP_INFO: Record<number, { name: string; short: string; kind: string }> = {
  1: { name: 'Liga ACB', short: 'ACB', kind: 'liga' },
  2: { name: 'Primera FEB', short: 'FEB', kind: 'liga' },
  3: { name: 'Copa del Rey', short: 'Copa', kind: 'copa' },
  4: { name: 'EuroLeague', short: 'EL', kind: 'europea' },
  5: { name: 'EuroCup', short: 'EC', kind: 'europea' },
  6: { name: 'Basketball Champions League', short: 'BCL', kind: 'europea' },
  7: { name: 'Betclic ÉLITE (Francia)', short: 'FRA', kind: 'extranjera' },
  8: { name: 'Serie A (Italia)', short: 'ITA', kind: 'extranjera' },
  9: { name: 'BBL (Alemania)', short: 'GER', kind: 'extranjera' },
  10: { name: 'Süper Ligi (Turquía)', short: 'TUR', kind: 'extranjera' },
  11: { name: 'Basket League (Grecia)', short: 'GRE', kind: 'extranjera' },
  12: { name: 'NBA', short: 'NBA', kind: 'extranjera' },
  13: { name: 'NCAA', short: 'NCAA', kind: 'extranjera' },
};
