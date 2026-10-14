#!/usr/bin/env node
// Create a friend group from a JSON file and print its share link.
//
//   npm run create-circle -- circles/example.json                # local dev DB
//   npm run create-circle -- circles/my-group.json --remote --base-url https://<your-app>.workers.dev
//
// Everything about a group - its people, lists and places - is data in this
// file (and editable in the app afterwards), so starting a new group or
// swapping the lists is a new file, not a code change. See circles/example.json.

import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--base-url')
const remote = args.includes('--remote')
const baseUrlIndex = args.indexOf('--base-url')
const baseUrl = (baseUrlIndex >= 0 ? args[baseUrlIndex + 1] : 'http://localhost:8787').replace(/\/$/, '')

if (!file) {
  console.error('Usage: npm run create-circle -- <group.json> [--remote] [--base-url <url>]')
  process.exit(1)
}

function die(message) {
  console.error(`${file}: ${message}`)
  process.exit(1)
}

// Same rules the API enforces.
function name(value, where) {
  if (typeof value !== 'string' || !value.trim()) die(`${where}: a name is required`)
  if (value.trim().length > 80) die(`${where}: "${value}" is longer than 80 characters`)
  return value.trim()
}

function link(value, where) {
  if (value === undefined || value === null || value === '') return null
  let url
  try {
    url = new URL(value)
  } catch {
    die(`${where}: "${value}" isn't a valid link`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') die(`${where}: links must start with https://`)
  return url.toString()
}

const data = JSON.parse(readFileSync(file, 'utf8'))
const groupName = name(data.name, 'group')
if (!Array.isArray(data.members) || data.members.length === 0) die('needs at least one member')
const neverDays = data.never_days ?? 365
if (!Number.isInteger(neverDays) || neverDays < 1) die('never_days must be a positive whole number')

const sql = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const now = new Date().toISOString()
const circleId = randomUUID()
const token = randomBytes(16).toString('base64url')
const statements = [
  `INSERT INTO circles (id, name, token, never_days, created_at) VALUES (${[circleId, groupName, token, neverDays, now].map(sql).join(', ')});`,
]
// created_at is shared, so insertion order (rowid) keeps the file's order.
for (const member of data.members) {
  statements.push(
    `INSERT INTO members (id, circle_id, name, active, created_at) VALUES (${[randomUUID(), circleId, name(member, 'member'), 1, now].map(sql).join(', ')});`,
  )
}
for (const [listName, places] of Object.entries(data.lists ?? {})) {
  const listId = randomUUID()
  statements.push(
    `INSERT INTO lists (id, circle_id, name, active, created_at) VALUES (${[listId, circleId, name(listName, 'list'), 1, now].map(sql).join(', ')});`,
  )
  if (!Array.isArray(places)) die(`list "${listName}" must be an array of places`)
  for (const place of places) {
    const p = typeof place === 'string' ? { name: place } : place
    const where = `place in "${listName}"`
    const notes = typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim().slice(0, 300) : null
    statements.push(
      `INSERT INTO places (id, circle_id, list_id, name, link, notes, active, created_at) VALUES (${[randomUUID(), circleId, listId, name(p.name, where), link(p.link, where), notes, 1, now].map(sql).join(', ')});`,
    )
  }
}

const dir = mkdtempSync(join(tmpdir(), 'wsgo-'))
const sqlFile = join(dir, 'circle.sql')
writeFileSync(sqlFile, statements.join('\n'))
const where = remote ? '--remote' : '--local'
try {
  // Make sure the tables exist (a no-op when they already do).
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', where], { stdio: 'inherit' })
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--file', sqlFile, where], {
    stdio: 'inherit',
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\nCreated "${groupName}" in the ${remote ? 'production' : 'local'} database.`)
console.log('Share this link with the group (anyone with it can view and edit):')
console.log(`  ${baseUrl}/c/${token}`)
