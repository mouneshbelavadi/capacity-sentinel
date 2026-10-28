from typing import Any
import aiosqlite
from backend.repos.scope import Scope, apply_scope


async def get_user_by_username(
    db: aiosqlite.Connection,
    username: str,
    scope: Scope,
) -> dict[str, Any] | None:
    base_query = "SELECT user_id, username, password_hash, role, tenant_id, display_name FROM users WHERE username = ?"
    scoped_query, params = apply_scope(base_query, scope, params=[username], tenant_filter="tenant_id = ?")
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if not row:
        return None
    return dict(row)


async def get_user_by_id(
    db: aiosqlite.Connection,
    user_id: str,
    scope: Scope,
) -> dict[str, Any] | None:
    base_query = "SELECT user_id, username, password_hash, role, tenant_id, display_name FROM users WHERE user_id = ?"
    scoped_query, params = apply_scope(base_query, scope, params=[user_id], tenant_filter="tenant_id = ?")
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if not row:
        return None
    return dict(row)


async def create_user(
    db: aiosqlite.Connection,
    user_id: str,
    username: str,
    password_hash: str,
    role: str,
    tenant_id: str | None,
    display_name: str,
    scope: Scope,
) -> dict[str, Any]:
    # Scope check: only SUPER_USER can create users
    apply_scope("INSERT INTO users", scope)
    await db.execute(
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
        (user_id, username, password_hash, role, tenant_id, display_name),
    )
    await db.commit()
    return {
        "user_id": user_id,
        "username": username,
        "role": role,
        "tenant_id": tenant_id,
        "display_name": display_name,
    }


async def get_card(
    db: aiosqlite.Connection,
    uid: str,
    scope: Scope,
) -> dict[str, Any] | None:
    base_query = (
        "SELECT c.uid, c.user_id, c.active, c.max_risk_tier, c.issued_at, "
        "u.role, u.tenant_id, u.display_name "
        "FROM cards c JOIN users u ON c.user_id = u.user_id WHERE c.uid = ?"
    )
    scoped_query, params = apply_scope(base_query, scope, params=[uid], tenant_filter="u.tenant_id = ?")
    cursor = await db.execute(scoped_query, params)
    row = await cursor.fetchone()
    if not row:
        return None
    return dict(row)


async def create_card(
    db: aiosqlite.Connection,
    uid: str,
    user_id: str,
    active: int,
    max_risk_tier: int,
    issued_at: str,
    scope: Scope,
) -> dict[str, Any]:
    apply_scope("INSERT INTO cards", scope)
    await db.execute(
        """
        INSERT INTO cards (uid, user_id, active, max_risk_tier, issued_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET
            user_id = excluded.user_id,
            active = excluded.active,
            max_risk_tier = excluded.max_risk_tier,
            issued_at = excluded.issued_at
        """,
        (uid, user_id, active, max_risk_tier, issued_at),
    )
    await db.commit()
    return {
        "uid": uid,
        "user_id": user_id,
        "active": active,
        "max_risk_tier": max_risk_tier,
        "issued_at": issued_at,
    }

