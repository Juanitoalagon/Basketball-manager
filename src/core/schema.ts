import { ATTR_KEYS } from './attributes';

/**
 * Esquema de la base de datos y migraciones numeradas.
 * Regla: nunca se edita una migración ya publicada; se añade otra al final.
 */

export const APP_VERSION = '0.7.0';
export const FORMAT_VERSION = 1;
/** Hasta la fase 3 no hay motor real: los partidos de prueba son sintéticos. */
export const ENGINE_VERSION = '0.1';

/** Interfaz mínima de base de datos. La implementan SQLite en el navegador y en las pruebas. */
export interface Stmt {
  run(bind: unknown[]): void;
  finalize(): void;
}
export interface Db {
  exec(sql: string, bind?: unknown[]): void;
  rows<T = Record<string, unknown>>(sql: string, bind?: unknown[]): T[];
  prepare(sql: string): Stmt;
}

/**
 * Transacción. Si ya hay una abierta (una operación que llama a otra), se usa un punto de guardado:
 * así una función puede usarse sola o dentro de otra sin romper nada.
 */
const depth = new WeakMap<object, number>();
let spN = 0;
export function transaction<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const sp = d > 0 ? `sp${++spN}` : null;
  db.exec(sp ? `SAVEPOINT ${sp}` : 'BEGIN IMMEDIATE');
  depth.set(db, d + 1);
  try {
    const out = fn();
    db.exec(sp ? `RELEASE ${sp}` : 'COMMIT');
    return out;
  } catch (e) {
    db.exec(sp ? `ROLLBACK TO ${sp}` : 'ROLLBACK');
    if (sp) db.exec(`RELEASE ${sp}`);
    throw e;
  } finally {
    depth.set(db, d);
  }
}

const BOX_COLS =
  'sec INTEGER NOT NULL, pts INTEGER NOT NULL, fgm2 INTEGER NOT NULL, fga2 INTEGER NOT NULL, ' +
  'fgm3 INTEGER NOT NULL, fga3 INTEGER NOT NULL, ftm INTEGER NOT NULL, fta INTEGER NOT NULL, ' +
  'orb INTEGER NOT NULL, drb INTEGER NOT NULL, ast INTEGER NOT NULL, stl INTEGER NOT NULL, ' +
  'blk INTEGER NOT NULL, tov INTEGER NOT NULL, pf INTEGER NOT NULL, fd INTEGER NOT NULL, ' +
  'blka INTEGER NOT NULL, pm INTEGER NOT NULL';

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'esquema inicial',
    sql: `
      CREATE TABLE universe (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, seed INTEGER NOT NULL,
        created_at TEXT NOT NULL, game_season INTEGER NOT NULL, game_day INTEGER NOT NULL,
        engine_version TEXT NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);

      CREATE TABLE competition (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, country TEXT, tier INTEGER
      );
      CREATE TABLE club (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, short TEXT NOT NULL, country TEXT NOT NULL,
        reputation INTEGER NOT NULL, budget INTEGER NOT NULL, competition_id INTEGER REFERENCES competition(id)
      );
      CREATE TABLE player (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, birth_year INTEGER NOT NULL, height_cm INTEGER NOT NULL,
        pos1 TEXT NOT NULL, pos2 TEXT, club_id INTEGER REFERENCES club(id),
        origin TEXT NOT NULL CHECK (origin IN ('real','generado')), ext_ids TEXT
      );
      CREATE INDEX player_club ON player(club_id);

      CREATE TABLE season (year INTEGER PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE game (
        id INTEGER PRIMARY KEY, season INTEGER NOT NULL, competition_id INTEGER NOT NULL, day INTEGER NOT NULL,
        home_id INTEGER NOT NULL, away_id INTEGER NOT NULL, home_pts INTEGER, away_pts INTEGER,
        seed INTEGER NOT NULL, engine_version TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE INDEX game_season_day ON game(season, day);
      CREATE INDEX game_home ON game(season, home_id);
      CREATE INDEX game_away ON game(season, away_id);
      CREATE TABLE game_player_box (
        game_id INTEGER NOT NULL, player_id INTEGER NOT NULL, club_id INTEGER NOT NULL, ${BOX_COLS},
        PRIMARY KEY (game_id, player_id)
      ) WITHOUT ROWID;
      -- Sin índice por jugador a propósito: obligaría a reescribir páginas dispersas en cada jornada.
      -- Los partidos de un jugador se buscan por los partidos de su club (game_home / game_away).
      CREATE TABLE game_shots (game_id INTEGER PRIMARY KEY, n INTEGER NOT NULL, data BLOB NOT NULL);

      CREATE TABLE player_season_stats (
        player_id INTEGER NOT NULL, season INTEGER NOT NULL, competition_id INTEGER NOT NULL, club_id INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('real','sim')), gp INTEGER NOT NULL, ${BOX_COLS},
        PRIMARY KEY (season, competition_id, player_id, club_id, source)
      ) WITHOUT ROWID;
      CREATE INDEX pss_player ON player_season_stats(player_id, season);
      CREATE TABLE shot_zone_stats (
        player_id INTEGER NOT NULL, season INTEGER NOT NULL, competition_id INTEGER NOT NULL, zone INTEGER NOT NULL,
        fga INTEGER NOT NULL, fgm INTEGER NOT NULL,
        PRIMARY KEY (season, competition_id, player_id, zone)
      ) WITHOUT ROWID;
      CREATE INDEX szs_player ON shot_zone_stats(player_id);

      CREATE TABLE import_batch (
        id INTEGER PRIMARY KEY, file_name TEXT NOT NULL, sha256 TEXT NOT NULL, origin TEXT NOT NULL, imported_at TEXT NOT NULL
      );
    `,
  },
];

