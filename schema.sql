-- Wordle Wars database (Cloudflare D1 "wordle-wars"). Same columns as the old Google Sheet tabs.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,               -- slug, like "grammy"
  name TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 99,   -- the sheet's "order" column
  remind INTEGER NOT NULL DEFAULT 0, -- 1 = gets the 8 PM email
  email TEXT NOT NULL DEFAULT '',
  joined TEXT NOT NULL DEFAULT ''    -- yyyy-mm-dd
);
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,               -- "<puzzle>_<player>"
  player TEXT NOT NULL,
  puzzle INTEGER NOT NULL,
  date TEXT NOT NULL,                -- yyyy-mm-dd, Central time
  month TEXT NOT NULL,               -- yyyy-mm
  guesses INTEGER NOT NULL CHECK (guesses BETWEEN 1 AND 7), -- 7 = X
  at TEXT NOT NULL DEFAULT ''        -- when it was logged (ISO), or "from group chat"
);
CREATE INDEX IF NOT EXISTS scores_date ON scores(date);
CREATE INDEX IF NOT EXISTS scores_month ON scores(month, player);
CREATE TABLE IF NOT EXISTS adjustments (
  player TEXT NOT NULL,
  month TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,  -- carried-in total covering every day through "through"
  through TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (player, month)
);
CREATE TABLE IF NOT EXISTS champions (
  month TEXT PRIMARY KEY,            -- yyyy-mm
  players TEXT NOT NULL,             -- comma list of player ids
  total INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS talk (
  id TEXT PRIMARY KEY,               -- "<at>_<player>"
  player TEXT NOT NULL,
  date TEXT NOT NULL,
  puzzle INTEGER NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS talk_at ON talk(at);
-- Practice Wordle games. The answer lives only here; the page only ever sees the colors. Rows older than 2 days are deleted when a new game starts.
CREATE TABLE IF NOT EXISTS practice (
  id TEXT PRIMARY KEY,               -- random game id
  answer TEXT NOT NULL,
  guesses TEXT NOT NULL DEFAULT '',  -- comma list of guesses so far
  at TEXT NOT NULL                   -- when the game started (ISO)
);
-- Sign-in accounts (Nov 25, 2026). status: pending (waiting for Golden), approved, kicked (can't sign in again).
-- player: the players.id this account plays as ('' until Golden links or approves it).
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  player TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created TEXT NOT NULL
);
-- Signed-in phones. token is the SHA-256 of the cookie value, never the value itself.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  expires TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account);
-- Email sign-in codes (hashed), kept a day for rate limits.
CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL,
  at TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS codes_email ON codes(email, at);
-- Today's Wordle games, one row per player per day. score: guesses to win, 7 for a miss, NULL while playing.
-- Nov 25 to 30 rows are the test run (no crown); from Dec 1 a finished game is also written into scores.
CREATE TABLE IF NOT EXISTS daily (
  id TEXT PRIMARY KEY,               -- "<date>_<player>"
  player TEXT NOT NULL,
  account TEXT NOT NULL,
  date TEXT NOT NULL,
  guesses TEXT NOT NULL DEFAULT '',
  score INTEGER,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS daily_date ON daily(date);
-- Every change and who made it ("website", "import", "chat").
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
