# -*- coding: utf-8 -*-
"""
db.py — SQLite database manager for the Photo Registration System.
Handles all database operations: schema creation, CRUD for teams and players.
"""

import sqlite3
import os
import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fichaje.db")


def get_connection():
    """Get a database connection with row_factory set to sqlite3.Row."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # Better concurrency for multi-user
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create all tables if they don't exist."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            filename TEXT NOT NULL UNIQUE,
            sheet_name TEXT DEFAULT 'Data',
            total_players INTEGER DEFAULT 0,
            photos_ok INTEGER DEFAULT 0,
            photos_bad INTEGER DEFAULT 0,
            photos_missing INTEGER DEFAULT 0,
            photos_pending INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            excel_row INTEGER NOT NULL,
            name TEXT,
            surname TEXT,
            dni TEXT,
            email TEXT,
            competition TEXT,
            photo_status TEXT DEFAULT 'missing' CHECK(photo_status IN ('ok', 'bad', 'missing', 'pending_review', 'new')),
            photo_data BLOB,
            photo_thumbnail BLOB,
            photo_source TEXT CHECK(photo_source IN ('excel', 'webcam', 'upload', NULL)),
            photo_width INTEGER,
            photo_height INTEGER,
            reviewed_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            player_id INTEGER REFERENCES players(id),
            team_id INTEGER REFERENCES teams(id),
            user_name TEXT,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
        CREATE INDEX IF NOT EXISTS idx_players_status ON players(photo_status);
        CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
    """)

    conn.commit()
    conn.close()
    print("[DB] Database initialized successfully.")


def upsert_team(name, filename, sheet_name="Data"):
    """Insert or update a team. Returns team_id."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id FROM teams WHERE filename = ?", (filename,)
    )
    row = cursor.fetchone()

    if row:
        team_id = row["id"]
        cursor.execute(
            "UPDATE teams SET name = ?, sheet_name = ?, updated_at = ? WHERE id = ?",
            (name, sheet_name, datetime.datetime.now().isoformat(), team_id)
        )
    else:
        cursor.execute(
            "INSERT INTO teams (name, filename, sheet_name) VALUES (?, ?, ?)",
            (name, filename, sheet_name)
        )
        team_id = cursor.lastrowid

    conn.commit()
    conn.close()
    return team_id


def upsert_player(team_id, excel_row, name, surname, dni=None, email=None,
                   competition=None, photo_status="missing", photo_data=None,
                   photo_source=None, photo_width=None, photo_height=None):
    """Insert or update a player. Returns player_id."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id FROM players WHERE team_id = ? AND excel_row = ?",
        (team_id, excel_row)
    )
    row = cursor.fetchone()

    now = datetime.datetime.now().isoformat()

    if row:
        player_id = row["id"]
        # Update but preserve existing photo if new one is not provided
        if photo_data is not None:
            cursor.execute("""
                UPDATE players SET name=?, surname=?, dni=?, email=?, competition=?,
                    photo_status=?, photo_data=?, photo_source=?, 
                    photo_width=?, photo_height=?, updated_at=?
                WHERE id=?
            """, (name, surname, dni, email, competition, photo_status,
                  photo_data, photo_source, photo_width, photo_height, now, player_id))
        else:
            cursor.execute("""
                UPDATE players SET name=?, surname=?, dni=?, email=?, competition=?,
                    updated_at=?
                WHERE id=?
            """, (name, surname, dni, email, competition, now, player_id))
    else:
        cursor.execute("""
            INSERT INTO players (team_id, excel_row, name, surname, dni, email,
                competition, photo_status, photo_data, photo_source,
                photo_width, photo_height)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (team_id, excel_row, name, surname, dni, email, competition,
              photo_status, photo_data, photo_source, photo_width, photo_height))
        player_id = cursor.lastrowid

    conn.commit()
    conn.close()
    return player_id


def update_player_photo(player_id, photo_data, photo_source, photo_status="new",
                        photo_width=None, photo_height=None, user_name=None):
    """Update a player's photo and log the activity."""
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().isoformat()

    # Generate thumbnail
    thumbnail = _generate_thumbnail(photo_data) if photo_data else None

    cursor.execute("""
        UPDATE players SET photo_data=?, photo_thumbnail=?, photo_source=?,
            photo_status=?, photo_width=?, photo_height=?, updated_at=?
        WHERE id=?
    """, (photo_data, thumbnail, photo_source, photo_status,
          photo_width, photo_height, now, player_id))

    # Get player info for logging
    cursor.execute("SELECT name, surname, team_id FROM players WHERE id=?", (player_id,))
    player = cursor.fetchone()

    if player:
        cursor.execute("""
            INSERT INTO activity_log (action, player_id, team_id, user_name, details)
            VALUES (?, ?, ?, ?, ?)
        """, ("photo_captured", player_id, player["team_id"], user_name,
              f"Foto capturada para {player['name']} {player['surname']}"))

    conn.commit()
    conn.close()


def update_player_review(player_id, status, reviewer_name=None):
    """Update photo review status ('ok' or 'bad')."""
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().isoformat()

    cursor.execute("""
        UPDATE players SET photo_status=?, reviewed_by=?, updated_at=?
        WHERE id=?
    """, (status, reviewer_name, now, player_id))

    cursor.execute("SELECT name, surname, team_id FROM players WHERE id=?", (player_id,))
    player = cursor.fetchone()

    if player:
        cursor.execute("""
            INSERT INTO activity_log (action, player_id, team_id, user_name, details)
            VALUES (?, ?, ?, ?, ?)
        """, ("photo_reviewed", player_id, player["team_id"], reviewer_name,
              f"Foto de {player['name']} {player['surname']} marcada como {status}"))

    conn.commit()
    conn.close()


def get_teams():
    """Get all teams with updated stats."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT t.*,
            (SELECT COUNT(*) FROM players WHERE team_id = t.id) as total_players,
            (SELECT COUNT(*) FROM players WHERE team_id = t.id AND photo_status = 'ok') as photos_ok,
            (SELECT COUNT(*) FROM players WHERE team_id = t.id AND photo_status = 'bad') as photos_bad,
            (SELECT COUNT(*) FROM players WHERE team_id = t.id AND photo_status = 'missing') as photos_missing,
            (SELECT COUNT(*) FROM players WHERE team_id = t.id AND photo_status IN ('pending_review', 'new')) as photos_pending
        FROM teams t
        ORDER BY t.name
    """)

    teams = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return teams


