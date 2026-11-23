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
-- Every change and who made it ("website", "import", "chat").
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
