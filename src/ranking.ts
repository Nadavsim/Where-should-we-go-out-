// The recommendation logic, kept pure (no I/O) so it can be tested directly.
//
// Rule: a past visit matters for tonight if ANY of tonight's people were
// there. Each person coming tonight scores a place by how many days it's been
// since they personally last went (never = neverDays). A place's score is the
// average over tonight's people; higher means "more overdue" and ranks first.
//
// So a place two of three people visited last week ranks below one nobody
// has been to, while a place only one person went to yesterday still ranks
// above one the whole group did two months ago.

export const DEFAULT_NEVER_DAYS = 365

export interface Visit {
  id: string
  placeId: string
  date: string // YYYY-MM-DD
  attendees: string[]
}

export interface RankedPlace {
  placeId: string
  // Average days-since over tonight's people. Higher = recommend sooner.
  score: number
  // Per tonight-person: days since they last went, or null if never.
  daysSince: Record<string, number | null>
  // Most recent visit that included at least one of tonight's people.
  lastVisit: Visit | null
  // How many visits included at least one of tonight's people.
  visitCount: number
}

export function daysBetween(earlier: string, later: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000)
}

/** Rank placeIds for tonight's members, most overdue first. Ties break by
 * fewer visits involving tonight's people, then randomly, so a set of
 * never-visited places doesn't always come out in the same order. */
export function rankPlaces(
  placeIds: string[],
  visits: Visit[],
  members: string[],
  today: string,
  neverDays = DEFAULT_NEVER_DAYS,
  random: () => number = Math.random,
): RankedPlace[] {
  if (members.length === 0) throw new Error('at least one member is needed to rank places')
  const tonight = new Set(members)
  const wanted = new Set(placeIds)

  const lastSeen = new Map<string, string>() // `${placeId} ${memberId}` -> date
  const lastVisit = new Map<string, Visit>()
  const visitCount = new Map<string, number>()
  for (const v of visits) {
    if (!wanted.has(v.placeId)) continue
    const overlap = v.attendees.filter((a) => tonight.has(a))
    if (overlap.length === 0) continue
    visitCount.set(v.placeId, (visitCount.get(v.placeId) ?? 0) + 1)
    const prev = lastVisit.get(v.placeId)
    if (!prev || v.date > prev.date) lastVisit.set(v.placeId, v)
    for (const m of overlap) {
      const key = `${v.placeId} ${m}`
      const seen = lastSeen.get(key)
      if (!seen || v.date > seen) lastSeen.set(key, v.date)
    }
  }

  const ranked = placeIds.map((placeId) => {
    const daysSince: Record<string, number | null> = {}
    let total = 0
    for (const m of members) {
      const seen = lastSeen.get(`${placeId} ${m}`)
      if (!seen) {
        daysSince[m] = null
        total += neverDays
      } else {
        // Clamp: a visit dated in the future counts as today, and anything
        // older than neverDays is as good as never.
        const days = Math.min(Math.max(daysBetween(seen, today), 0), neverDays)
        daysSince[m] = days
        total += days
      }
    }
    return {
      placeId,
      score: total / members.length,
      daysSince,
      lastVisit: lastVisit.get(placeId) ?? null,
      visitCount: visitCount.get(placeId) ?? 0,
      total,
      tiebreak: random(),
    }
  })

  // Compare the integer total, not the float average, so ties are exact.
  ranked.sort((a, b) => b.total - a.total || a.visitCount - b.visitCount || a.tiebreak - b.tiebreak)
  return ranked.map(({ total: _total, tiebreak: _tiebreak, ...rest }) => rest)
}
