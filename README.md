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

To start a group, describe it in a JSON file (see `circles/example.json`)
and run:

```bash
npm run create-circle -- circles/my-group.json --remote --base-url https://<your-app>.workers.dev
```

It prints the link to share. Everything can be edited in the app afterwards.
Without `--remote` it goes into your local development database instead.

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

First deploy, from your own computer:

```bash
npx wrangler login       # opens the browser; a free Cloudflare account is enough
npm run build
npm run deploy           # deploys, creates the D1 database, applies migrations
```

`npm run deploy` prints the app's URL (`https://where-should-we-go-out.<your-subdomain>.workers.dev`).
Then create your group in the production database:

```bash
npm run create-circle -- circles/my-group.json --remote --base-url https://where-should-we-go-out.<your-subdomain>.workers.dev
```

### Automatic deploys on push (optional)

In the Cloudflare dashboard: **Workers & Pages > where-should-we-go-out >
Settings > Builds > Connect** to this GitHub repo, with:

- Build command: `npm run build`
- Deploy command: `npm run deploy`

Every push to `main` then deploys. If the deploy step fails on the D1
migrations with a permissions error, give the build's API token D1 edit
access (or change the deploy command to `npx wrangler deploy` and apply
migrations from your computer with `npx wrangler d1 migrations apply DB --remote`).

### Free tier limits

Workers: 100,000 requests/day. D1: 5 million rows read and 100,000 rows
written per day, 5 GB storage. A friend group uses a tiny fraction of this.
