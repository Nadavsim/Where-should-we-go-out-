# Where should we go out?

A web app for a friend group: shared lists of places, a log of who went
where and when, and a suggestion of the place tonight's group is most
overdue for. See `README.md` for setup and the ranking rules.

## Decisions (keep unless the user changes them)

- **Ranking** (`backend/ranking.py`, pure function): a visit counts for
  tonight if ANY of tonight's people attended. Score = average over
  tonight's people of days since that person last went (never, or older than
  `never_days`, counts as `never_days`, default 365). Highest first. Ties:
  fewer visits involving tonight's people, then random. The user chose this
  explicitly over "exact group" and "everyone was there" rules, and over the
  plain "most recent visit by anyone" rule, because of the case where one
  person went yesterday and the rest have never been.
- **Single-place lists** don't recommend; they show the last visit (by any
  of tonight's people) and who was there.
- **Groups are data**: circle -> members (embedded) -> lists -> places,
  plus a visits collection. Nothing about a specific group lives in code.
  New groups come from a JSON file via `scripts/create_circle.py`.
- **Access**: the secret token in the share link `/c/<token>` is the only
  key, and everyone with it can edit. So: `Referrer-Policy: no-referrer`,
  noindex, and every DB query is scoped by `circle_id`.
- **Removing** a member, list or place only sets `active: false` (history
  kept, restorable). Deleting a *visit* is a real delete (it's the undo for
  a mistaken log).
- Visit dates are `YYYY-MM-DD` strings in `APP_TIMEZONE` (default
  Asia/Jerusalem); future dates are rejected.
- **Budget**: the same stay-cheap rule as the user's other project (TLV Bot,
  $15/month cap across both): MongoDB Atlas M0 (free), Azure F1 (free).

## Working on it

- Tests: `pytest` (in-memory Mongo via `mongomock-motor`; no `.env` needed).
- Frontend: `cd frontend && npm run build` (typecheck + build into
  `../static`), `npm run lint`. No frontend test suite yet.
- The frontend has no router library: the token is in the path, screens are
  in the hash (`#who`, `#list/<id>`) so the phone's back button works.
