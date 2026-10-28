import os
import sqlite3
from pathlib import Path
from typing import AsyncGenerator
import aiosqlite
from backend.core.config import settings
from backend.core.logging import logger

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def ensure_db_dir(db_path: str) -> None:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)


def init_db_sync(db_path: str | None = None) -> None:
    """Initialize database tables and pragmas synchronously."""
    actual_path = db_path or settings.DB_PATH
    ensure_db_dir(actual_path)
    with sqlite3.connect(actual_path) as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            conn.executescript(f.read())
        conn.commit()
    logger.info("Database initialized successfully", extra={"extra_data": {"db_path": actual_path}})


async def init_db_async(db_path: str | None = None) -> None:
    """Initialize database tables and pragmas asynchronously."""
    actual_path = db_path or settings.DB_PATH
    ensure_db_dir(actual_path)
    async with aiosqlite.connect(actual_path) as db:
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("PRAGMA synchronous=NORMAL;")
        await db.execute("PRAGMA foreign_keys=ON;")
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())
        await db.commit()
    logger.info("Async database initialized successfully", extra={"extra_data": {"db_path": actual_path}})


async def get_db(db_path: str | None = None) -> AsyncGenerator[aiosqlite.Connection, None]:
    """Async context provider for database connection with row factory enabled."""
    actual_path = db_path or settings.DB_PATH
    ensure_db_dir(actual_path)
    async with aiosqlite.connect(actual_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("PRAGMA synchronous=NORMAL;")
        await db.execute("PRAGMA foreign_keys=ON;")
        yield db


def get_sync_db(db_path: str | None = None) -> sqlite3.Connection:
    """Synchronous connection for scripts and tools."""
    actual_path = db_path or settings.DB_PATH
    ensure_db_dir(actual_path)
    conn = sqlite3.connect(actual_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn
