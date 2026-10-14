# Where should we go out?

A small web app for a friend group: keep shared lists of places you like
(ramen, burgers, cocktail bars...), log each time you go somewhere, and let
the app suggest the place your group is most overdue for.

Runs entirely on Cloudflare's free tier: a Worker for the API, D1 (SQLite)
for the database, and Workers static assets for the React app.

## How suggestions work

1. Pick **who's coming tonight**.
2. Each of those people scores a place by **days since they personally last
   went there**. Someone who has never been counts as 365 days (configurable
   per group via `never_days`).
3. A place's score is the **average** over tonight's people. The highest
   score is recommended first. Ties go to the place with fewer visits, then
   random.

A visit counts for tonight if **anyone coming tonight was there**. Visits by
people who aren't coming are ignored.

| Tonight: Alice, Bob, Carol | Alice | Bob | Carol | Score |
|---|---|---|---|---|
| Y - nobody's been | 365 | 365 | 365 | **365** |
| Z - Carol alone, yesterday | 365 | 365 | 1 | **244** |
| X - Alice + Bob, a week ago | 7 | 7 | 365 | **126** |
| W - all three, 2 months ago | 60 | 60 | 60 | **60** |

A list with a **single place** can't recommend anything, so instead it shows
when you last went and with whom (among tonight's people). Add a second place
and it becomes a normal list.

The logic is a pure function in `src/ranking.ts`, tested in
`test/ranking.test.ts`.

## Groups are data, not code

Each group ("circle") has its own people, lists and places, and a secret
share link (`/c/<token>`). Anyone with the link can view and edit everything.
Removing a person, list or place only hides it, so history is kept and it
can be restored.

To start a group, describe it in a JSON file (see `circles/example.json`),
then turn it into SQL:

```bash
npm run create-circle -- circles/my-group.json --sql group.sql --base-url https://<your-app>.workers.dev
```

It writes `group.sql` and prints the group's share link. Paste the SQL into
the D1 Console (see "Adding a group" below) and run it **once**: running it
again creates a second, separate group. Everything can be edited in the app
afterwards.

Other ways to run it:
- no `--sql`: puts the group in your local development database
- `--remote` instead of `--sql`: writes straight to the production database
  (needs `npx wrangler login` first)

## Project layout

```
src/
  index.ts       the API (Hono on a Cloudflare Worker)
  db.ts          D1 queries, everything scoped to one circle
  ranking.ts     the recommendation logic (pure, no I/O)
  validate.ts    request validation
migrations/      D1 schema
frontend/        React + TypeScript (Vite), builds into frontend/dist
scripts/create-circle.mjs
circles/example.json
test/            runs inside the real Workers runtime against a local D1
wrangler.jsonc   Cloudflare config
```

## Running locally

Needs Node 22+. No Cloudflare account needed for local development.

```bash
npm ci
npm run build                                       # builds the frontend
npm run create-circle -- circles/example.json       # creates the local DB too
npm run dev                                         # http://localhost:8787
```

Open the printed link. For frontend work with hot reload, also run
`npm run dev` inside `frontend/` and open http://localhost:5173/c/<token>
(it proxies `/api` to the Worker on 8787).

Tests: `npm test` (and `npm run typecheck`).

## Deploying (free)

The live app is deployed by Cloudflare straight from this GitHub repo.
Everything below is done in the Cloudflare dashboard; nothing needs to be
installed.

### First-time setup

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up
   (signing in with GitHub works).
2. **Workers & Pages > Create > Import a repository**, pick this repo, and set:
   - Project name: `where-should-we-go-out` (must match `name` in
     `wrangler.jsonc`)
   - Build command: `npm run build`
   - Deploy command: `npm run deploy`
   - Branch control: production branch `main`, non-production branch
     builds off (see "After setup" below)
3. Deploy. The first deploy creates the D1 database and its tables.
4. Turn on the public address: on the Worker's page, **Settings > Domains &
   Routes > workers.dev > Enable**. If asked, pick a `workers.dev`
   subdomain for the account. The app is then at
   `https://where-should-we-go-out.<subdomain>.workers.dev`.
5. Check it:
   - `/health` should show `{"status":"ok"}`
   - `/api/c/test` should show `"Group not found - check the link"`. If it
     shows "Something went wrong" instead, the tables are missing: run the
     contents of `migrations/0001_init.sql` in the D1 Console.

### Adding a group

1. Make the SQL with `create-circle --sql` (see "Groups are data, not code"
   above).
2. In the dashboard, open **Storage & Databases > D1 > where-should-we-go-out
   > Console**, paste the SQL and click **Execute**. Do this once only.
3. Open the printed link and share it with the group.

### After setup

- **Every push to `main` deploys automatically.** `npm run deploy` publishes
  the Worker, then applies any new files in `migrations/`. Data is kept
  across deploys.
- **Other branches are not built.** Non-production branch builds are
  turned off (Settings > Build > Branch control). PRs are checked by GitHub
  Actions CI (typecheck, tests, build) instead.

  Why: Cloudflare's default deploy command for other branches is
  `npx wrangler preview` (a beta command), which refuses to run unless
  `wrangler.jsonc` has a `previews` block. That block does not inherit the
  production bindings, so turning previews on properly means giving them
  their own D1 database (with migrations applied and a test group), not
  just copying `vars`. Not worth it for a friend-group app; revisit if it
  becomes useful.

### Deploying from a computer instead

```bash
npx wrangler login
npm ci && npm run build
npm run deploy
```

### Free tier limits

Workers: 100,000 requests/day. D1: 5 million rows read and 100,000 rows
written per day, 5 GB storage. A friend group uses a tiny fraction of this.
