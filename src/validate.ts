// Request-body validation. Length caps keep junk out of the shared database.
// Every failure throws a 422 with a message the app can show as-is.

import { HTTPException } from 'hono/http-exception'

export const fail = (status: 404 | 422, detail: string): never => {
  throw new HTTPException(status, { message: detail })
}

type Body = Record<string, unknown>

export function asObject(body: unknown): Body {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) fail(422, 'Expected a JSON object')
  return body as Body
}

export function name(value: unknown, label = 'Name'): string {
  if (typeof value !== 'string') return fail(422, `${label} is required`)
  const trimmed = value.trim()
  if (!trimmed) return fail(422, `${label} can't be empty`)
  if (trimmed.length > 80) return fail(422, `${label} is too long (max 80 characters)`)
  return trimmed
}

export function notes(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return fail(422, 'Notes must be text')
  const trimmed = value.trim()
  if (trimmed.length > 300) return fail(422, 'Notes are too long (max 300 characters)')
  return trimmed || null
}

/** http(s) links only - anything else (javascript:, data:...) is refused,
 * since the app renders it as a clickable link for the whole group. */
export function link(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return fail(422, 'Link must be text')
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 500) return fail(422, 'Link is too long')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return fail(422, 'That link doesn\'t look right - it should start with https://')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail(422, 'Links must start with https://')
  return url.toString()
}

export function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') return fail(422, `${label} must be true or false`)
  return value
}

export function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail(422, 'Date must be YYYY-MM-DD')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return fail(422, 'That date doesn\'t exist')
  }
  return value
}

export function idList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return fail(422, `${label} must be a list`)
  const ids = [...new Set(value as string[])]
  if (ids.length === 0) return fail(422, 'Pick at least one person')
  if (ids.length > 50) return fail(422, `Too many ${label.toLowerCase()}`)
  return ids
}