const BOX2 =
  'sec INTEGER NOT NULL DEFAULT 0, pts INTEGER NOT NULL DEFAULT 0, fgm2 INTEGER NOT NULL DEFAULT 0, fga2 INTEGER NOT NULL DEFAULT 0, ' +
  'fgm3 INTEGER NOT NULL DEFAULT 0, fga3 INTEGER NOT NULL DEFAULT 0, ftm INTEGER NOT NULL DEFAULT 0, fta INTEGER NOT NULL DEFAULT 0, ' +
  'orb INTEGER NOT NULL DEFAULT 0, drb INTEGER NOT NULL DEFAULT 0, ast INTEGER NOT NULL DEFAULT 0, stl INTEGER NOT NULL DEFAULT 0, ' +
  'blk INTEGER NOT NULL DEFAULT 0, tov INTEGER NOT NULL DEFAULT 0, pf INTEGER NOT NULL DEFAULT 0, fd INTEGER NOT NULL DEFAULT 0, ' +
  'blka INTEGER NOT NULL DEFAULT 0, pm INTEGER NOT NULL DEFAULT 0';

MIGRATIONS.push({
  version: 2,
  name: 'modelo de juego: jugadores, motor, liga',
  // La versión 0.1 solo tenía universos de prueba sintéticos: se descartan.
  sql: `
    DROP TABLE IF EXISTS shot_zone_stats; DROP TABLE IF EXISTS player_season_stats; DROP TABLE IF EXISTS game_shots;
    DROP TABLE IF EXISTS game_player_box; DROP TABLE IF EXISTS game; DROP TABLE IF EXISTS season;
    DROP TABLE IF EXISTS player; DROP TABLE IF EXISTS club; DROP TABLE IF EXISTS competition; DROP TABLE IF EXISTS universe;
    DELETE FROM settings;

    CREATE TABLE universe (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, seed INTEGER NOT NULL, created_at TEXT NOT NULL,
      game_season INTEGER NOT NULL, game_day INTEGER NOT NULL, phase TEXT NOT NULL,
      user_club_id INTEGER, engine_version TEXT NOT NULL
    );
    CREATE TABLE competition (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, short TEXT NOT NULL, kind TEXT NOT NULL, country TEXT, tier INTEGER
    );
    CREATE TABLE club (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, short TEXT NOT NULL, city TEXT NOT NULL, country TEXT NOT NULL,
      reputation INTEGER NOT NULL, budget INTEGER NOT NULL, competition_id INTEGER REFERENCES competition(id)
    );
    CREATE TABLE player (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, nationality TEXT NOT NULL, birth_year INTEGER NOT NULL,
      height_cm INTEGER NOT NULL, weight_kg INTEGER NOT NULL, wingspan_cm INTEGER NOT NULL, hand TEXT NOT NULL,
      pos1 TEXT NOT NULL, pos2 TEXT, club_id INTEGER REFERENCES club(id), number INTEGER,
      potential INTEGER NOT NULL, potential_est INTEGER NOT NULL, retired INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL CHECK (origin IN ('real','generado')), ext_ids TEXT
    );
    CREATE INDEX player_club ON player(club_id);
    CREATE TABLE player_attributes (
      player_id INTEGER NOT NULL, season INTEGER NOT NULL, ovr INTEGER NOT NULL,
      ${ATTR_KEYS.map((k) => `${k} INTEGER NOT NULL`).join(', ')},
      PRIMARY KEY (player_id, season)
    ) WITHOUT ROWID;

    CREATE TABLE season (year INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE game (
      id INTEGER PRIMARY KEY, season INTEGER NOT NULL, competition_id INTEGER NOT NULL, stage TEXT NOT NULL,
      day INTEGER NOT NULL, series_id INTEGER, home_id INTEGER NOT NULL, away_id INTEGER NOT NULL,
      home_pts INTEGER, away_pts INTEGER, ot INTEGER NOT NULL DEFAULT 0,
      seed INTEGER NOT NULL, engine_version TEXT, status TEXT NOT NULL
    );
    CREATE INDEX game_day ON game(season, day);
    CREATE INDEX game_home ON game(season, home_id);
    CREATE INDEX game_away ON game(season, away_id);
    CREATE TABLE game_team_box (
      game_id INTEGER NOT NULL, club_id INTEGER NOT NULL, poss INTEGER NOT NULL, ${BOX2},
      PRIMARY KEY (game_id, club_id)
    ) WITHOUT ROWID;
    CREATE TABLE game_player_box (
      game_id INTEGER NOT NULL, player_id INTEGER NOT NULL, club_id INTEGER NOT NULL, gs INTEGER NOT NULL, ${BOX2},
      PRIMARY KEY (game_id, player_id)
    ) WITHOUT ROWID;
    CREATE TABLE game_shots (game_id INTEGER PRIMARY KEY, n INTEGER NOT NULL, data BLOB NOT NULL);
    CREATE TABLE game_pbp (game_id INTEGER PRIMARY KEY, data BLOB NOT NULL);
    CREATE TABLE playoff_series (
      id INTEGER PRIMARY KEY, season INTEGER NOT NULL, competition_id INTEGER NOT NULL, round INTEGER NOT NULL, slot INTEGER NOT NULL,
      high_id INTEGER NOT NULL, low_id INTEGER NOT NULL, high_seed INTEGER NOT NULL, low_seed INTEGER NOT NULL,
      best_of INTEGER NOT NULL, high_wins INTEGER NOT NULL DEFAULT 0, low_wins INTEGER NOT NULL DEFAULT 0, winner_id INTEGER
    );
    CREATE TABLE season_result (
      season INTEGER NOT NULL, competition_id INTEGER NOT NULL, champion_id INTEGER, runner_up_id INTEGER, regular_first_id INTEGER,
      PRIMARY KEY (season, competition_id)
    );

    CREATE TABLE player_season_stats (
      season INTEGER NOT NULL, competition_id INTEGER NOT NULL, stage TEXT NOT NULL, player_id INTEGER NOT NULL, club_id INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('real','sim')), gp INTEGER NOT NULL DEFAULT 0, gs INTEGER NOT NULL DEFAULT 0, ${BOX2},
      PRIMARY KEY (season, competition_id, stage, player_id, club_id, source)
    ) WITHOUT ROWID;
    CREATE INDEX pss_player ON player_season_stats(player_id, season);
    CREATE TABLE shot_zone_stats (
      season INTEGER NOT NULL, competition_id INTEGER NOT NULL, player_id INTEGER NOT NULL, zone INTEGER NOT NULL,
      fga INTEGER NOT NULL, fgm INTEGER NOT NULL,
      PRIMARY KEY (season, competition_id, player_id, zone)
    ) WITHOUT ROWID;
    CREATE INDEX szs_player ON shot_zone_stats(player_id);
  `,
});

