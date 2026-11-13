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

export const COUNTRY_LABEL: Record<string, string> = { ES: 'España', US: 'EE. UU.', RS: 'Serbia', LT: 'Lituania', FR: 'Francia', AR: 'Argentina', SN: 'Senegal', IT: 'Italia' };

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
