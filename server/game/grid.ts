import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { ApiError } from '../db.js'
import type { GameState } from '../../shared/domain.js'
export const GRID_SIZE = 12
export const DIAMONDS_PER_CELL = 3
const coordinates = { x: z.number().int().min(0).max(GRID_SIZE - 1), y: z.number().int().min(0).max(GRID_SIZE - 1) }
export const mineSchema = z.object(coordinates).strict()

export function initializeGrid(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS grid_cells (
      x INTEGER NOT NULL, y INTEGER NOT NULL, stock INTEGER NOT NULL CHECK(stock >= 0), PRIMARY KEY(x, y)
    );
    CREATE TABLE IF NOT EXISTS grid_scores (
      team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      diamonds INTEGER NOT NULL DEFAULT 0 CHECK(diamonds >= 0)
    );
    INSERT OR IGNORE INTO grid_scores (team_id) SELECT id FROM teams;
  `)
  const insert = db.prepare('INSERT OR IGNORE INTO grid_cells (x, y, stock) VALUES (?, ?, ?)')
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) insert.run(x, y, DIAMONDS_PER_CELL)
}
export function createTeamGame(db: DatabaseSync, teamId: string, index: number) {
  db.prepare('INSERT INTO grid_positions (team_id, x, y) VALUES (?, ?, ?)').run(teamId, index % GRID_SIZE, Math.floor(index / GRID_SIZE) % GRID_SIZE)
  db.prepare('INSERT INTO grid_scores (team_id) VALUES (?)').run(teamId)
}
export function resetTeamGame(db: DatabaseSync, teamId: string) {
  db.prepare('UPDATE grid_positions SET x = 0, y = 0 WHERE team_id = ?').run(teamId)
  db.prepare('UPDATE grid_scores SET diamonds = 0 WHERE team_id = ?').run(teamId)
}
export function resetGame(db: DatabaseSync) {
  db.exec('UPDATE grid_positions SET x = 0, y = 0; UPDATE grid_scores SET diamonds = 0;')
  db.prepare('UPDATE grid_cells SET stock = ?').run(DIAMONDS_PER_CELL)
}
export const moveSchema = z.object({ x: z.number().int().min(0).max(GRID_SIZE - 1), y: z.number().int().min(0).max(GRID_SIZE - 1), fromX: z.number().int(), fromY: z.number().int() }).strict()
export function gameState(db: DatabaseSync, teamId: string): GameState {
  return {
    size: GRID_SIZE,
    diamonds: Number(db.prepare('SELECT diamonds FROM grid_scores WHERE team_id = ?').get(teamId)!.diamonds),
    cells: db.prepare('SELECT x, y, stock FROM grid_cells ORDER BY y, x').all() as unknown as GameState['cells'],
    teams: db.prepare('SELECT t.id, t.name, t.color, p.x, p.y FROM teams t JOIN grid_positions p ON t.id = p.team_id ORDER BY t.name COLLATE NOCASE, t.id').all() as unknown as GameState['teams'],
  }
}
// Caller owns the transaction: movement and resource deduction commit together.
export function move(db: DatabaseSync, teamId: string, input: z.infer<typeof moveSchema>) {
  const position = db.prepare('SELECT x, y FROM grid_positions WHERE team_id = ?').get(teamId) as { x: number; y: number }
  if (position.x !== input.fromX || position.y !== input.fromY) throw new ApiError(409, 'Your team has already moved. Choose a square again.')
  if (Math.abs(position.x - input.x) + Math.abs(position.y - input.y) !== 1) throw new ApiError(400, 'Choose a neighbouring square.')
  const debit = db.prepare('UPDATE teams SET research = research - 1 WHERE id = ? AND research >= 1').run(teamId)
  if (!debit.changes) throw new ApiError(400, 'You need 1 Research to move.')
  db.prepare('UPDATE grid_positions SET x = ?, y = ? WHERE team_id = ?').run(input.x, input.y, teamId)
}

// Caller owns the transaction: the last diamond can only go to one team.
export function mine(db: DatabaseSync, teamId: string, input: z.infer<typeof mineSchema>) {
  const position = db.prepare('SELECT x, y FROM grid_positions WHERE team_id = ?').get(teamId) as { x: number; y: number }
  if (position.x !== input.x || position.y !== input.y) throw new ApiError(409, 'Your team has moved. Mine at your current square.')
  const removed = db.prepare('UPDATE grid_cells SET stock = stock - 1 WHERE x = ? AND y = ? AND stock > 0').run(position.x, position.y)
  if (!removed.changes) throw new ApiError(400, 'No diamonds left here.')
  db.prepare('UPDATE grid_scores SET diamonds = diamonds + 1 WHERE team_id = ?').run(teamId)
}
