/**
 * Ingresos por resultados (v0.9): taquilla en cada partido en casa, patrocinio al final de la temporada
 * según cómo haya ido y gastos fijos del club. Todo se mide sobre el presupuesto base del club (B, lo que
 * le da la directiva sin la caja que se haya pasado a salarios), así un club grande ingresa más.
 *
 *   ocupación = 0,5 + 0,2·(reputación − 60)/30 + 0,35·(% victorias − 0,5) + 0,05·(reputación rival − 60)/30   (entre 0,3 y 1)
 *   taquilla  = B · 0,0095 · ocupación / 0,7 · fase   (playoffs ×1,4, cruces europeos ×1,5, Europa ×1,1, Copa ×0,6 a cada uno)
 *   patrocinio = B · (0,06 + 0,10 · % victorias de la temporada)
 *   gastos     = B · 0,26
 */
import type { Db } from './schema';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const STAGE: Record<string, number> = { regular: 1, grupos: 1.1, playoffs: 1.4, eliminatoria: 1.5, copa: 0.6 };

export function winPct(db: Db, clubId: number, season: number): number {
  const r = db.rows<{ w: number | null; n: number }>(
    `SELECT SUM(CASE WHEN (home_id = ? AND home_pts > away_pts) OR (away_id = ? AND away_pts > home_pts) THEN 1 ELSE 0 END) AS w, COUNT(*) AS n
     FROM game WHERE season = ? AND status = 'jugado' AND (home_id = ? OR away_id = ?)`,
    [clubId, clubId, season, clubId, clubId],
  )[0]!;
  return r.n ? Number(r.w ?? 0) / r.n : 0.5;
}

interface ClubEcon { id: number; reputation: number; base: number }
function clubEcon(db: Db, id: number): ClubEcon {
  const c = db.rows<{ reputation: number; budget: number; budget_extra: number }>('SELECT reputation, budget, budget_extra FROM club WHERE id = ?', [id])[0];
  return { id, reputation: c?.reputation ?? 60, base: Math.max(0, (c?.budget ?? 0) - (c?.budget_extra ?? 0)) };
}

/** Taquilla de un partido para el club local (en la Copa, sede neutral: se reparte entre los dos). */
export function gateFor(db: Db, season: number, homeId: number, awayId: number, stage: string): { home: number; away: number } {
  const h = clubEcon(db, homeId);
  const a = clubEcon(db, awayId);
  const one = (c: ClubEcon, opp: ClubEcon) => {
    if (c.base <= 0) return 0;
    const fill = clamp(0.5 + (0.2 * (c.reputation - 60)) / 30 + 0.35 * (winPct(db, c.id, season) - 0.5) + (0.05 * (opp.reputation - 60)) / 30, 0.3, 1);
    return Math.round((c.base * 0.0095 * fill) / 0.7 * (STAGE[stage] ?? 1) / 1000) * 1000;
  };
  if (stage === 'copa') return { home: one(h, a), away: one(a, h) };
  return { home: one(h, a), away: 0 };
}

/** Suma la taquilla a la caja y al acumulado de la temporada. */
export function creditGate(db: Db, season: number, homeId: number, awayId: number, stage: string): void {
  const g = gateFor(db, season, homeId, awayId, stage);
  if (g.home) db.exec('UPDATE club SET cash = cash + ?, gate = gate + ? WHERE id = ?', [g.home, g.home, homeId]);
  if (g.away) db.exec('UPDATE club SET cash = cash + ?, gate = gate + ? WHERE id = ?', [g.away, g.away, awayId]);
}

/** Patrocinio y gastos fijos de la temporada (se cobran y pagan al cerrarla). */
export function seasonIncome(db: Db, clubId: number, season: number, base: number): { sponsor: number; costs: number; winPct: number } {
  const wp = winPct(db, clubId, season);
  if (base <= 0) return { sponsor: 0, costs: 0, winPct: wp };
  return { sponsor: Math.round((base * (0.06 + 0.1 * wp)) / 1000) * 1000, costs: Math.round((base * 0.26) / 1000) * 1000, winPct: wp };
}
