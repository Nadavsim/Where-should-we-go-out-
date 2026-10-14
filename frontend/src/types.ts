export interface Member {
  id: string
  name: string
}

export interface Circle {
  name: string
  never_days: number
  members: Member[]
}

export interface ListInfo {
  id: string
  name: string
  active: boolean
  place_count: number
}

export interface Place {
  id: string
  list_id: string
  name: string
  link: string | null
  notes: string | null
  active: boolean
}

export interface LastVisit {
  id: string
  date: string // YYYY-MM-DD
  attendees: string[]
}

export interface RankedPlace extends Place {
  // Average days since each of tonight's people last went (never = never_days).
  score: number
  // Per tonight-person: days since they last went, or null for never.
  days_since: Record<string, number | null>
  visit_count: number
  last_visit: LastVisit | null
}

export interface OverviewList extends ListInfo {
  top: RankedPlace | null
}

export interface VisitRecord {
  id: string
  place_id: string
  date: string
  attendees: string[]
}