MIGRATIONS.push({
  version: 3,
  name: 'quinteto y roles; datos reales importados',
  sql: `
    CREATE TABLE lineup (
      club_id INTEGER NOT NULL, player_id INTEGER NOT NULL, slot INTEGER, role TEXT NOT NULL DEFAULT 'rot',
      shoot TEXT NOT NULL DEFAULT 'normal',
      PRIMARY KEY (club_id, player_id)
    ) WITHOUT ROWID;
    CREATE TABLE tactics (club_id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    ALTER TABLE player ADD COLUMN estimated TEXT;
    CREATE TABLE real_game_line (
      batch_id INTEGER NOT NULL, season INTEGER NOT NULL, competition TEXT NOT NULL, day INTEGER NOT NULL, game_ext TEXT NOT NULL,
      player_id INTEGER NOT NULL, team TEXT NOT NULL, opponent TEXT, home INTEGER, win INTEGER, team_pts REAL, opp_pts REAL,
      min REAL, val REAL, sm_pts REAL,
      PRIMARY KEY (season, competition, game_ext, player_id)
    ) WITHOUT ROWID;
    CREATE INDEX rgl_player ON real_game_line(player_id, season);
    CREATE TABLE real_prediction (
      batch_id INTEGER NOT NULL, season INTEGER NOT NULL, day INTEGER NOT NULL, player_id INTEGER NOT NULL,
      prediction REAL, horizon REAL, price REAL, broker REAL, avg REAL,
      PRIMARY KEY (season, day, player_id)
    ) WITHOUT ROWID;
  `,
});

