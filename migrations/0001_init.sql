CREATE TABLE IF NOT EXISTS highscores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_highscores_mode_score
  ON highscores(mode, score DESC, duration ASC);
