import { describe, expect, it } from 'vitest'
import { rankPlaces, type Visit } from '../src/ranking'

const TODAY = '2026-10-14'

function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

let seq = 0
const visit = (placeId: string, ago: number, ...attendees: string[]): Visit => ({
  id: `v${seq++}`,
  placeId,
  date: daysAgo(ago),
  attendees,
})

const order = (ranked: { placeId: string }[]) => ranked.map((r) => r.placeId)

describe('rankPlaces', () => {
  it('ranks a place two of tonight visited below one nobody has', () => {
    // Alice + Bob went to X a week ago; tonight Alice + Bob + Carol go out.
    const ranked = rankPlaces(['X', 'Y'], [visit('X', 7, 'alice', 'bob')], ['alice', 'bob', 'carol'], TODAY)
    expect(order(ranked)).toEqual(['Y', 'X'])
    expect(ranked[1].daysSince).toEqual({ alice: 7, bob: 7, carol: null })
    expect(ranked[1].score).toBeCloseTo((7 + 7 + 365) / 3)
    expect(ranked[0].score).toBe(365)
  })

  it('ranks one person yesterday above the whole group two months ago', () => {
    // Plain "anyone was there" would put Z last; the per-person average puts
    // it first since two of the three have never been.
    const ranked = rankPlaces(
      ['X', 'Z'],
      [visit('X', 60, 'alice', 'bob', 'carol'), visit('Z', 1, 'carol')],
      ['alice', 'bob', 'carol'],
      TODAY,
    )
    expect(order(ranked)).toEqual(['Z', 'X'])
    expect(ranked[0].score).toBeCloseTo((365 + 365 + 1) / 3)
    expect(ranked[1].score).toBe(60)
  })

  it('ignores visits by people not coming tonight', () => {
    const [r] = rankPlaces(['X'], [visit('X', 1, 'dan')], ['alice', 'bob'], TODAY)
    expect(r.score).toBe(365)
    expect(r.lastVisit).toBeNull()
    expect(r.visitCount).toBe(0)
  })

  it("uses each person's own most recent visit", () => {
    const [r] = rankPlaces(['X'], [visit('X', 100, 'alice', 'bob'), visit('X', 10, 'alice')], ['alice', 'bob'], TODAY)
    expect(r.daysSince).toEqual({ alice: 10, bob: 100 })
    expect(r.lastVisit?.date).toBe(daysAgo(10))
    expect(r.visitCount).toBe(2)
  })

  it('reports the last visit involving tonight only', () => {
    const [r] = rankPlaces(['X'], [visit('X', 30, 'alice'), visit('X', 2, 'dan')], ['alice'], TODAY)
    expect(r.lastVisit?.attendees).toEqual(['alice'])
  })

  it('caps old visits at neverDays and breaks the tie by fewer visits', () => {
    const ranked = rankPlaces(['old', 'never'], [visit('old', 900, 'alice')], ['alice'], TODAY, 365)
    expect(ranked.map((r) => r.score)).toEqual([365, 365])
    expect(order(ranked)).toEqual(['never', 'old'])
    expect(ranked[1].daysSince).toEqual({ alice: 365 })
  })

  it('lets neverDays be configured', () => {
    const ranked = rankPlaces(['seen', 'never'], [visit('seen', 50, 'alice', 'bob')], ['alice', 'bob', 'carol'], TODAY, 30)
    expect(ranked[0].placeId).toBe('never')
    expect(ranked[1].score).toBe(30)
  })

  it('counts a future-dated visit as today', () => {
    const [r] = rankPlaces(['X'], [visit('X', -3, 'alice')], ['alice'], TODAY)
    expect(r.daysSince).toEqual({ alice: 0 })
  })

  it('breaks ties by fewer visits, then randomly', () => {
    const visits = [visit('A', 20, 'alice'), visit('A', 30, 'bob'), visit('B', 20, 'alice'), visit('B', 30, 'bob')]
    visits.push(visit('A', 25, 'alice')) // A: 3 visits, same per-person recency
    expect(order(rankPlaces(['A', 'B'], visits, ['alice', 'bob'], TODAY))).toEqual(['B', 'A'])

    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) seen.add(order(rankPlaces(['P', 'Q', 'R'], [], ['alice'], TODAY)).join())
    expect(seen.size).toBeGreaterThan(1)
  })

  it('handles a single-place list', () => {
    const ranked = rankPlaces(['solo'], [visit('solo', 40, 'alice', 'dan')], ['alice', 'bob'], TODAY)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].lastVisit?.attendees).toEqual(['alice', 'dan'])
  })

  it('needs at least one member', () => {
    expect(() => rankPlaces(['X'], [], [], TODAY)).toThrow()
  })

  it('handles no places', () => {
    expect(rankPlaces([], [visit('X', 1, 'alice')], ['alice'], TODAY)).toEqual([])
  })
})
