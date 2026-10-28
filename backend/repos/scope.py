from dataclasses import dataclass
from typing import Any, Literal
import aiosqlite


@dataclass(frozen=True)
class Scope:
    role: Literal["TENANT", "OPERATOR", "SUPER_USER"]
    tenant_id: str | None
    user_id: str


SYSTEM_SCOPE = Scope(role="SUPER_USER", tenant_id=None, user_id="system")


def apply_scope(
    query: str,
    scope: Scope,
    params: list[Any] | None = None,
    tenant_filter: str = "tenant_id = ?",
) -> tuple[str, list[Any]]:
    """
    The ONE place tenant filtering happens. Every tenant-data query calls this.
    For OPERATOR and SUPER_USER, it is a strict no-op.
    For TENANT, it adds the scoped tenant condition.
    """
    actual_params = list(params) if params is not None else []

    if scope.role in ("OPERATOR", "SUPER_USER"):
        return query, actual_params

    if scope.role == "TENANT":
        if tenant_filter == "1=1" or tenant_filter is None:
            return query, actual_params

        if not scope.tenant_id:
            raise ValueError("Tenant scope must specify a valid tenant_id")

        filter_params = [scope.tenant_id] if "?" in tenant_filter else []

        # Find trailers like ORDER BY, GROUP BY, LIMIT
        upper_q = query.upper()
        order_idx = upper_q.find(" ORDER BY ")
        group_idx = upper_q.find(" GROUP BY ")
        limit_idx = upper_q.find(" LIMIT ")

        trailer_indices = [idx for idx in (order_idx, group_idx, limit_idx) if idx != -1]
        split_idx = min(trailer_indices) if trailer_indices else len(query)

        head = query[:split_idx]
        tail = query[split_idx:]

        if " WHERE " in head.upper():
            new_query = f"{head} AND {tenant_filter}{tail}"
        else:
            new_query = f"{head} WHERE {tenant_filter}{tail}"

        # Place filter params before trailer params (e.g. before LIMIT ?)
        trailer_q_count = tail.count("?")
        if trailer_q_count > 0:
            prefix_params = actual_params[:-trailer_q_count]
            suffix_params = actual_params[-trailer_q_count:]
            final_params = prefix_params + filter_params + suffix_params
        else:
            final_params = actual_params + filter_params

        return new_query, final_params

    raise ValueError(f"Unknown scope role: {scope.role}")


async def is_node_allowed(db: aiosqlite.Connection, node_id: str, scope: Scope) -> bool:
    """Checks whether the scope has access to the given node."""
    if scope.role in ("OPERATOR", "SUPER_USER"):
        return True

    base_query = "SELECT 1 FROM slots WHERE node_id = ?"
    scoped_query, params = apply_scope(
        base_query,
        scope,
        params=[node_id],
        tenant_filter="tenant_id = ?",
    )
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    return row is not None
