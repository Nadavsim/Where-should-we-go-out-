# Where should we go out?

A web app for a friend group: shared lists of places, a log of who went
where and when, and a suggestion of the place tonight's group is most
overdue for. See `README.md` for setup, deploying and the ranking rules.

## Stack

Cloudflare free tier only: a Worker (`src/`, Hono) for the API, D1 (SQLite,
`migrations/`) for data, Workers static assets for the React app
(`frontend/`, Vite -> `frontend/dist`). `wrangler.jsonc` routes only
`/api/*` and `/health` to the Worker; everything else is a static file, with
unknown paths (like `/c/<token>`) falling back to `index.html`. Headers for
static files live in `frontend/public/_headers`.

Chosen over Azure App Service (the user's other project, TLV Bot, uses it)
and Render's free tier (sleeps after 15 minutes idle; about a minute to
wake). Keep it free: anything that would need a paid plan is a question for
the user first.

## Decisions (keep unless the user changes them)

- **Ranking** (`src/ranking.ts`, pure function): a visit counts for tonight
  if ANY of tonight's people attended. Score = average over tonight's people
  of days since that person last went (never, or older than `never_days`,
  counts as `never_days`, default 365). Highest first. Ties: fewer visits
  involving tonight's people, then random. The user chose this explicitly
  over "exact group" and "everyone was there" rules, and over the plain
  "most recent visit by anyone" rule, because of the case where one person
  went yesterday and the rest have never been.
- **Single-place lists** don't recommend; they show the last visit (by any
  of tonight's people) and who was there.
- **Groups are data**: circles, members, lists, places, visits tables.
  Nothing about a specific group lives in code. New groups come from a JSON
  file via `scripts/create-circle.mjs`.
- **Access**: the secret token in the share link `/c/<token>` is the only
  key, and everyone with it can edit. So: `Referrer-Policy: no-referrer`,
  noindex, and every query is scoped by `circle_id` (tests check one group
  can't touch another's rows).
- **Removing** a member, list or place only sets `active = 0` (history kept,
  restorable). Deleting a *visit* is a real delete (it's the undo for a
  mistaken log).
- Visit dates are `YYYY-MM-DD` strings in `APP_TIMEZONE` (default
  Asia/Jerusalem); future dates are rejected. `visits.attendees` is a JSON
  array of member ids.

## Working on it

- `npm test` runs inside the real Workers runtime (workerd) against a local
  D1 with the real migrations - no database mocks. `npm run typecheck`.
- Frontend: `npm run build` (from the root), `cd frontend && npm run lint`.
  No frontend test suite yet.
- `npm run deploy` deploys first, then applies migrations, so a new
  migration must work with the previous code for a few seconds (additive
  changes only, or split into two deploys).
- The frontend has no router library: the token is in the path, screens are
  in the hash (`#who`, `#list/<id>`) so the phone's back button works.
- npm 10 crashed (`Cannot read properties of null (reading 'edgesOut')`)
  when *adding* vitest packages here; `npx npm@11 i -D ...` worked.
  `npm ci` on the lockfile works with npm 10.
