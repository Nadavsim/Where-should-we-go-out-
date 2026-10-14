import { env } from 'cloudflare:test'
import { exports } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCircle } from '../src/db'
import { today } from '../src/index'

// Requests go through the real Worker and a real local D1 database.
async function call(method: string, path: string, body?: unknown) {
  const res = await exports.default.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  const text = await res.text()
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null }
}

const daysAgo = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

let base: string
let m: Record<string, string>
let ramen: { id: string }

beforeEach(async () => {
  const circle = await createCircle(env.DB, 'Friends', ['Alice', 'Bob', 'Carol'])
  base = `/api/c/${circle.token}`
  m = Object.fromEntries(circle.members.map((x) => [x.name.toLowerCase(), x.id]))
  ramen = (await call('POST', `${base}/lists`, { name: 'Ramen' })).json
})

async function addPlace(listId: string, name: string, extra: Record<string, string> = {}) {
  const r = await call('POST', `${base}/lists/${listId}/places`, { name, ...extra })
  expect(r.status, JSON.stringify(r.json)).toBe(201)
  return r.json
}

async function logVisit(placeId: string, attendees: string[], ago = 0) {
  const r = await call('POST', `${base}/visits`, { place_id: placeId, attendees, date: daysAgo(ago) })
  expect(r.status, JSON.stringify(r.json)).toBe(201)
  return r.json
}

async function recs(listId: string, ...members: string[]) {
  const r = await call('GET', `${base}/lists/${listId}/recommendations?members=${members.join(',')}`)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json.places
}

