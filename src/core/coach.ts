/** Decisiones del entrenador sobre jugadores concretos: tendencias y posición. */
import { ATTR_KEYS, type Attrs, POSITIONS, type Pos, overall } from './attributes';
import { TEND_KEYS, type TendKey, naturalTendencies } from './engine';
import { type Db, bumpRevision, transaction } from './schema';
import { getUniverse } from './season';

function attrsOf(db: Db, id: number, season: number): { attrs: Attrs; height: number; pos1: Pos; pos2: Pos | null; club_id: number | null } {
  const r = db.rows<Record<string, number | string | null>>(
    'SELECT p.height_cm, p.pos1, p.pos2, p.club_id, a.* FROM player p JOIN player_attributes a ON a.player_id = p.id AND a.season = ? WHERE p.id = ?',
    [season, id],
  )[0];
  if (!r) throw new Error('Jugador no encontrado.');
  return {
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as Attrs,
    height: Number(r.height_cm),
    pos1: r.pos1 as Pos,
    pos2: (r.pos2 as Pos | null) ?? null,
    club_id: r.club_id === null ? null : Number(r.club_id),
  };
}

export function playerTendencies(db: Db, id: number) {
  const u = getUniverse(db)!;
  const p = attrsOf(db, id, u.game_season);
  const natural = naturalTendencies(p.attrs, p.height);
  const override: Partial<Record<TendKey, number>> = {};
  for (const t of db.rows<{ key: TendKey; value: number }>('SELECT key, value FROM player_tendency WHERE player_id = ?', [id])) override[t.key] = t.value;
  return { natural, override, editable: p.club_id !== null && p.club_id === u.user_club_id };
}

/** Guarda las tendencias de un jugador propio. Un valor igual al natural (o null) quita el ajuste. */
export function setTendencies(db: Db, id: number, values: Partial<Record<TendKey, number | null>>) {
  const u = getUniverse(db)!;
  const p = attrsOf(db, id, u.game_season);
  if (p.club_id !== u.user_club_id) throw new Error('Solo puedes ajustar a jugadores de tu equipo.');
  const natural = naturalTendencies(p.attrs, p.height);
  transaction(db, () => {
    for (const k of TEND_KEYS) {
      if (!(k in values)) continue;
      const v = values[k];
      if (v === null || v === undefined || Math.round(v) === natural[k]) db.exec('DELETE FROM player_tendency WHERE player_id = ? AND key = ?', [id, k]);
      else db.exec('INSERT OR REPLACE INTO player_tendency (player_id, key, value) VALUES (?,?,?)', [id, k, Math.max(1, Math.min(99, Math.round(v)))]);
    }
    bumpRevision(db);
  });
  return playerTendencies(db, id);
}

/** Cambia la posición principal (y secundaria) de un jugador propio; su media pasa a ser la del nuevo puesto. */
export function setPositions(db: Db, id: number, pos1: Pos, pos2: Pos | null) {
  const u = getUniverse(db)!;
  const p = attrsOf(db, id, u.game_season);
  if (p.club_id !== u.user_club_id) throw new Error('Solo puedes cambiar la posición de jugadores de tu equipo.');
  if (!POSITIONS.includes(pos1) || (pos2 !== null && !POSITIONS.includes(pos2))) throw new Error('Posición no válida.');
  const second = pos2 === pos1 ? null : pos2;
  transaction(db, () => {
    db.exec('UPDATE player SET pos1 = ?, pos2 = ? WHERE id = ?', [pos1, second, id]);
    db.exec('UPDATE player_attributes SET ovr = ? WHERE player_id = ? AND season = ?', [overall(p.attrs, pos1, p.height), id, u.game_season]);
    bumpRevision(db);
  });
  return { ok: true, message: `Ahora juega de ${pos1}${second ? ` / ${second}` : ''}.` };
}
