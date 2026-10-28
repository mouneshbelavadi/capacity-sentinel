from typing import Any
import aiosqlite
from backend.repos.scope import Scope, SYSTEM_SCOPE, apply_scope


async def get_site_topology(
    db: aiosqlite.Connection,
    site_id: str = "site-01",
    scope: Scope = SYSTEM_SCOPE,
) -> dict[str, Any]:
    """
    Returns topology for a site.
    For TENANT: returns full rack geometry, but foreign slots are redacted:
    tenant_id: null, tenant_label: null, node_id: null, status: 'UNKNOWN'.
    """
    base_site_query = "SELECT site_id, label FROM sites WHERE site_id = ?"
    scoped_site_q, site_params = apply_scope(base_site_query, scope, params=[site_id], tenant_filter="1=1")
    cursor = await db.execute(scoped_site_q, site_params)
    site_row = await cursor.fetchone()
    if not site_row:
        return {"site_id": site_id, "racks": []}

    base_racks_query = "SELECT rack_id, label, row, col FROM racks WHERE site_id = ? ORDER BY row, col"
    scoped_racks_q, rack_params = apply_scope(base_racks_query, scope, params=[site_id], tenant_filter="1=1")
    cursor = await db.execute(scoped_racks_q, rack_params)
    rack_rows = await cursor.fetchall()

    racks = []
    for r in rack_rows:
        rack_id = r["rack_id"]
        # Fetch slots for this rack joining tenants and nodes
        slots_cur = await db.execute(
            """
            SELECT s.slot_id, s.u_start, s.u_height, s.tenant_id, t.label AS tenant_label,
                   s.node_id, COALESCE(n.status, 'UNKNOWN') AS status
            FROM slots s
            LEFT JOIN tenants t ON s.tenant_id = t.tenant_id
            LEFT JOIN nodes n ON s.node_id = n.node_id
            WHERE s.rack_id = ?
            ORDER BY s.u_start ASC
            """,
            (rack_id,),
        )
        slot_rows = await slots_cur.fetchall()

        slots = []
        for s in slot_rows:
            slot_tenant = s["tenant_id"]
            if scope.role == "TENANT" and slot_tenant != scope.tenant_id:
                # Redacted foreign slot
                slots.append({
                    "slot_id": s["slot_id"],
                    "u_start": s["u_start"],
                    "u_height": s["u_height"],
                    "tenant_id": None,
                    "tenant_label": None,
                    "node_id": None,
                    "status": "UNKNOWN",
                })
            else:
                slots.append({
                    "slot_id": s["slot_id"],
                    "u_start": s["u_start"],
                    "u_height": s["u_height"],
                    "tenant_id": slot_tenant,
                    "tenant_label": s["tenant_label"],
                    "node_id": s["node_id"],
                    "status": s["status"],
                })

        racks.append({
            "rack_id": rack_id,
            "label": r["label"],
            "position": {"row": r["row"], "col": r["col"]},
            "slots": slots,
        })

    return {
        "site_id": site_id,
        "racks": racks,
    }


async def get_rack_nodes_stats(
    db: aiosqlite.Connection,
    rack_id: str,
    scope: Scope = SYSTEM_SCOPE,
) -> tuple[int, int, list[dict[str, Any]]]:
    """
    Returns (nodes_online, nodes_total, nodes_list) for a rack, scoped to the caller.
    A TENANT only receives stats computed over their own slots.
    """
    if scope.role == "TENANT":
        base_query = """
            SELECT n.node_id, n.status
            FROM nodes n
            JOIN slots s ON n.node_id = s.node_id
            WHERE n.rack_id = ?
        """
        scoped_query, params = apply_scope(
            base_query,
            scope,
            params=[rack_id],
            tenant_filter="s.tenant_id = ?",
        )
    else:
        base_query = "SELECT node_id, status FROM nodes WHERE rack_id = ?"
        scoped_query, params = apply_scope(base_query, scope, params=[rack_id])

    cursor = await db.execute(scoped_query, params)
    nodes = [dict(r) for r in await cursor.fetchall()]
    total = len(nodes)
    online = sum(1 for n in nodes if n["status"] in ("OK", "WARN", "CRIT"))
    return online, total, nodes


async def list_tenants(
    db: aiosqlite.Connection,
    scope: Scope = SYSTEM_SCOPE,
) -> list[dict[str, Any]]:
    """Returns list of tenants. Restricted to SUPER_USER; TENANT gets their own tenant only."""
    base_query = """
        SELECT t.tenant_id, t.label, t.contact, COUNT(s.slot_id) AS slot_count
        FROM tenants t
        LEFT JOIN slots s ON t.tenant_id = s.tenant_id
        GROUP BY t.tenant_id, t.label, t.contact
    """
    scoped_query, params = apply_scope(
        base_query,
        scope,
        tenant_filter="t.tenant_id = ?",
    )
    cursor = await db.execute(scoped_query, params)
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]
