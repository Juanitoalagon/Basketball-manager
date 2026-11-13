/**
 * Fórmulas estadísticas. Las mismas para datos reales y simulados.
 * Cada fórmula está documentada en docs-formulas (FORMULAS.md) con un ejemplo numérico.
 */

export interface Line {
  gp: number; gs?: number; sec: number; pts: number; fgm2: number; fga2: number; fgm3: number; fga3: number;
  ftm: number; fta: number; orb: number; drb: number; ast: number; stl: number; blk: number; tov: number;
  pf: number; fd: number; blka: number; pm: number;
}

export const fgm = (l: Line) => l.fgm2 + l.fgm3;
export const fga = (l: Line) => l.fga2 + l.fga3;
export const reb = (l: Line) => l.orb + l.drb;
export const pct = (m: number, a: number) => (a > 0 ? m / a : null);
/** eFG% = (TC anotados + 0,5 · triples anotados) / TC intentados */
export const efg = (l: Line) => pct(fgm(l) + 0.5 * l.fgm3, fga(l));
/** TS% = PTS / (2 · (TCI + 0,44 · TLI)) */
export const ts = (l: Line) => (fga(l) + l.fta > 0 ? l.pts / (2 * (fga(l) + 0.44 * l.fta)) : null);
/** Valoración (PIR): (PTS + REB + AST + ROB + TAP + FR) − (TC fallados + TL fallados + PÉR + TAP recibidos + FC) */
export const pir = (l: Line) =>
  l.pts + reb(l) + l.ast + l.stl + l.blk + l.fd - (fga(l) - fgm(l)) - (l.fta - l.ftm) - l.tov - l.blka - l.pf;
/** Posesiones usadas (estimación clásica): TCI + 0,44 · TLI + PÉR */
export const possUsed = (l: Line) => fga(l) + 0.44 * l.fta + l.tov;

export interface TeamTotals extends Line {
  poss: number;
  opp: Line & { poss: number };
}

/** USG% = 100 · posesiones usadas · (minutos de equipo / 5) / (minutos del jugador · posesiones usadas del equipo) */
export function usg(l: Line, t: TeamTotals): number | null {
  if (l.sec <= 0) return null;
  return (100 * possUsed(l) * (t.sec / 5)) / (l.sec * possUsed(t));
}
/** AST% = 100 · AST / ((minutos / (minutos equipo / 5)) · TC anotados del equipo − TC anotados propios) */
export function astPct(l: Line, t: TeamTotals): number | null {
  if (l.sec <= 0) return null;
  const d = (l.sec / (t.sec / 5)) * fgm(t) - fgm(l);
  return d > 0 ? (100 * l.ast) / d : null;
}
/** REB% = 100 · REB · (minutos equipo / 5) / (minutos · (REB equipo + REB rival)) */
export function rebPct(l: Line, t: TeamTotals): number | null {
  if (l.sec <= 0) return null;
  return (100 * reb(l) * (t.sec / 5)) / (l.sec * (reb(t) + reb(t.opp)));
}
/** TOV% = 100 · PÉR / (TCI + 0,44 · TLI + PÉR) */
export const tovPct = (l: Line) => (possUsed(l) > 0 ? (100 * l.tov) / possUsed(l) : null);

/** Valoraciones de equipo por 100 posesiones (exactas: el motor cuenta las posesiones). */
export const ortg = (t: TeamTotals) => (t.poss > 0 ? (100 * t.pts) / t.poss : null);
export const drtg = (t: TeamTotals) => (t.opp.poss > 0 ? (100 * t.opp.pts) / t.opp.poss : null);
/** Ritmo: posesiones por 40 minutos. */
export const pace = (t: TeamTotals) => (t.sec > 0 ? (t.poss * 40 * 60 * 5) / t.sec : null);

/** Four Factors de Dean Oliver. */
export function fourFactors(t: TeamTotals) {
  return {
    efg: efg(t),
    tov: possUsed(t) > 0 ? t.tov / possUsed(t) : null,
    orb: t.orb + t.opp.drb > 0 ? t.orb / (t.orb + t.opp.drb) : null,
    ftr: fga(t) > 0 ? t.ftm / fga(t) : null,
  };
}

/**
 * Victorias añadidas (VA): victorias que aporta un jugador por encima de un jugador de reemplazo
 * (el nivel de un suplente que cualquier club puede fichar sin coste). Un equipo entero de reemplazo
 * ganaría un REPLACEMENT_WIN_PCT de sus partidos, así que en sus minutos aportaría:
 *   WS_reemplazo_i = REPLACEMENT_WIN_PCT · partidos del equipo · (segundos_i / segundos de jugador del equipo)
 *   VA_i = WS_i − WS_reemplazo_i
 */
