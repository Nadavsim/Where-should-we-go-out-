-- One row per friend group. The token in the share link (/c/<token>) is the
-- group's only key.
CREATE TABLE circles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  never_days INTEGER NOT NULL DEFAULT 365,
  created_at TEXT NOT NULL
);

-- Removing a member, list or place only sets active = 0, so visit history
-- is kept and the removal can be undone.
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX members_circle ON members(circle_id);

CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX lists_circle ON lists(circle_id);

CREATE TABLE places (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id),
  list_id TEXT NOT NULL REFERENCES lists(id),
  name TEXT NOT NULL,
  link TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX places_circle_list ON places(circle_id, list_id);

-- attendees is a JSON array of member ids. Ranking happens in code, never in
-- SQL, so a join table would only add queries.
CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id),
  place_id TEXT NOT NULL REFERENCES places(id),
  date TEXT NOT NULL, -- YYYY-MM-DD in the app's timezone
  attendees TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX visits_circle_place ON visits(circle_id, place_id, date);
