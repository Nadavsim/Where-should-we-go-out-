# Where should we go out?

A small web app for a friend group: keep shared lists of places you like
(ramen, burgers, cocktail bars...), log each time you go somewhere, and let
the app suggest the place your group is most overdue for.

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

The logic is a pure function in `backend/ranking.py`, tested in
`tests/test_ranking.py`.

## Groups are data, not code

Each group ("circle") has its own people, lists and places, and a secret
share link (`/c/<token>`). Anyone with the link can view and edit everything.
Removing a person, list or place only hides it, so history is kept and it
can be restored.

To start a group, describe it in a JSON file (see `circles/example.json`)
and run:

```bash
python -m scripts.create_circle circles/my-group.json --base-url https://your-app-url
```

It prints the link to share. Everything can be edited in the app afterwards.

## Project layout

```
backend/
  app.py        FastAPI routes (+ serves the built frontend)
  db.py         MongoDB access, everything scoped to one circle
  models.py     request validation
  ranking.py    the recommendation logic (pure, no I/O)
frontend/       React + TypeScript (Vite), builds into ../static
scripts/create_circle.py
circles/example.json
tests/
```

## Running locally

Needs Python 3.11+, Node 22, and a MongoDB connection string (a free MongoDB
Atlas M0 cluster is enough).

```bash
cp .env.example .env            # fill in MONGODB_URI
python -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt
(cd frontend && npm ci && npm run build)
python -m scripts.create_circle circles/example.json
uvicorn backend.app:app --reload
```

Open the printed link. For frontend work, also run `npm run dev` in
`frontend/` and open http://localhost:5173/c/<token> (it proxies `/api` to
uvicorn).

Tests use an in-memory MongoDB (`mongomock-motor`), no database needed:

```bash
pytest
```

## Deploying

`.github/workflows/deploy.yml` deploys to Azure App Service on every push to
`main`. It is skipped until it's configured:

1. Create an App Service (Linux, Python 3.11). Azure for Students allows
   **one Free (F1) plan per region**, so if one is already in use, pick a
   different region.
2. Under **Configuration > Application settings** add:
   - `MONGODB_URI`, `MONGODB_DB_NAME`
   - `SCM_DO_BUILD_DURING_DEPLOYMENT` = `true` (otherwise Azure never runs
     `pip install`, and the app fails with `No module named uvicorn`)
3. Under **Configuration > General settings**, set the startup command:
   `python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000`
4. Optionally, set the **Health check** path to `/health`.
5. In the GitHub repo settings, add a variable `AZURE_WEBAPP_NAME` (the App
   Service name) and a secret `AZURE_PUBLISH_PROFILE` (downloaded from the
   App Service overview page).
6. Run `create_circle` against the production database with
   `--base-url` set to the app's URL, and share the link.