export const REPLACEMENT_WIN_PCT = 0.2;
export function winsAdded(ws: number, sec: number, teamGames: number, teamSec: number): number {
  return teamSec > 0 ? ws - (REPLACEMENT_WIN_PCT * teamGames * sec) / teamSec : 0;
}

/** Constante de puntos por victoria (ver winShares). */
export const WS_K = 0.42;

export interface League {
  pts: number;
  poss: number;
  teamGames: number;
  sec: number;
}

/**
 * Win Shares (versión 1, simplificada y coherente por construcción).
 *
 * Puntos por victoria del equipo: PPW = K · PPG_liga · (ritmo_equipo / ritmo_liga)
 * K = 0,32 en el método original (NBA). Aquí K = WS_K, medido en el universo simulado: con 6 temporadas
 * de prueba, cada victoria por encima del 50 % costó 0,42 · PPG puntos de diferencia. Se revisará con datos reales.
 *
 * Ataque. Puntos producidos y posesiones usadas se reparten dentro del equipo y se escalan para que
 * sumen exactamente los puntos y las posesiones del equipo:
 *   bruto_i = PTS_i + 0,5 · AST_i · (PTS_equipo / TC anotados_equipo)
 *   PProd_i = bruto_i · PTS_equipo / Σ bruto
 *   Pos_i = posesiones usadas_i · Pos_equipo / Σ posesiones usadas
 *   OWS_i = (PProd_i − (1 − K/4) · PPP_liga · Pos_i) / PPW      (con K = 0,32 es el 0,92 original)
 *
 * Defensa. El total del equipo es DWS = Pos_rival · ((1 + K/4) · PPP_liga − DRtg/100) / PPW, repartido
 * según minutos, corregido por acciones defensivas por minuto (robos, tapones, rebote defensivo,
 * faltas) frente a la media del equipo, con el factor limitado entre 0,4 y 1,6.
 *
 * Así, OWS + DWS de un equipo ≈ partidos/2 + (PF − PC)/PPW, es decir, cerca de sus victorias.
 */
export function winShares(players: (Line & { id: number })[], t: TeamTotals, lg: League): Map<number, { ows: number; dws: number; ws: number }> {
  const out = new Map<number, { ows: number; dws: number; ws: number }>();
  if (!players.length || t.poss <= 0 || lg.poss <= 0 || lg.teamGames <= 0) return out;
  const lgPPP = lg.pts / lg.poss;
  const lgPPG = lg.pts / lg.teamGames;
  const lgPace = (lg.poss * 2400 * 5) / lg.sec;
  const teamPace = pace(t) ?? lgPace;
  const ppw = WS_K * lgPPG * (teamPace / lgPace);
  const ptsPerFgm = fgm(t) > 0 ? t.pts / fgm(t) : 2;
  const raw = players.map((p) => p.pts + 0.5 * p.ast * ptsPerFgm);
  const rawSum = raw.reduce((a, b) => a + b, 0) || 1;
  const used = players.map(possUsed);
  const usedSum = used.reduce((a, b) => a + b, 0) || 1;
  const teamDws = (t.opp.poss * ((1 + WS_K / 4) * lgPPP - (drtg(t) ?? 100 * lgPPP) / 100)) / ppw;
  const rate = (p: Line) => (p.sec > 0 ? (p.stl + 0.7 * p.blk + 0.3 * p.drb - 0.25 * p.pf) / p.sec : 0);
  const secSum = players.reduce((a, p) => a + p.sec, 0) || 1;
  const avgRate = players.reduce((a, p) => a + rate(p) * p.sec, 0) / secSum;
  const w = players.map((p) => p.sec * Math.max(0.4, Math.min(1.6, 1 + (avgRate > 0 ? 0.6 * (rate(p) - avgRate) / avgRate : 0))));
  const wSum = w.reduce((a, b) => a + b, 0) || 1;
  players.forEach((p, i) => {
    const pprod = (raw[i]! * t.pts) / rawSum;
    const pos = (used[i]! * t.poss) / usedSum;
    const ows = (pprod - (1 - WS_K / 4) * lgPPP * pos) / ppw;
    const dws = (teamDws * w[i]!) / wSum;
    out.set(p.id, { ows, dws, ws: ows + dws });
  });
  return out;
}
