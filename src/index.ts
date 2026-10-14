// The API, running as a Cloudflare Worker. Static files (the React app) are
// served by Workers static assets; only /api/* and /health reach this code
// (see run_worker_first in wrangler.jsonc).

import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import * as db from './db'
import { DEFAULT_NEVER_DAYS, rankPlaces, type RankedPlace, type Visit } from './ranking'
import * as v from './validate'

export interface Env {
  DB: D1Database
  APP_TIMEZONE?: string
}

type Vars = { circle: db.CircleRow; members: db.MemberRow[] }
type Ctx = Context<{ Bindings: Env; Variables: Vars }>

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

/** "Today" in the group's timezone (default Asia/Jerusalem), so a visit
 * logged at 00:30 still belongs to the right night. */
export function today(timeZone = 'Asia/Jerusalem'): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  )
}

// The share link's token is the group's only key: never leak it in a
// Referer, never let it be indexed, never cache API answers.
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Robots-Tag', 'noindex, nofollow')
  c.header('Cache-Control', 'no-store')
})

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ detail: err.message }, err.status)
  console.error(err)
  return c.json({ detail: 'Something went wrong - try again.' }, 500)
})

app.notFound((c) => c.json({ detail: 'Not found' }, 404))

app.get('/health', async (c) =>
  (await db.ping(c.env.DB)) ? c.json({ status: 'ok' }) : c.json({ status: 'database unreachable' }, 503),
)

// Every group route: look up the circle by token first.
app.use('/api/c/:token/*', loadCircle)
app.use('/api/c/:token', loadCircle)

async function loadCircle(c: Ctx, next: () => Promise<void>) {
  const circle = await db.getCircleByToken(c.env.DB, c.req.param('token')!)
  if (!circle) v.fail(404, 'Group not found - check the link')
  c.set('circle', circle!)
  c.set('members', await db.getMembers(c.env.DB, circle!.id))
  await next()
}

// --- helpers ---------------------------------------------------------------

const neverDays = (c: Ctx) => c.get('circle').never_days ?? DEFAULT_NEVER_DAYS
const todayFor = (c: Ctx) => today(c.env.APP_TIMEZONE || undefined)
const activeMemberIds = (c: Ctx) => new Set(c.get('members').filter((m) => m.active).map((m) => m.id))

async function body(c: Ctx) {
  return v.asObject(await c.req.json().catch(() => v.fail(422, 'Expected a JSON body')))
}

const formatList = (l: db.ListRow) => ({ id: l.id, name: l.name, active: !!l.active })
const formatPlace = (p: db.PlaceRow) => ({
  id: p.id,
  list_id: p.list_id,
  name: p.name,
  link: p.link,
  notes: p.notes,
  active: !!p.active,
})

/** Tonight's people from ?members=a,b,c - must be current group members. */
function tonight(c: Ctx): string[] {
  const ids = [...new Set((c.req.query('members') ?? '').split(',').filter(Boolean))]
  if (ids.length === 0) v.fail(422, 'Pick at least one person')
  const active = activeMemberIds(c)
  if (ids.some((id) => !active.has(id))) v.fail(422, 'Unknown person in the group')
  return ids
}

const formatRanked = (p: db.PlaceRow, r: RankedPlace) => ({
  ...formatPlace(p),
  score: Math.round(r.score * 10) / 10,
  days_since: r.daysSince,
  visit_count: r.visitCount,
  last_visit: r.lastVisit
    ? { id: r.lastVisit.id, date: r.lastVisit.date, attendees: [...r.lastVisit.attendees].sort() }
    : null,
})

/** Rank `places` for tonight. `visits` may hold other places' visits too. */
function rankList(c: Ctx, places: db.PlaceRow[], visits: Visit[], members: string[]) {
  if (places.length === 0) return []
  const byId = new Map(places.map((p) => [p.id, p]))
  return rankPlaces([...byId.keys()], visits, members, todayFor(c), neverDays(c)).map((r) =>
    formatRanked(byId.get(r.placeId)!, r),
  )
}

async function requireList(c: Ctx, listId: string) {
  const list = await db.getList(c.env.DB, c.get('circle').id, listId)
  if (!list) v.fail(404, 'List not found')
  return list!
}

// --- circle & members ------------------------------------------------------

app.get('/api/c/:token', (c) => {
  const circle = c.get('circle')
  return c.json({
    name: circle.name,
    never_days: neverDays(c),
    members: c
      .get('members')
      .filter((m) => m.active)
      .map((m) => ({ id: m.id, name: m.name })),
  })
})

app.post('/api/c/:token/members', async (c) => {
  const b = await body(c)
  const member = await db.addMember(c.env.DB, c.get('circle').id, v.name(b.name))
  return c.json({ id: member.id, name: member.name }, 201)
})

app.patch('/api/c/:token/members/:id', async (c) => {
  const b = await body(c)
  const id = c.req.param('id')
  const changes: Record<string, string | number> = {}
  if (b.name !== undefined) changes.name = v.name(b.name)
  if (b.active !== undefined) changes.active = v.bool(b.active, 'active') ? 1 : 0
  if (changes.active === 0) {
    const active = activeMemberIds(c)
    if (active.size === 1 && active.has(id)) v.fail(422, 'A group needs at least one person')
  }
  if (!(await db.updateRow(c.env.DB, 'members', c.get('circle').id, id, changes))) v.fail(404, 'Person not found')
  return c.json({ ok: true })
})

// --- lists -----------------------------------------------------------------

