import argparse
from datetime import datetime, timezone
import getpass
import hashlib
from pathlib import Path
import sys

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.core.config import settings
from backend.core.logging import logger
from backend.db.connection import get_sync_db, init_db_sync


def register_reader(
    device_id: str,
    device_secret: str,
    label: str,
    db_path: str | None = None,
) -> None:
    init_db_sync(db_path)
    conn = get_sync_db(db_path)

    secret_hash = hashlib.sha256(device_secret.encode("utf-8")).hexdigest()
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO reader_devices (device_id, device_secret, secret_hash, label, registered_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                device_secret = excluded.device_secret,
                secret_hash = excluded.secret_hash,
                label = excluded.label
            """,
            (device_id, device_secret, secret_hash, label, now_iso),
        )
        conn.commit()
        print(f"Reader device '{device_id}' ({label}) registered successfully.")
        print(f"Secret hash: {secret_hash}")
        print(f"Timestamp:   {now_iso}")
    except Exception as e:
        logger.error(f"Failed to register reader: {e}")
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Register an RFID Reader device with a shared secret.")
    parser.add_argument("--device-id", type=str, help="Device ID (e.g. reader-01)")
    parser.add_argument("--secret", type=str, help="Per-device shared secret (omit to enter interactively)")
    parser.add_argument("--label", type=str, default="Bench RFID Console", help="Human-readable label")
    parser.add_argument("--db-path", type=str, default=None, help="Path to SQLite database")

    args = parser.parse_args()

    device_id = args.device_id
    if not device_id:
        device_id = input("Enter device ID (e.g. reader-01): ").strip()
        if not device_id:
            print("Device ID cannot be empty.")
            sys.exit(1)

    device_secret = args.secret
    if not device_secret:
        device_secret = getpass.getpass("Enter per-device shared secret: ").strip()
        if not device_secret:
            print("Shared secret cannot be empty.")
            sys.exit(1)

    register_reader(
        device_id=device_id,
        device_secret=device_secret,
        label=args.label,
        db_path=args.db_path,
    )


if __name__ == "__main__":
    main()

