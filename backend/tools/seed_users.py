import argparse
import sys
from pathlib import Path
import yaml

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.core.auth import hash_password
from backend.core.logging import logger
from backend.db.connection import get_sync_db, init_db_sync


def seed_users(yaml_path: str, db_path: str | None = None) -> None:
    path = Path(yaml_path)
    if not path.exists():
        logger.error(f"Users YAML file not found: {yaml_path}")
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    init_db_sync(db_path)
    conn = get_sync_db(db_path)

    try:
        cur = conn.cursor()

        # 1. Users
        users = data.get("users", [])
        for u in users:
            pw_hash = hash_password(u["password"])
            cur.execute(
                """
                INSERT INTO users (user_id, username, password_hash, role, tenant_id, display_name)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    username = excluded.username,
                    password_hash = excluded.password_hash,
                    role = excluded.role,
                    tenant_id = excluded.tenant_id,
                    display_name = excluded.display_name
                """,
                (u["user_id"], u["username"], pw_hash, u["role"], u.get("tenant_id"), u["display_name"]),
            )

        # 2. RFID Cards
        cards = data.get("cards", [])
        for c in cards:
            cur.execute(
                """
                INSERT INTO cards (uid, user_id, active, max_risk_tier, issued_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(uid) DO UPDATE SET
                    user_id = excluded.user_id,
                    active = excluded.active,
                    max_risk_tier = excluded.max_risk_tier,
                    issued_at = excluded.issued_at
                """,
                (c["uid"], c["user_id"], c.get("active", 1), c.get("max_risk_tier", 1), c["issued_at"]),
            )

        conn.commit()
        logger.info(
            f"Successfully seeded users and cards from {yaml_path}",
            extra={"extra_data": {"users_count": len(users), "cards_count": len(cards)}},
        )
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed RackSense users and RFID cards from YAML")
    parser.add_argument(
        "--config",
        "-c",
        default=str(Path(__file__).parent / "users.example.yaml"),
        help="Path to users YAML file",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="Path to SQLite database",
    )
    args = parser.parse_args()
    seed_users(args.config, args.db)