app.get('/api/c/:token/lists', async (c) => {
  const circleId = c.get('circle').id
  const [lists, places] = await Promise.all([
    db.getLists(c.env.DB, circleId, c.req.query('include_removed') === 'true'),
    db.getPlaces(c.env.DB, circleId),
  ])
  const counts = new Map<string, number>()
  for (const p of places) counts.set(p.list_id, (counts.get(p.list_id) ?? 0) + 1)
  return c.json(lists.map((l) => ({ ...formatList(l), place_count: counts.get(l.id) ?? 0 })))
})

app.post('/api/c/:token/lists', async (c) => {
  const b = await body(c)
  const list = await db.createList(c.env.DB, c.get('circle').id, v.name(b.name))
  return c.json({ ...formatList(list), place_count: 0 }, 201)
})

app.patch('/api/c/:token/lists/:id', async (c) => {
  const b = await body(c)
  const changes: Record<string, string | number> = {}
  if (b.name !== undefined) changes.name = v.name(b.name)
  if (b.active !== undefined) changes.active = v.bool(b.active, 'active') ? 1 : 0
  if (!(await db.updateRow(c.env.DB, 'lists', c.get('circle').id, c.req.param('id'), changes))) {
    v.fail(404, 'List not found')
  }
  return c.json({ ok: true })
})

/** Every list with its top suggestion for tonight's people - the home screen
 * in one request. A group's places and visits are a few hundred rows at
 * most, so it's cheapest to load them all at once. */
app.get('/api/c/:token/overview', async (c) => {
  const members = tonight(c)
  const circleId = c.get('circle').id
  const [lists, places, visits] = await Promise.all([
    db.getLists(c.env.DB, circleId),
    db.getPlaces(c.env.DB, circleId),
    db.getVisits(c.env.DB, circleId),
  ])
  return c.json(
    lists.map((l) => {
      const ranked = rankList(
        c,
        places.filter((p) => p.list_id === l.id),
        visits,
        members,
      )
      return { ...formatList(l), place_count: ranked.length, top: ranked[0] ?? null }
    }),
  )
})

// --- places ----------------------------------------------------------------

app.get('/api/c/:token/lists/:id/places', async (c) => {
  const list = await requireList(c, c.req.param('id'))
  const places = await db.getPlaces(c.env.DB, c.get('circle').id, list.id, c.req.query('include_removed') === 'true')
  return c.json(places.map(formatPlace))
})

app.post('/api/c/:token/lists/:id/places', async (c) => {
  const list = await requireList(c, c.req.param('id'))
  const b = await body(c)
  const place = await db.createPlace(c.env.DB, c.get('circle').id, list.id, {
    name: v.name(b.name),
    link: v.link(b.link),
    notes: v.notes(b.notes),
  })
  return c.json(formatPlace(place), 201)
})

app.patch('/api/c/:token/places/:id', async (c) => {
  const b = await body(c)
  const changes: Record<string, string | number | null> = {}
  if (b.name !== undefined && b.name !== null) changes.name = v.name(b.name)
  if (b.link !== undefined) changes.link = v.link(b.link)
  if (b.notes !== undefined) changes.notes = v.notes(b.notes)
  if (b.active !== undefined && b.active !== null) changes.active = v.bool(b.active, 'active') ? 1 : 0
  if (b.list_id !== undefined && b.list_id !== null) {
    if (typeof b.list_id !== 'string') v.fail(404, 'List not found')
    changes.list_id = (await requireList(c, b.list_id as string)).id
  }
  if (!(await db.updateRow(c.env.DB, 'places', c.get('circle').id, c.req.param('id'), changes))) {
    v.fail(404, 'Place not found')
  }
  return c.json({ ok: true })
})

app.get('/api/c/:token/lists/:id/recommendations', async (c) => {
  const list = await requireList(c, c.req.param('id'))
  const members = tonight(c)
  const circleId = c.get('circle').id
  const places = await db.getPlaces(c.env.DB, circleId, list.id)
  const visits = await db.getVisits(
    c.env.DB,
    circleId,
    places.map((p) => p.id),
  )
  return c.json({ list: formatList(list), places: rankList(c, places, visits, members) })
})

// --- visits ----------------------------------------------------------------

const formatVisit = (visit: { id: string; placeId: string; date: string; attendees: string[] }) => ({
  id: visit.id,
  place_id: visit.placeId,
  date: visit.date,
  attendees: visit.attendees,
})

app.get('/api/c/:token/places/:id/visits', async (c) => {
  const visits = await db.getVisits(c.env.DB, c.get('circle').id, [c.req.param('id')])
  return c.json(visits.map(formatVisit))
})

app.post('/api/c/:token/visits', async (c) => {
  const b = await body(c)
  const circleId = c.get('circle').id
  const place = typeof b.place_id === 'string' ? await db.getPlace(c.env.DB, circleId, b.place_id) : null
  if (!place || !place.active) v.fail(404, 'Place not found')
  const attendees = v.idList(b.attendees, 'Attendees')
  // Removed members still count as known: you can log a past visit they were on.
  const known = new Set(c.get('members').map((m) => m.id))
  if (attendees.some((id) => !known.has(id))) v.fail(422, 'Unknown person in the group')
  const day = todayFor(c)
  const date = b.date === undefined || b.date === null ? day : v.isoDate(b.date)
  if (date > day) v.fail(422, "A visit can't be in the future")
  const visit = await db.createVisit(c.env.DB, circleId, place!.id, date, attendees)
  return c.json(formatVisit(visit), 201)
})

app.delete('/api/c/:token/visits/:id', async (c) => {
  if (!(await db.deleteVisit(c.env.DB, c.get('circle').id, c.req.param('id')))) v.fail(404, 'Visit not found')
  return c.json({ ok: true })
})

export default app
