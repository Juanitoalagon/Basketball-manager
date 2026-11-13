/**
 * Premios de temporada, récords, historia de los clubes e informe de jóvenes.
 * Todo sale de las estadísticas simuladas; las fórmulas están en FORMULAS.md.
 */
import { type Db, bumpRevision, transaction } from './schema';
import { COMP, getUniverse } from './season';
import { playerLines, type PlayerLine } from './queries';
import { addNews, type MarketResult } from './market';
import { Rng, mixSeed } from './rng';
import { scoutNoise } from './world';
import { BOX_FIELDS } from './engine';

export const AWARD_LABEL: Record<string, string> = {
  mvp: 'MVP de la temporada',
  joven: 'Mejor jugador joven',
  defensor: 'Mejor defensor',
  sexto: 'Mejor sexto hombre',
  mejorado: 'Jugador más mejorado',
  quinteto: 'Quinteto ideal',
  mvp_final: 'MVP de la final',
};
export const AWARD_ORDER = ['mvp', 'quinteto', 'joven', 'defensor', 'sexto', 'mejorado', 'mvp_final'];

const pg = (l: PlayerLine, k: keyof PlayerLine) => (l.gp ? Number(l[k]) / l.gp : 0);
/** Puntuación de MVP: victorias añadidas más un poco por el rendimiento por partido y las victorias del equipo. */
const mvpScore = (l: PlayerLine, teamWins: number) => l.va + 0.12 * pg(l, 'pir') + 0.05 * teamWins;
const defScore = (l: PlayerLine) => l.dws + 0.8 * (pg(l, 'stl') + pg(l, 'blk')) + 0.15 * pg(l, 'drb');

function teamWins(db: Db, season: number, comp: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const g of db.rows<{ home_id: number; away_id: number; home_pts: number; away_pts: number }>(
    "SELECT home_id, away_id, home_pts, away_pts FROM game WHERE season = ? AND competition_id = ? AND stage = 'regular' AND status = 'jugado'",
    [season, comp],
  )) {
    const w = g.home_pts > g.away_pts ? g.home_id : g.away_id;
    m.set(w, (m.get(w) ?? 0) + 1);
  }
  return m;
}

