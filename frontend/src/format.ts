import type { Member } from './types'

export function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// "YYYY-MM-DD" parsed as a local date (new Date("YYYY-MM-DD") would be UTC
// midnight, which shows as the previous day west of Greenwich).
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(iso: string): string {
  const date = parseIso(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function daysAgo(days: number | null, neverDays: number): string {
  if (days === null) return 'never'
  if (days >= neverDays) return 'ages ago'
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  const years = Math.round(days / 365)
  return years === 1 ? 'a year ago' : `${years} years ago`
}

export function daysBetween(iso: string, laterIso: string): number {
  return Math.round((parseIso(laterIso).getTime() - parseIso(iso).getTime()) / 86_400_000)
}

export function names(ids: string[], members: Member[], removedLabel = 'someone'): string {
  const byId = new Map(members.map((m) => [m.id, m.name]))
  const list = ids.map((id) => byId.get(id) ?? removedLabel)
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`
}
