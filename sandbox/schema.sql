-- BetterAndroRAT panel schema, ported from "Panel/Other Files/SQL.sql" for SQLite.
-- The SQL the panel issues is ANSI enough that no application code changes are
-- needed beyond the PDO DSN (see sandbox/README.md).
--
-- Differences from the MySQL original:
--   * int/varchar/tinyint/decimal  -> INTEGER/TEXT/REAL
--   * AUTO_INCREMENT               -> INTEGER PRIMARY KEY AUTOINCREMENT
--   * ON UPDATE CURRENT_TIMESTAMP  -> AFTER UPDATE trigger
--   * omitted columns in INSERTs get explicit DEFAULTs (MySQL used zero values)

PRAGMA journal_mode = DELETE;

CREATE TABLE IF NOT EXISTS bots (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  uid      TEXT    NOT NULL,
  status   INTEGER NOT NULL DEFAULT 0,
  `update` TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provider TEXT    NOT NULL DEFAULT '',
  lati     REAL    NOT NULL DEFAULT 0,
  longi    REAL    NOT NULL DEFAULT 0,
  device   TEXT    NOT NULL DEFAULT '',
  sdk      TEXT    NOT NULL DEFAULT '',
  version  TEXT    NOT NULL DEFAULT '',
  phone    TEXT    NOT NULL DEFAULT '',
  random   TEXT    NOT NULL DEFAULT '',
  blocked  TEXT    NOT NULL DEFAULT 'no'
);

-- MySQL's `update` column is DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP.
DROP TRIGGER IF EXISTS bots_touch;
CREATE TRIGGER bots_touch AFTER UPDATE ON bots
BEGIN
  UPDATE bots SET `update` = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS commands (
  uid     TEXT NOT NULL,
  command TEXT NOT NULL,
  arg1    TEXT NOT NULL DEFAULT '',
  arg2    TEXT NOT NULL DEFAULT '',
  arg3    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS files (
  uid   TEXT NOT NULL,
  file  TEXT NOT NULL,
  `time` TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  uid     TEXT NOT NULL,
  message TEXT NOT NULL
);