def get_players(team_id=None, status_filter=None):
    """Get players, optionally filtered by team and/or photo status."""
    conn = get_connection()
    cursor = conn.cursor()

    query = "SELECT id, team_id, excel_row, name, surname, dni, email, competition, photo_status, photo_source, photo_width, photo_height, reviewed_by, created_at, updated_at FROM players WHERE 1=1"
    params = []

    if team_id:
        query += " AND team_id = ?"
        params.append(team_id)

    if status_filter:
        if status_filter == "missing":
            query += " AND photo_status IN ('missing', 'bad')"
        elif status_filter == "needs_work":
            query += " AND photo_status IN ('missing', 'bad', 'pending_review')"
        elif status_filter == "done":
            query += " AND photo_status = 'ok'"
        elif status_filter == "pending":
            query += " AND photo_status IN ('pending_review', 'new')"
        else:
            query += " AND photo_status = ?"
            params.append(status_filter)

    query += " ORDER BY excel_row"
    cursor.execute(query, params)

    players = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return players


def get_player(player_id):
    """Get a single player by ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, team_id, excel_row, name, surname, dni, email, competition, photo_status, photo_source, photo_width, photo_height, reviewed_by FROM players WHERE id = ?",
        (player_id,)
    )
    player = cursor.fetchone()
    result = dict(player) if player else None
    conn.close()
    return result


def get_player_photo(player_id):
    """Get the photo data for a player."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT photo_data, photo_status FROM players WHERE id = ?", (player_id,))
    row = cursor.fetchone()
    conn.close()
    if row and row["photo_data"]:
        return row["photo_data"], row["photo_status"]
    return None, None


def get_player_thumbnail(player_id):
    """Get the thumbnail for a player."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT photo_thumbnail FROM players WHERE id = ?", (player_id,))
    row = cursor.fetchone()
    conn.close()
    if row and row["photo_thumbnail"]:
        return row["photo_thumbnail"]
    return None


def get_activity_log(limit=50):
    """Get recent activity log entries."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT al.*, p.name as player_name, p.surname as player_surname, t.name as team_name
        FROM activity_log al
        LEFT JOIN players p ON al.player_id = p.id
        LEFT JOIN teams t ON al.team_id = t.id
        ORDER BY al.created_at DESC
        LIMIT ?
    """, (limit,))
    entries = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return entries


def get_global_stats():
    """Get global statistics."""
    conn = get_connection()
    cursor = conn.cursor()

    stats = {}
    cursor.execute("SELECT COUNT(*) as total FROM teams")
    stats["total_teams"] = cursor.fetchone()["total"]

    cursor.execute("SELECT COUNT(*) as total FROM players")
    stats["total_players"] = cursor.fetchone()["total"]

    for status in ["ok", "bad", "missing", "pending_review", "new"]:
        cursor.execute("SELECT COUNT(*) as total FROM players WHERE photo_status = ?", (status,))
        stats[f"photos_{status}"] = cursor.fetchone()["total"]

    stats["photos_done"] = stats["photos_ok"]
    stats["photos_remaining"] = stats["photos_missing"] + stats["photos_bad"]
    stats["photos_in_review"] = stats["photos_pending_review"] + stats["photos_new"]

    if stats["total_players"] > 0:
        stats["progress_pct"] = round((stats["photos_done"] / stats["total_players"]) * 100, 1)
    else:
        stats["progress_pct"] = 0

    conn.close()
    return stats


def update_team_stats(team_id):
    """Recalculate and update team photo stats."""
    conn = get_connection()
    cursor = conn.cursor()

    for status in ["ok", "bad", "missing"]:
        cursor.execute(
            "SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND photo_status = ?",
            (team_id, status)
        )
        count = cursor.fetchone()["cnt"]
        cursor.execute(
            f"UPDATE teams SET photos_{status} = ?, updated_at = ? WHERE id = ?",
            (count, datetime.datetime.now().isoformat(), team_id)
        )

    cursor.execute(
        "SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND photo_status IN ('pending_review', 'new')",
        (team_id,)
    )
    cursor.execute(
        "UPDATE teams SET photos_pending = ?, total_players = (SELECT COUNT(*) FROM players WHERE team_id = ?), updated_at = ? WHERE id = ?",
        (cursor.fetchone()["cnt"], team_id, datetime.datetime.now().isoformat(), team_id)
    )

    conn.commit()
    conn.close()


def _generate_thumbnail(photo_data, max_size=(120, 120)):
    """Generate a JPEG thumbnail from photo data."""
    try:
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(photo_data))
        img.thumbnail(max_size, Image.Resampling.LANCZOS)

        # Convert to RGB if necessary (for RGBA PNGs)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=75)
        return buffer.getvalue()
    except Exception:
        return None


if __name__ == "__main__":
    init_db()
    print(f"[DB] Database created at: {DB_PATH}")
