import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "asymmetry.db"


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS recipes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_url     TEXT,
            raw_text    TEXT,
            title       TEXT,
            total_time_minutes INTEGER,
            servings    INTEGER,
            source_url  TEXT,
            source_platform TEXT DEFAULT 'other',
            thumbnail_url TEXT,
            status      TEXT DEFAULT 'pending',
            parse_error TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            cooked_at   DATETIME
        );

        CREATE TABLE IF NOT EXISTS ingredients (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            qty         REAL,
            unit        TEXT,
            item        TEXT NOT NULL,
            prep        TEXT,
            aisle       TEXT DEFAULT 'other'
        );

        CREATE TABLE IF NOT EXISTS steps (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            step_number INTEGER NOT NULL,
            instruction TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS shopping_lists (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shopping_list_recipes (
            list_id     INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
            recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            PRIMARY KEY (list_id, recipe_id)
        );

        CREATE TABLE IF NOT EXISTS shopping_list_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id     INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
            qty_display TEXT,
            unit        TEXT,
            item        TEXT NOT NULL,
            aisle       TEXT DEFAULT 'other',
            is_manual   INTEGER DEFAULT 0,
            checked     INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id   INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
            list_id     INTEGER REFERENCES shopping_lists(id) ON DELETE CASCADE,
            type        TEXT NOT NULL CHECK(type IN ('cook','prep','shop')),
            remind_at   TEXT NOT NULL,
            note        TEXT,
            fired       INTEGER DEFAULT 0,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cook_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
            cooked_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            rating      INTEGER CHECK(rating BETWEEN 1 AND 5),
            note        TEXT
        );
    """)
    conn.commit()
    conn.close()