MIGRATIONS.push({
  version: 4,
  name: 'mercado, contratos, economía, lesiones, moral y noticias',
  sql: `
    CREATE TABLE contract (player_id INTEGER PRIMARY KEY, club_id INTEGER NOT NULL, salary INTEGER NOT NULL, until INTEGER NOT NULL);
    CREATE INDEX contract_club ON contract(club_id);
    ALTER TABLE club ADD COLUMN cash INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE player ADD COLUMN morale INTEGER NOT NULL DEFAULT 70;
    ALTER TABLE player ADD COLUMN injury_games INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE player ADD COLUMN injury TEXT;
    CREATE TABLE transfer (
      id INTEGER PRIMARY KEY, season INTEGER NOT NULL, day INTEGER NOT NULL, player_id INTEGER NOT NULL,
      from_club INTEGER, to_club INTEGER, fee INTEGER NOT NULL DEFAULT 0, salary INTEGER, until INTEGER, kind TEXT NOT NULL
    );
    CREATE INDEX transfer_player ON transfer(player_id);
    CREATE TABLE news (
      id INTEGER PRIMARY KEY, season INTEGER NOT NULL, day INTEGER NOT NULL, club_id INTEGER, player_id INTEGER,
      kind TEXT NOT NULL, text TEXT NOT NULL
    );
    CREATE INDEX news_club ON news(club_id, id);
    CREATE TABLE club_season_finance (
      season INTEGER NOT NULL, club_id INTEGER NOT NULL, budget INTEGER NOT NULL, wages INTEGER NOT NULL,
      prizes INTEGER NOT NULL DEFAULT 0, transfers_in INTEGER NOT NULL DEFAULT 0, transfers_out INTEGER NOT NULL DEFAULT 0,
      cash_end INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (season, club_id)
    ) WITHOUT ROWID;
  `,
});

MIGRATIONS.push({
  version: 5,
  name: 'copa, competiciones europeas, entrenamiento, cantera, ojeadores y colores',
  sql: `
    ALTER TABLE club ADD COLUMN colors TEXT;
    ALTER TABLE club ADD COLUMN facilities INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE club ADD COLUMN scouting INTEGER NOT NULL DEFAULT 2;
    ALTER TABLE club ADD COLUMN training TEXT;
    ALTER TABLE game ADD COLUMN round INTEGER;
    ALTER TABLE player ADD COLUMN youth INTEGER NOT NULL DEFAULT 0; -- club de la cantera (0 = ninguno)
    CREATE TABLE comp_group (
      season INTEGER NOT NULL, competition_id INTEGER NOT NULL, club_id INTEGER NOT NULL, grp TEXT NOT NULL,
      PRIMARY KEY (season, competition_id, club_id)
    ) WITHOUT ROWID;
    UPDATE game SET round = day WHERE stage = 'regular';
  `,
});

MIGRATIONS.push({
  version: 6,
  name: 'tendencias de jugador, cláusulas, negociaciones, ofertas, premios, seguimiento y ojeo',
  sql: `
    CREATE TABLE player_tendency (
      player_id INTEGER NOT NULL, key TEXT NOT NULL, value INTEGER NOT NULL,
      PRIMARY KEY (player_id, key)
    ) WITHOUT ROWID;
    ALTER TABLE contract ADD COLUMN clause INTEGER; -- cláusula de rescisión en euros (NULL = sin cláusula)
    CREATE TABLE negotiation (
      player_id INTEGER NOT NULL, club_id INTEGER NOT NULL, season INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, mood INTEGER NOT NULL DEFAULT 100,
      PRIMARY KEY (player_id, club_id, season)
    ) WITHOUT ROWID;
    CREATE TABLE market_offer (
      id INTEGER PRIMARY KEY, season INTEGER NOT NULL, day INTEGER NOT NULL,
      player_id INTEGER NOT NULL, from_club INTEGER NOT NULL, to_club INTEGER NOT NULL,
      fee INTEGER NOT NULL, swap_player_id INTEGER, status TEXT NOT NULL DEFAULT 'pendiente',
      expires_day INTEGER NOT NULL, note TEXT
    );
    CREATE INDEX market_offer_status ON market_offer(status, to_club);
    CREATE TABLE award (
      season INTEGER NOT NULL, competition_id INTEGER NOT NULL, award TEXT NOT NULL, rank INTEGER NOT NULL,
      player_id INTEGER NOT NULL, club_id INTEGER, value REAL,
      PRIMARY KEY (season, competition_id, award, rank)
    ) WITHOUT ROWID;
    CREATE INDEX award_player ON award(player_id);
    CREATE TABLE watch (player_id INTEGER PRIMARY KEY, added_season INTEGER NOT NULL);
    CREATE TABLE scouted (player_id INTEGER PRIMARY KEY, season INTEGER NOT NULL, potential INTEGER NOT NULL);
  `,
});