/** Calcula y guarda los premios de una temporada terminada. Devuelve noticias. */
export function computeAwards(db: Db, season: number): string[] {
  if (db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM award WHERE season = ?', [season])[0]!.n) return [];
  const u = getUniverse(db)!;
  const news: string[] = [];
  const put = (comp: number, award: string, rank: number, l: { id: number; club_id: number }, value: number) =>
    db.exec('INSERT OR REPLACE INTO award VALUES (?,?,?,?,?,?,?)', [season, comp, award, rank, l.id, l.club_id, Math.round(value * 100) / 100]);

  for (const comp of [COMP.ACB, COMP.FEB]) {
    const lines = playerLines(db, season, comp, 'regular');
    if (!lines.length) continue;
    const maxGp = Math.max(...lines.map((l) => l.gp));
    const qual = lines.filter((l) => l.gp >= maxGp * 0.5 && l.sec >= 600 * 0.5 * maxGp);
    const wins = teamWins(db, season, comp);
    const byMvp = [...qual].sort((a, b) => mvpScore(b, wins.get(b.club_id) ?? 0) - mvpScore(a, wins.get(a.club_id) ?? 0));
    byMvp.slice(0, 3).forEach((l, i) => put(comp, 'mvp', i + 1, l, mvpScore(l, wins.get(l.club_id) ?? 0)));
    [...qual].filter((l) => l.age <= 22).sort((a, b) => b.va - a.va).slice(0, 3).forEach((l, i) => put(comp, 'joven', i + 1, l, l.va));
    [...qual].sort((a, b) => defScore(b) - defScore(a)).slice(0, 3).forEach((l, i) => put(comp, 'defensor', i + 1, l, defScore(l)));
    [...qual].filter((l) => (l.gs ?? 0) < l.gp / 2).sort((a, b) => b.va - a.va).slice(0, 3).forEach((l, i) => put(comp, 'sexto', i + 1, l, l.va));
    // Más mejorado: subida de media respecto a la temporada anterior, con minutos de verdad.
    const prev = new Map(db.rows<{ player_id: number; ovr: number }>('SELECT player_id, ovr FROM player_attributes WHERE season = ?', [season - 1]).map((r) => [r.player_id, r.ovr]));
    [...qual]
      .filter((l) => prev.has(l.id))
      .map((l) => ({ l, d: l.ovr - prev.get(l.id)! + 0.1 * l.va }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d)
      .slice(0, 3)
      .forEach((x, i) => put(comp, 'mejorado', i + 1, x.l, x.l.ovr - prev.get(x.l.id)!));
    // Quinteto ideal: dos exteriores, dos aleros/ala-pívots y un pívot.
    const team: PlayerLine[] = [];
    const slots: string[][] = [['PG', 'SG'], ['PG', 'SG'], ['SF', 'PF'], ['SF', 'PF'], ['C']];
    for (const allowed of slots) {
      const pick = byMvp.find((l) => !team.includes(l) && allowed.includes(l.pos1));
      if (pick) team.push(pick);
    }
    team.forEach((l, i) => put(comp, 'quinteto', i + 1, l, mvpScore(l, wins.get(l.club_id) ?? 0)));
    const mvp = byMvp[0];
    if (mvp) news.push(`${mvp.name} (${mvp.club}) es el MVP de la ${comp === COMP.ACB ? 'Liga ACB' : 'Primera FEB'}.`);
  }

  // MVP de cada final: el de más valoración del campeón en el último partido de la competición.
  for (const comp of [1, 3, 4, 5, 6]) {
    const fin = db.rows<{ id: number; winner_id: number }>(
      'SELECT s.id, s.winner_id FROM playoff_series s WHERE s.season = ? AND s.competition_id = ? AND s.winner_id IS NOT NULL ORDER BY s.round DESC LIMIT 1',
      [season, comp],
    )[0];
    if (!fin) continue;
    const best = db.rows<{ player_id: number; club_id: number; v: number }>(
      `SELECT b.player_id, b.club_id, SUM(b.pts + b.orb + b.drb + b.ast + b.stl + b.blk + b.fd - (b.fga2 + b.fga3 - b.fgm2 - b.fgm3) - (b.fta - b.ftm) - b.tov - b.pf - b.blka) AS v
       FROM game_player_box b JOIN game g ON g.id = b.game_id
       WHERE g.series_id = ? AND b.club_id = ? GROUP BY b.player_id ORDER BY v DESC LIMIT 1`,
      [fin.id, fin.winner_id],
    )[0];
    if (best) put(comp, 'mvp_final', 1, { id: best.player_id, club_id: best.club_id }, best.v);
  }

  // Noticias de los premios de tu club.
  for (const a of db.rows<{ award: string; rank: number; competition_id: number; name: string }>(
    'SELECT a.award, a.rank, a.competition_id, p.name FROM award a JOIN player p ON p.id = a.player_id WHERE a.season = ? AND a.club_id = ? AND (a.rank = 1 OR a.award = \'quinteto\')',
    [season, u.user_club_id],
  )) {
    news.push(`${a.name}: ${AWARD_LABEL[a.award]}${a.award === 'quinteto' ? '' : ''}.`);
  }
  for (const n of news) addNews(db, 'premio', n, u.user_club_id);
  return news;
}

export function awardsView(db: Db, season: number) {
  return db.rows<{ competition_id: number; award: string; rank: number; player_id: number; name: string; club: string | null; club_id: number | null; value: number; pos1: string; nationality: string; birth_year: number }>(
    `SELECT a.competition_id, a.award, a.rank, a.player_id, p.name, c.short AS club, a.club_id, a.value, p.pos1, p.nationality, p.birth_year
     FROM award a JOIN player p ON p.id = a.player_id LEFT JOIN club c ON c.id = a.club_id WHERE a.season = ? ORDER BY a.competition_id, a.award, a.rank`,
    [season],
  );
}
export function awardSeasons(db: Db): number[] {
  return db.rows<{ season: number }>('SELECT DISTINCT season FROM award ORDER BY season DESC').map((r) => r.season);
}

/* ───────────── Récords ───────────── */

const PIR_SQL = '(b.pts + b.orb + b.drb + b.ast + b.stl + b.blk + b.fd - (b.fga2 + b.fga3 - b.fgm2 - b.fgm3) - (b.fta - b.ftm) - b.tov - b.pf - b.blka)';
export function records(db: Db) {
  const game = (expr: string) => db.rows<{ v: number; player_id: number; name: string; club: string; season: number; game_id: number; rival: string }>(
    `SELECT ${expr} AS v, b.player_id, p.name, c.short AS club, g.season, g.id AS game_id,
       (SELECT short FROM club WHERE id = CASE WHEN g.home_id = b.club_id THEN g.away_id ELSE g.home_id END) AS rival
     FROM game_player_box b JOIN game g ON g.id = b.game_id JOIN player p ON p.id = b.player_id JOIN club c ON c.id = b.club_id
     ORDER BY v DESC LIMIT 10`,
  );
  const seasonAvg = (expr: string) => db.rows<{ v: number; player_id: number; name: string; club: string; season: number; gp: number }>(
    `SELECT ${expr} * 1.0 / SUM(s.gp) AS v, s.player_id, p.name, c.short AS club, s.season, SUM(s.gp) AS gp
     FROM player_season_stats s JOIN player p ON p.id = s.player_id JOIN club c ON c.id = s.club_id
     WHERE s.competition_id IN (1, 2) AND s.stage = 'regular' AND s.source = 'sim'
     GROUP BY s.season, s.player_id, s.club_id HAVING SUM(s.gp) >= 20 ORDER BY v DESC LIMIT 10`,
  );
  const career = (expr: string) => db.rows<{ v: number; player_id: number; name: string; gp: number; seasons: number; retired: number }>(
    `SELECT ${expr} AS v, s.player_id, p.name, SUM(s.gp) AS gp, COUNT(DISTINCT s.season) AS seasons, p.retired
     FROM player_season_stats s JOIN player p ON p.id = s.player_id
     WHERE s.source = 'sim' GROUP BY s.player_id ORDER BY v DESC LIMIT 10`,
  );
  return {
    game: {
      pts: game('b.pts'), reb: game('b.orb + b.drb'), ast: game('b.ast'), stl: game('b.stl'), blk: game('b.blk'), t3: game('b.fgm3'), val: game(PIR_SQL),
    },
    season: { pts: seasonAvg('SUM(s.pts)'), reb: seasonAvg('SUM(s.orb + s.drb)'), ast: seasonAvg('SUM(s.ast)'), val: seasonAvg('SUM(' + PIR_SQL.replaceAll('b.', 's.') + ')') },
    career: { pts: career('SUM(s.pts)'), reb: career('SUM(s.orb + s.drb)'), ast: career('SUM(s.ast)'), gp: career('SUM(s.gp)'), t3: career('SUM(s.fgm3)') },
  };
}
void BOX_FIELDS;

/* ───────────── Historia de un club ───────────── */

export function clubHistory(db: Db, clubId: number) {
  const seasons = db.rows<{ season: number; competition_id: number; w: number; l: number; pf: number; pa: number }>(
    `SELECT g.season, g.competition_id,
       SUM(CASE WHEN (g.home_id = ? AND g.home_pts > g.away_pts) OR (g.away_id = ? AND g.away_pts > g.home_pts) THEN 1 ELSE 0 END) AS w,
       SUM(CASE WHEN (g.home_id = ? AND g.home_pts < g.away_pts) OR (g.away_id = ? AND g.away_pts < g.home_pts) THEN 1 ELSE 0 END) AS l,
       SUM(CASE WHEN g.home_id = ? THEN g.home_pts ELSE g.away_pts END) AS pf,
       SUM(CASE WHEN g.home_id = ? THEN g.away_pts ELSE g.home_pts END) AS pa
     FROM game g WHERE (g.home_id = ? OR g.away_id = ?) AND g.stage = 'regular' AND g.status = 'jugado' AND g.competition_id IN (1, 2)
     GROUP BY g.season, g.competition_id ORDER BY g.season DESC`,
    [clubId, clubId, clubId, clubId, clubId, clubId, clubId, clubId],
  );
  const titles = db.rows<{ season: number; competition_id: number; kind: string }>(
    `SELECT season, competition_id, 'campeón' AS kind FROM season_result WHERE champion_id = ?
     UNION ALL SELECT season, competition_id, 'finalista' FROM season_result WHERE runner_up_id = ?
     ORDER BY season DESC`,
    [clubId, clubId],
  );
  // Posición final en la liga de cada temporada.
  const pos = new Map<string, number>();
  for (const s of seasons) {
    const table = db.rows<{ id: number; w: number; d: number }>(
      `SELECT c.id, SUM(CASE WHEN (g.home_id = c.id AND g.home_pts > g.away_pts) OR (g.away_id = c.id AND g.away_pts > g.home_pts) THEN 1 ELSE 0 END) AS w,
         SUM(CASE WHEN g.home_id = c.id THEN g.home_pts - g.away_pts ELSE g.away_pts - g.home_pts END) AS d
       FROM club c JOIN game g ON (g.home_id = c.id OR g.away_id = c.id)
       WHERE g.season = ? AND g.competition_id = ? AND g.stage = 'regular' AND g.status = 'jugado'
       GROUP BY c.id ORDER BY w DESC, d DESC`,
      [s.season, s.competition_id],
    );
    pos.set(`${s.season}-${s.competition_id}`, table.findIndex((r) => r.id === clubId) + 1);
  }
  const best = db.rows<{ name: string; player_id: number; pts: number; gp: number }>(
    `SELECT p.name, s.player_id, SUM(s.pts) AS pts, SUM(s.gp) AS gp FROM player_season_stats s JOIN player p ON p.id = s.player_id
     WHERE s.club_id = ? AND s.source = 'sim' GROUP BY s.player_id ORDER BY pts DESC LIMIT 5`,
    [clubId],
  );
  return { seasons: seasons.map((s) => ({ ...s, pos: pos.get(`${s.season}-${s.competition_id}`) ?? null })), titles, best };
}

/* ───────────── Informe de jóvenes ───────────── */

export function youthReport(db: Db, maxAge = 21) {
  const u = getUniverse(db)!;
  const rows = db.rows<{ id: number; name: string; birth_year: number; pos1: string; pos2: string | null; nationality: string; ovr: number; potential_est: number; club_id: number | null; club: string | null; youth: number; youth_club: string | null; watched: number; scouted: number | null; origin: string }>(
    `SELECT p.id, p.name, p.birth_year, p.pos1, p.pos2, p.nationality, a.ovr, p.potential_est, p.club_id, c.short AS club, p.youth, y.short AS youth_club, p.origin,
       (w.player_id IS NOT NULL) AS watched, s.season AS scouted
     FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ?
     LEFT JOIN club c ON c.id = p.club_id LEFT JOIN club y ON y.id = p.youth
     LEFT JOIN watch w ON w.player_id = p.id LEFT JOIN scouted s ON s.player_id = p.id
     WHERE p.retired = 0 AND ? - p.birth_year <= ?
     ORDER BY p.potential_est DESC, a.ovr DESC LIMIT 80`,
    [u.game_season, u.game_season, maxAge],
  );
  const lines = new Map<number, PlayerLine>();
  for (const comp of [1, 2]) for (const l of playerLines(db, u.game_season, comp, 'regular')) lines.set(l.id, l);
  const scoutCost = SCOUT_COST;
  return {
    season: u.game_season,
    userClub: u.user_club_id,
    scoutCost,
    rows: rows.map((r) => ({ ...r, age: u.game_season - r.birth_year, watched: !!r.watched, line: lines.get(r.id) ?? null, signFee: r.youth && r.youth !== u.user_club_id ? youthFee(r.potential_est) : null })),
  };
}

export const SCOUT_COST = 25_000;
/** Compensación por formación para llevarse a un juvenil de otro club. */
export const youthFee = (potEst: number) => Math.round((40_000 + Math.max(0, potEst - 55) * 12_000) / 5_000) * 5_000;

/** Ojear a un jugador: los ojeadores lo siguen de cerca y su potencial estimado se afina (error ±2). */
export function scoutPlayer(db: Db, playerId: number, clubId: number): MarketResult {
  const u = getUniverse(db)!;
  const c = db.rows<{ cash: number; scouting: number }>('SELECT cash, scouting FROM club WHERE id = ?', [clubId])[0]!;
  const p = db.rows<{ name: string; potential: number; ovr: number }>(
    'SELECT p.name, p.potential, a.ovr FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.id = ?',
    [u.game_season, playerId],
  )[0];
  if (!p) return { ok: false, message: 'Jugador no encontrado.' };
  if (db.rows('SELECT 1 FROM scouted WHERE player_id = ? AND season = ?', [playerId, u.game_season]).length) return { ok: false, message: 'Ya lo has ojeado esta temporada.' };
  if (c.cash < SCOUT_COST) return { ok: false, message: `Hacen falta ${Math.round(SCOUT_COST / 1000)} mil € de caja.` };
  const rng = new Rng(mixSeed(u.seed, playerId * 7 + u.game_season));
  const noise = Math.min(2, scoutNoise(c.scouting) / 3);
  const est = Math.max(p.ovr, Math.round(p.potential + (rng.next() + rng.next() - 1) * noise));
  transaction(db, () => {
    db.exec('UPDATE club SET cash = cash - ? WHERE id = ?', [SCOUT_COST, clubId]);
    db.exec('UPDATE player SET potential_est = ? WHERE id = ?', [est, playerId]);
    db.exec('INSERT OR REPLACE INTO scouted (player_id, season, potential) VALUES (?,?,?)', [playerId, u.game_season, est]);
    db.exec('INSERT OR IGNORE INTO watch (player_id, added_season) VALUES (?,?)', [playerId, u.game_season]);
    bumpRevision(db);
  });
  return { ok: true, message: `Informe de los ojeadores: ${p.name} tiene un potencial de ${est} (margen ±${Math.ceil(noise)}).` };
}

/** Llevarse a un juvenil de la cantera de otro club pagando la compensación por formación. */
export function signYouth(db: Db, playerId: number, clubId: number): MarketResult {
  const u = getUniverse(db)!;
  const p = db.rows<{ name: string; youth: number; potential_est: number; club_id: number | null }>('SELECT name, youth, potential_est, club_id FROM player WHERE id = ?', [playerId])[0];
  if (!p || !p.youth || p.club_id !== null) return { ok: false, message: 'No es un juvenil de cantera.' };
  if (p.youth === clubId) return { ok: false, message: 'Ya está en tu cantera.' };
  if (u.phase !== 'fin' && !(u.phase === 'regular' && u.game_day === 0)) return { ok: false, message: 'Los juveniles solo cambian de club en verano.' };
  const mine = db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM player WHERE youth = ? AND retired = 0', [clubId])[0]!.n;
  if (mine >= 8) return { ok: false, message: 'Tu cantera ya tiene 8 juveniles.' };
  const fee = youthFee(p.potential_est);
  const cash = db.rows<{ cash: number }>('SELECT cash FROM club WHERE id = ?', [clubId])[0]!.cash;
  if (cash < fee) return { ok: false, message: `La compensación es de ${Math.round(fee / 1000)} mil € y no tienes caja suficiente.` };
  transaction(db, () => {
    db.exec('UPDATE club SET cash = cash - ? WHERE id = ?', [fee, clubId]);
    db.exec('UPDATE club SET cash = cash + ? WHERE id = ?', [fee, p.youth]);
    db.exec('UPDATE player SET youth = ? WHERE id = ?', [clubId, playerId]);
    addNews(db, 'cantera', `${p.name} se incorpora a la cantera por ${Math.round(fee / 1000)} mil € de compensación.`, clubId, playerId);
    bumpRevision(db);
  });
  return { ok: true, message: `${p.name} se une a tu cantera.` };
}
