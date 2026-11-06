CREATE TABLE IF NOT EXISTS geocode_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  address TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  detail TEXT NOT NULL,
  lat REAL,
  lng REAL
);
CREATE INDEX IF NOT EXISTS geocode_attempts_store ON geocode_attempts(store_id, id);

CREATE TABLE IF NOT EXISTS persist_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempted_at TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail TEXT NOT NULL
);
