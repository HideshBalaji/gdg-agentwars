"""Small SQLite repository. One API worker; transactions protect operational writes."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from ghost_dispatcher.models.contracts import Event


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


class Store:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS records (
                    kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(kind,id));
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id TEXT NOT NULL,
                    type TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS event_incident ON events(incident_id,id);
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def get(self, kind, key, db=None):
        if db is None:
            with self.connection() as connection:
                return self.get(kind, key, connection)
        row = db.execute(
            "SELECT payload FROM records WHERE kind=? AND id=?", (kind, key)
        ).fetchone()
        if row is None:
            raise DomainError("not_found", f"Unknown {kind}: {key}", 404)
        return json.loads(row["payload"])

    def put(self, kind, key, value, db=None):
        if db is None:
            with self.connection() as connection:
                return self.put(kind, key, value, connection)
        db.execute(
            "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE "
            "SET payload=excluded.payload",
            (kind, key, json.dumps(value)),
        )

    def delete_kinds(self, kinds, db=None):
        if db is None:
            with self.connection() as connection:
                return self.delete_kinds(kinds, connection)
        marks = ",".join("?" * len(kinds))
        return db.execute(f"DELETE FROM records WHERE kind IN ({marks})", tuple(kinds)).rowcount

    def list(self, kind):
        with self.connection() as db:
            rows = db.execute(
                "SELECT payload FROM records WHERE kind=? ORDER BY id LIMIT 1000", (kind,)
            ).fetchall()
        return [json.loads(row["payload"]) for row in rows]

    def emit(self, incident_id, event_type, data):
        with self.connection() as db:
            cursor = db.execute(
                "INSERT INTO events(incident_id,type,at,data) VALUES(?,?,?,?)",
                (incident_id, event_type, datetime.now(UTC).isoformat(), json.dumps(data)),
            )
            return cursor.lastrowid

    def events(self, incident_id, after=0):
        with self.connection() as db:
            rows = db.execute(
                "SELECT * FROM events WHERE incident_id=? AND id>? ORDER BY id LIMIT 1000",
                (incident_id, after),
            ).fetchall()
        return [
            Event(
                id=r["id"],
                incident_id=r["incident_id"],
                type=r["type"],
                at=r["at"],
                data=json.loads(r["data"]),
            )
            for r in rows
        ]