MIGRATIONS.push({
  version: 7,
  name: 'tiros defendidos, cansancio, química, minutos, entrenamiento individual, cesiones, directiva y bandeja',
  sql: `
    ALTER TABLE game_player_box ADD COLUMN dfga INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE game_player_box ADD COLUMN dfgm INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE game_team_box ADD COLUMN dfga INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE game_team_box ADD COLUMN dfgm INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE player_season_stats ADD COLUMN dfga INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE player_season_stats ADD COLUMN dfgm INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE player ADD COLUMN fatigue REAL NOT NULL DEFAULT 0; -- cansancio acumulado (0-1)
    ALTER TABLE player ADD COLUMN mood_note TEXT;                 -- por qué está contento o no
    ALTER TABLE club ADD COLUMN chemistry REAL NOT NULL DEFAULT 50;
    ALTER TABLE club ADD COLUMN confidence REAL NOT NULL DEFAULT 60; -- confianza de la directiva
    ALTER TABLE lineup ADD COLUMN minutes INTEGER;                -- minutos objetivo (NULL = automático)
    ALTER TABLE news ADD COLUMN read INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE news ADD COLUMN action TEXT;                      -- JSON: a dónde lleva el mensaje
    CREATE TABLE player_training (player_id INTEGER PRIMARY KEY, plan TEXT NOT NULL, since INTEGER NOT NULL);
    CREATE TABLE loan (
      player_id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, club_id INTEGER NOT NULL,
      season INTEGER NOT NULL, share REAL NOT NULL, day INTEGER NOT NULL
    );
    CREATE TABLE objective (
      season INTEGER NOT NULL, club_id INTEGER NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
      result TEXT, delta REAL, PRIMARY KEY (season, club_id)
    ) WITHOUT ROWID;
  `,
});

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function schemaVersion(db: Db): number {
  return Number(db.rows<{ user_version: number }>('PRAGMA user_version')[0]?.user_version ?? 0);
}

/** Aplica las migraciones pendientes. Devuelve la versión final. */
export function migrate(db: Db): number {
  const current = schemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `La partida usa el esquema ${current} y esta app solo conoce hasta el ${SCHEMA_VERSION}. Actualiza la app.`,
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.exec('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)', [
        m.version,
        m.name,
        new Date().toISOString(),
      ]);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return SCHEMA_VERSION;
}

export const TABLES = [
  'universe', 'settings', 'schema_migrations', 'competition', 'club', 'player', 'player_attributes', 'season', 'game',
  'game_team_box', 'game_player_box', 'game_shots', 'game_pbp', 'playoff_series', 'season_result',
  'player_season_stats', 'shot_zone_stats', 'import_batch', 'lineup', 'tactics', 'real_game_line', 'real_prediction', 'contract', 'transfer', 'news', 'club_season_finance', 'comp_group',
  'player_tendency', 'negotiation', 'market_offer', 'award', 'watch', 'scouted', 'player_training', 'loan', 'objective',
] as const;
/** Tablas de la partida (todas menos ajustes y migraciones): se vacían al crear un universo. */
export const GAME_TABLES = ['player_training', 'loan', 'objective', 'player_tendency', 'negotiation', 'market_offer', 'award', 'watch', 'scouted', 'comp_group', 'lineup', 'tactics', 'real_game_line', 'real_prediction', 'contract', 'transfer', 'news', 'club_season_finance', 'shot_zone_stats', 'player_season_stats', 'season_result', 'playoff_series', 'game_pbp', 'game_shots', 'game_player_box', 'game_team_box', 'game', 'season', 'player_attributes', 'player', 'club', 'competition', 'universe', 'import_batch'];

export function getSetting(db: Db, key: string): string | null {
  return db.rows<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])[0]?.value ?? null;
}
export function setSetting(db: Db, key: string, value: string): void {
  db.exec('INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}
/** Cada guardado confirmado sube la revisión; sirve para saber qué copia es más reciente. */
export function bumpRevision(db: Db): number {
  const r = Number(getSetting(db, 'revision') ?? '0') + 1;
  setSetting(db, 'revision', String(r));
  return r;
}
