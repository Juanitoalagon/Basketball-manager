/**
 * Resumen de fin de temporada (v0.9): todo lo que antes estaba repartido en una sola pantalla.
 * Clasificación y playoffs, títulos, premios, objetivo de la directiva, cuentas y presupuesto previsto,
 * contratos que terminan, mejores números del equipo y jóvenes (cantera y universitarios que salen al mercado).
 */
import { type Db } from './schema';
import { getUniverse, standings, PROMOTED } from './season';
import { COMP_INFO } from './names';
import { AWARD_LABEL } from './awards';
import { objectiveOf, OBJECTIVE_LABEL } from './club';
import { askSalary, seasonForecast } from './market';
import { NCAA } from './leagues';
import { playerLines } from './queries';

const ROUND = (comp: number, r: number, rounds: number) => (r === rounds ? 'final' : r === rounds - 1 ? 'semifinales' : comp === 1 || comp >= 3 ? 'cuartos' : 'primera ronda');

export function seasonSummary(db: Db, season?: number) {
  const u = getUniverse(db)!;
  const me = u.user_club_id!;
  const s = season ?? u.game_season;
  const club = db.rows<{ name: string; short: string }>('SELECT name, short FROM club WHERE id = ?', [me])[0]!;
  // Liga en la que jugó esa temporada.
  const league = db.rows<{ c: number }>("SELECT competition_id AS c FROM game WHERE season = ? AND stage = 'regular' AND competition_id IN (1, 2) AND (home_id = ? OR away_id = ?) LIMIT 1", [s, me, me])[0]?.c ?? 1;
  const table = standings(db, s, league);
  const pos = table.findIndex((r) => r.club_id === me) + 1;
  const row = table[pos - 1];
  const promoted = league === 2 && pos > 0 && pos <= PROMOTED;
  const relegated = league === 1 && pos > table.length - PROMOTED;
  // Cómo acabó en cada competición con eliminatorias.
  const runs: { comp: string; result: string; champion: string | null }[] = [];
  for (const comp of [1, 3, 4, 5, 6]) {
    const series = db.rows<{ round: number; high_id: number; low_id: number; winner_id: number | null }>('SELECT round, high_id, low_id, winner_id FROM playoff_series WHERE season = ? AND competition_id = ? ORDER BY round', [s, comp]);
    const inComp = series.some((x) => x.high_id === me || x.low_id === me) || db.rows('SELECT 1 FROM comp_group WHERE season = ? AND competition_id = ? AND club_id = ?', [s, comp, me]).length > 0;
    if (!inComp) continue;
    const champ = db.rows<{ champion_id: number | null; name: string | null }>('SELECT r.champion_id, c.name FROM season_result r LEFT JOIN club c ON c.id = r.champion_id WHERE r.season = ? AND r.competition_id = ?', [s, comp])[0];
    const rounds = Math.max(0, ...series.map((x) => x.round));
    const mine = series.filter((x) => x.high_id === me || x.low_id === me);
    const last = mine[mine.length - 1];
    let result: string;
    if (champ?.champion_id === me) result = '🏆 Campeón';
    else if (!last) result = comp === 1 ? 'Sin playoffs' : 'Eliminado en la fase de grupos';
    else if (last.winner_id === null) result = `En juego (${ROUND(comp, last.round, rounds || 3)})`;
    else if (last.round === rounds) result = '🥈 Subcampeón';
    else result = `Eliminado en ${ROUND(comp, last.round, rounds || 3)}`;
    runs.push({ comp: COMP_INFO[comp]?.name ?? '', result, champion: champ?.name ?? null });
  }
  const titles = db.rows<{ competition_id: number }>('SELECT competition_id FROM season_result WHERE season = ? AND champion_id = ?', [s, me]).map((t) => COMP_INFO[t.competition_id]?.name ?? '');
  // Premios: los de tus jugadores y el MVP de tu liga.
  const awards = db.rows<{ award: string; rank: number; competition_id: number; player_id: number; name: string; club_id: number | null }>(
    'SELECT a.award, a.rank, a.competition_id, a.player_id, p.name, a.club_id FROM award a JOIN player p ON p.id = a.player_id WHERE a.season = ? AND (a.club_id = ? OR (a.award = \'mvp\' AND a.rank = 1 AND a.competition_id = ?))',
    [s, me, league],
  ).map((a) => ({ ...a, label: AWARD_LABEL[a.award] ?? a.award, mine: a.club_id === me }));
  const obj = objectiveOf(db, s, me);
  const conf = db.rows<{ confidence: number }>('SELECT confidence FROM club WHERE id = ?', [me])[0]?.confidence ?? 60;
  // Cuentas: si la temporada ya se cerró, las reales; si no, la previsión.
  const fin = db.rows<{ budget: number; wages: number; prizes: number; gate: number; sponsor: number; costs: number; cash_end: number }>('SELECT budget, wages, prizes, gate, sponsor, costs, cash_end FROM club_season_finance WHERE season = ? AND club_id = ?', [s, me])[0];
  const money = fin
    ? { closed: true, budget: fin.budget, wages: fin.wages, gate: fin.gate, sponsor: fin.sponsor, costs: fin.costs, prizes: fin.prizes, cashEnd: fin.cash_end, nextBudget: db.rows<{ budget: number }>('SELECT budget FROM club WHERE id = ?', [me])[0]!.budget }
    : { closed: false, ...seasonForecast(db, me, s) };
  // Contratos que terminan.
  const expiring = s === u.game_season
    ? db.rows<{ id: number; name: string; pos1: string; ovr: number; birth_year: number; potential_est: number; morale: number; salary: number }>(
        `SELECT p.id, p.name, p.pos1, a.ovr, p.birth_year, p.potential_est, p.morale, c.salary FROM contract c JOIN player p ON p.id = c.player_id
         JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE c.club_id = ? AND c.until <= ? ORDER BY a.ovr DESC`,
        [s, me, s],
      ).map((r) => ({ ...r, age: s - r.birth_year, ask: askSalary({ ovr: r.ovr, age: s + 1 - r.birth_year, potential_est: r.potential_est, morale: r.morale }) }))
    : [];
  // Mejores números del equipo (todas las competiciones de la temporada).
  const lines = new Map<number, { id: number; name: string; gp: number; pts: number; reb: number; ast: number }>();
  for (const comp of [league, 3, 4, 5, 6]) {
    for (const l of playerLines(db, s, comp, 'all', me)) {
      const x = lines.get(l.id) ?? lines.set(l.id, { id: l.id, name: l.name, gp: 0, pts: 0, reb: 0, ast: 0 }).get(l.id)!;
      x.gp += l.gp; x.pts += l.pts; x.reb += l.orb + l.drb; x.ast += l.ast;
    }
  }
  const ls = [...lines.values()].filter((l) => l.gp >= 5);
  const lead = (k: 'pts' | 'reb' | 'ast') => {
    const b = [...ls].sort((a, c) => c[k] / c.gp - a[k] / a.gp)[0];
    return b ? { id: b.id, name: b.name, value: b[k] / b.gp } : null;
  };
  // Jóvenes: tu cantera y universitarios que van a salir al mercado.
  const youth = db.rows<{ id: number; name: string; pos1: string; ovr: number; potential_est: number; birth_year: number }>(
    'SELECT p.id, p.name, p.pos1, a.ovr, p.potential_est, p.birth_year FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.youth = ? AND p.retired = 0 ORDER BY p.potential_est DESC LIMIT 5',
    [s, me],
  ).map((r) => ({ ...r, age: s - r.birth_year }));
  const college = db.rows<{ id: number; name: string; pos1: string; ovr: number; potential_est: number; birth_year: number; club: string }>(
    `SELECT p.id, p.name, p.pos1, a.ovr, p.potential_est, p.birth_year, c.name AS club FROM player p JOIN club c ON c.id = p.club_id AND c.competition_id = ?
     JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.retired = 0 AND ? - p.birth_year >= 21 ORDER BY a.ovr DESC LIMIT 6`,
    [NCAA, s, s + 1],
  ).map((r) => ({ ...r, age: s - r.birth_year }));
  return {
    season: s, club, league: COMP_INFO[league]?.name ?? '', pos, teams: table.length, w: row?.w ?? 0, l: row?.l ?? 0, promoted, relegated,
    runs, titles, awards, objective: obj ? { ...obj, label: OBJECTIVE_LABEL[obj.kind] ?? obj.target } : null, confidence: conf, money,
    expiring, leaders: { pts: lead('pts'), reb: lead('reb'), ast: lead('ast') }, youth, college, phase: u.phase,
  };
}