describe('API', () => {
  it('404s for an unknown group', async () => {
    const r = await call('GET', '/api/c/nope')
    expect(r.status).toBe(404)
    expect(r.json.detail).toMatch(/not found/i)
  })

  it('reads the group', async () => {
    const r = await call('GET', base)
    expect(r.json.name).toBe('Friends')
    expect(r.json.members.map((x: { name: string }) => x.name)).toEqual(['Alice', 'Bob', 'Carol'])
    expect(r.json.never_days).toBe(365)
  })

  it('recommends the end-to-end Alice/Bob/Carol example', async () => {
    const x = await addPlace(ramen.id, 'X', { link: 'https://maps.google.com/?q=x' })
    await addPlace(ramen.id, 'Y')
    await logVisit(x.id, [m.alice, m.bob], 7)

    const places = await recs(ramen.id, m.alice, m.bob, m.carol)
    expect(places.map((p: { name: string }) => p.name)).toEqual(['Y', 'X'])
    expect(places[1].days_since).toEqual({ [m.alice]: 7, [m.bob]: 7, [m.carol]: null })
    expect(places[1].score).toBe(Math.round(((7 + 7 + 365) / 3) * 10) / 10)
    expect(places[1].last_visit.attendees).toEqual([m.alice, m.bob].sort())
    expect(places[1].link).toBe('https://maps.google.com/?q=x')
    expect(places[0].last_visit).toBeNull()
  })

  it('gives the top pick per list in the overview', async () => {
    await call('POST', `${base}/lists`, { name: 'Hamburger' })
    const solo = (await call('POST', `${base}/lists`, { name: 'Our bar' })).json
    const a = await addPlace(ramen.id, 'A')
    await addPlace(ramen.id, 'B')
    const bar = await addPlace(solo.id, 'The bar')
    await logVisit(a.id, [m.alice], 1)
    await logVisit(bar.id, [m.bob, m.carol], 3)

    const r = await call('GET', `${base}/overview?members=${m.alice},${m.bob}`)
    expect(r.status).toBe(200)
    const byName = Object.fromEntries(r.json.map((l: { name: string }) => [l.name, l]))
    expect(byName.Ramen.top.name).toBe('B')
    expect(byName.Ramen.place_count).toBe(2)
    expect(byName.Hamburger.top).toBeNull()
    expect(byName['Our bar'].place_count).toBe(1)
    expect(byName['Our bar'].top.last_visit.date).toBe(daysAgo(3))
  })

  it('validates who is coming', async () => {
    const url = `${base}/lists/${ramen.id}/recommendations`
    expect((await call('GET', `${url}?members=`)).status).toBe(422)
    expect((await call('GET', `${url}?members=someone-else`)).status).toBe(422)
    expect((await call('GET', url)).status).toBe(422)
  })

  it('validates visits', async () => {
    const x = await addPlace(ramen.id, 'X')
    const tomorrow = new Date(`${today()}T00:00:00Z`)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const post = (body: unknown) => call('POST', `${base}/visits`, body)
    expect((await post({ place_id: x.id, attendees: [] })).status).toBe(422)
    expect((await post({ place_id: x.id, attendees: ['stranger'] })).status).toBe(422)
    expect((await post({ place_id: x.id, attendees: [m.alice], date: tomorrow.toISOString().slice(0, 10) })).status).toBe(422)
    expect((await post({ place_id: x.id, attendees: [m.alice], date: '2026-02-30' })).status).toBe(422)
    expect((await post({ place_id: 'nope', attendees: [m.alice] })).status).toBe(404)
    const ok = await post({ place_id: x.id, attendees: [m.alice, m.alice] })
    expect(ok.status).toBe(201)
    expect(ok.json.date).toBe(today())
    expect(ok.json.attendees).toEqual([m.alice])
  })

  it('deletes a visit (undo)', async () => {
    const x = await addPlace(ramen.id, 'X')
    const visit = await logVisit(x.id, [m.alice])
    expect((await call('GET', `${base}/places/${x.id}/visits`)).json[0].id).toBe(visit.id)
    expect((await call('DELETE', `${base}/visits/${visit.id}`)).status).toBe(200)
    expect((await call('GET', `${base}/places/${x.id}/visits`)).json).toEqual([])
    expect((await call('DELETE', `${base}/visits/${visit.id}`)).status).toBe(404)
  })

  it('hides a removed place but keeps its history for when it is restored', async () => {
    const x = await addPlace(ramen.id, 'X')
    await logVisit(x.id, [m.alice], 5)
    expect((await call('PATCH', `${base}/places/${x.id}`, { active: false })).status).toBe(200)
    expect(await recs(ramen.id, m.alice)).toEqual([])
    const removed = (await call('GET', `${base}/lists/${ramen.id}/places?include_removed=true`)).json
    expect(removed[0].active).toBe(false)

    await call('PATCH', `${base}/places/${x.id}`, { active: true })
    expect((await recs(ramen.id, m.alice))[0].days_since).toEqual({ [m.alice]: 5 })
  })

  it('edits place fields and moves a place between lists', async () => {
    const other = (await call('POST', `${base}/lists`, { name: 'Cocktail bars' })).json
    const x = await addPlace(ramen.id, 'X', { notes: 'good' })
    expect((await call('PATCH', `${base}/places/${x.id}`, { name: 'X2', notes: '', link: 'https://x.example' })).status).toBe(200)
    await call('PATCH', `${base}/places/${x.id}`, { list_id: other.id })
    const [moved] = (await call('GET', `${base}/lists/${other.id}/places`)).json
    expect(moved.name).toBe('X2')
    expect(moved.notes).toBeNull()
    expect(moved.link).toBe('https://x.example/')
    expect((await call('PATCH', `${base}/places/${x.id}`, { list_id: 'bad' })).status).toBe(404)
  })

  it('validates place input', async () => {
    const url = `${base}/lists/${ramen.id}/places`
    expect((await call('POST', url, { name: '  ' })).status).toBe(422)
    expect((await call('POST', url, { name: 'x'.repeat(81) })).status).toBe(422)
    expect((await call('POST', url, { name: 'X', link: 'javascript:alert(1)' })).status).toBe(422)
    const bad = await call('POST', url, 'not an object')
    expect(bad.status).toBe(422)
  })

  it('renames and removes lists', async () => {
    await call('PATCH', `${base}/lists/${ramen.id}`, { name: 'Ramen!' })
    expect((await call('GET', `${base}/lists`)).json[0].name).toBe('Ramen!')
    await call('PATCH', `${base}/lists/${ramen.id}`, { active: false })
    expect((await call('GET', `${base}/lists`)).json).toEqual([])
    expect((await call('GET', `${base}/lists?include_removed=true`)).json).toHaveLength(1)
  })

  it('adds, renames and removes people', async () => {
    const dan = (await call('POST', `${base}/members`, { name: 'Dan' })).json
    await call('PATCH', `${base}/members/${dan.id}`, { name: 'Daniel' })
    await call('PATCH', `${base}/members/${m.carol}`, { active: false })
    expect((await call('GET', base)).json.members.map((x: { name: string }) => x.name)).toEqual(['Alice', 'Bob', 'Daniel'])
    expect((await call('PATCH', `${base}/members/nobody`, { name: 'x' })).status).toBe(404)
  })

  it("won't remove a group's last person", async () => {
    const solo = await createCircle(env.DB, 'Solo', ['Alice'])
    const r = await call('PATCH', `/api/c/${solo.token}/members/${solo.members[0].id}`, { active: false })
    expect(r.status).toBe(422)
  })

  it('keeps groups isolated from each other', async () => {
    const other = await createCircle(env.DB, 'Others', ['Zed'])
    const otherBase = `/api/c/${other.token}`
    expect((await call('GET', `${otherBase}/lists/${ramen.id}/places`)).status).toBe(404)
    const x = await addPlace(ramen.id, 'X')
    const r = await call('POST', `${otherBase}/visits`, { place_id: x.id, attendees: [other.members[0].id] })
    expect(r.status).toBe(404)
    expect((await call('PATCH', `${otherBase}/places/${x.id}`, { name: 'hijacked' })).status).toBe(404)
  })

  it('sends privacy headers and a health check', async () => {
    const r = await call('GET', '/health')
    expect(r.status).toBe(200)
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(r.headers.get('X-Robots-Tag')).toContain('noindex')
  })
})
