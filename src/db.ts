// D1 (SQLite) access. Every query is scoped by circle_id, so one group can
// never read or change another's data, whatever ids a request sends.

import type { Visit } from './ranking'

export interface CircleRow {
  id: string
  name: string
  token: string
  never_days: number
}

export interface MemberRow {
  id: string
  name: string
  active: number
}

export interface ListRow {
  id: string
  name: string
  active: number
}

export interface PlaceRow {
  id: string
  list_id: string
  name: string
  link: string | null
  notes: string | null
  active: number
}

interface VisitRow {
  id: string
  place_id: string
  date: string
  attendees: string
}

const now = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()

export function newToken(): string {
  // 128 random bits, base64url.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// --- circles & members ----------------------------------------------------

export function getCircleByToken(db: D1Database, token: string) {
  return db
    .prepare('SELECT id, name, token, never_days FROM circles WHERE token = ?')
    .bind(token)
    .first<CircleRow>()
}

export async function getMembers(db: D1Database, circleId: string): Promise<MemberRow[]> {
  const { results } = await db
    .prepare('SELECT id, name, active FROM members WHERE circle_id = ? ORDER BY created_at, rowid')
    .bind(circleId)
    .all<MemberRow>()
  return results
}

export async function addMember(db: D1Database, circleId: string, name: string): Promise<MemberRow> {
  const member = { id: newId(), name, active: 1 }
  await db
    .prepare('INSERT INTO members (id, circle_id, name, active, created_at) VALUES (?, ?, ?, 1, ?)')
    .bind(member.id, circleId, name, now())
    .run()
  return member
}

// --- generic update for members / lists / places ---------------------------

const UPDATABLE: Record<string, string[]> = {
  members: ['name', 'active'],
  lists: ['name', 'active'],
  places: ['name', 'link', 'notes', 'active', 'list_id'],
}

/** Set `changes` on one row of `table` in this circle. Returns false if no
 * such row. Column names come only from the allow-list above. */
export async function updateRow(
  db: D1Database,
  table: 'members' | 'lists' | 'places',
  circleId: string,
  id: string,
  changes: Record<string, string | number | null>,
): Promise<boolean> {
  const cols = Object.keys(changes).filter((c) => UPDATABLE[table].includes(c))
  if (cols.length === 0) return false
  const result = await db
    .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND circle_id = ?`)
    .bind(...cols.map((c) => changes[c]), id, circleId)
    .run()
  return result.meta.changes === 1
}

// --- lists -----------------------------------------------------------------

export async function getLists(db: D1Database, circleId: string, includeInactive = false): Promise<ListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, active FROM lists WHERE circle_id = ? ${includeInactive ? '' : 'AND active = 1'}
       ORDER BY created_at, rowid`,
    )
    .bind(circleId)
    .all<ListRow>()
  return results
}

export function getList(db: D1Database, circleId: string, listId: string) {
  return db
    .prepare('SELECT id, name, active FROM lists WHERE id = ? AND circle_id = ?')
    .bind(listId, circleId)
    .first<ListRow>()
}

export async function createList(db: D1Database, circleId: string, name: string): Promise<ListRow> {
  const list = { id: newId(), name, active: 1 }
  await db
    .prepare('INSERT INTO lists (id, circle_id, name, active, created_at) VALUES (?, ?, ?, 1, ?)')
    .bind(list.id, circleId, name, now())
    .run()
  return list
}

// --- places ----------------------------------------------------------------

export async function getPlaces(
  db: D1Database,
  circleId: string,
  listId: string | null = null,
  includeInactive = false,
): Promise<PlaceRow[]> {
  const where = ['circle_id = ?']
  const params = [circleId]
  if (listId !== null) {
    where.push('list_id = ?')
    params.push(listId)
  }
  if (!includeInactive) where.push('active = 1')
  const { results } = await db
    .prepare(
      `SELECT id, list_id, name, link, notes, active FROM places WHERE ${where.join(' AND ')}
       ORDER BY created_at, rowid`,
    )
    .bind(...params)
    .all<PlaceRow>()
  return results
}

export function getPlace(db: D1Database, circleId: string, placeId: string) {
  return db
    .prepare('SELECT id, list_id, name, link, notes, active FROM places WHERE id = ? AND circle_id = ?')
    .bind(placeId, circleId)
    .first<PlaceRow>()
}

export async function createPlace(
  db: D1Database,
  circleId: string,
  listId: string,
  place: { name: string; link: string | null; notes: string | null },
): Promise<PlaceRow> {
  const row = { id: newId(), list_id: listId, ...place, active: 1 }
  await db
    .prepare(
      'INSERT INTO places (id, circle_id, list_id, name, link, notes, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    )
    .bind(row.id, circleId, listId, row.name, row.link, row.notes, now())
    .run()
  return row
}

// --- visits ----------------------------------------------------------------

/** All visits for the given places (or the whole circle), newest first. */
export async function getVisits(db: D1Database, circleId: string, placeIds: string[] | null = null): Promise<Visit[]> {
  let results: VisitRow[]
  if (placeIds === null) {
    ;({ results } = await db
      .prepare('SELECT id, place_id, date, attendees FROM visits WHERE circle_id = ? ORDER BY date DESC, created_at DESC')
      .bind(circleId)
      .all<VisitRow>())
  } else if (placeIds.length === 0) {
    return []
  } else {
    // json_each keeps it one bound parameter however many places there are.
    ;({ results } = await db
      .prepare(
        `SELECT id, place_id, date, attendees FROM visits
         WHERE circle_id = ? AND place_id IN (SELECT value FROM json_each(?))
         ORDER BY date DESC, created_at DESC`,
      )
      .bind(circleId, JSON.stringify(placeIds))
      .all<VisitRow>())
  }
  return results.map((r) => ({ id: r.id, placeId: r.place_id, date: r.date, attendees: JSON.parse(r.attendees) }))
}

export async function createVisit(
  db: D1Database,
  circleId: string,
  placeId: string,
  date: string,
  attendees: string[],
): Promise<Visit> {
  const visit = { id: newId(), placeId, date, attendees }
  await db
    .prepare('INSERT INTO visits (id, circle_id, place_id, date, attendees, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(visit.id, circleId, placeId, date, JSON.stringify(attendees), now())
    .run()
  return visit
}

export async function deleteVisit(db: D1Database, circleId: string, visitId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM visits WHERE id = ? AND circle_id = ?').bind(visitId, circleId).run()
  return result.meta.changes === 1
}

export async function ping(db: D1Database): Promise<boolean> {
  try {
    await db.prepare('SELECT 1').first()
    return true
  } catch {
    return false
  }
}

/** Used by tests. Real groups are created by scripts/create-circle.mjs. */
export async function createCircle(db: D1Database, name: string, memberNames: string[], neverDays = 365) {
  const circle = { id: newId(), name, token: newToken(), never_days: neverDays }
  await db
    .prepare('INSERT INTO circles (id, name, token, never_days, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(circle.id, name, circle.token, neverDays, now())
    .run()
  const members = []
  for (const n of memberNames) members.push(await addMember(db, circle.id, n))
  return { ...circle, members }
}
