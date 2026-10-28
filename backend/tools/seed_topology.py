import argparse
import sys
from pathlib import Path
import yaml

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.core.logging import logger
from backend.db.connection import get_sync_db, init_db_sync


def seed_topology(yaml_path: str, db_path: str | None = None) -> None:
    path = Path(yaml_path)
    if not path.exists():
        logger.error(f"Topology file not found: {yaml_path}")
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    init_db_sync(db_path)
    conn = get_sync_db(db_path)

    try:
        cur = conn.cursor()

        # 1. Site
        site = data.get("site", {})
        if site:
            cur.execute(
                """
                INSERT INTO sites (site_id, label)
                VALUES (?, ?)
                ON CONFLICT(site_id) DO UPDATE SET label = excluded.label
                """,
                (site["site_id"], site["label"]),
            )

        # 2. Tenants
        for t in data.get("tenants", []):
            cur.execute(
                """
                INSERT INTO tenants (tenant_id, label, contact)
                VALUES (?, ?, ?)
                ON CONFLICT(tenant_id) DO UPDATE SET label = excluded.label, contact = excluded.contact
                """,
                (t["tenant_id"], t["label"], t["contact"]),
            )

        # 3. Racks
        for r in data.get("racks", []):
            cur.execute(
                """
                INSERT INTO racks (rack_id, site_id, label, row, col)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(rack_id) DO UPDATE SET label = excluded.label, row = excluded.row, col = excluded.col
                """,
                (r["rack_id"], site.get("site_id", "site-01"), r["label"], r["row"], r["col"]),
            )

        # 4. Nodes
        for n in data.get("nodes", []):
            cur.execute(
                """
                INSERT INTO nodes (node_id, rack_id, fw, status)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(node_id) DO UPDATE SET rack_id = excluded.rack_id, fw = excluded.fw
                """,
                (n["node_id"], n["rack_id"], n.get("fw", "0.3.1"), n.get("status", "UNKNOWN")),
            )

        # 5. Slots
        for s in data.get("slots", []):
            cur.execute(
                """
                INSERT INTO slots (slot_id, rack_id, u_start, u_height, tenant_id, node_id)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(slot_id) DO UPDATE SET
                    rack_id = excluded.rack_id,
                    u_start = excluded.u_start,
                    u_height = excluded.u_height,
                    tenant_id = excluded.tenant_id,
                    node_id = excluded.node_id
                """,
                (s["slot_id"], s["rack_id"], s["u_start"], s["u_height"], s.get("tenant_id"), s.get("node_id")),
            )

        conn.commit()
        logger.info(
            f"Successfully seeded topology from {yaml_path}",
            extra={"extra_data": {
                "site": site.get("site_id"),
                "racks_count": len(data.get("racks", [])),
                "nodes_count": len(data.get("nodes", [])),
                "slots_count": len(data.get("slots", [])),
            }}
        )
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed RackSense topology from bench YAML file")
    parser.add_argument(
        "--config",
        "-c",
        default=str(Path(__file__).parent / "topology.example.yaml"),
        help="Path to topology YAML file",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="Path to SQLite database",
    )
    args = parser.parse_args()
    seed_topology(args.config, args.db)
