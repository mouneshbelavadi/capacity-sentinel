import hashlib
from typing import Annotated
import aiosqlite
from fastapi import Depends, Header
from backend.api.errors import APIContractError
from backend.core.auth import decode_access_token
from backend.db.connection import get_db
from backend.repos.scope import Scope
from backend.services.audit import append_audit_event


async def get_current_scope(
    authorization: Annotated[str | None, Header()] = None,
) -> Scope:
    """
    Extracts and validates Scope from the Authorization Bearer JWT.
    Resolved once per request by FastAPI dependency.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise APIContractError(
            code="UNAUTHENTICATED",
            message="Missing or invalid Authorization header",
            status_code=401,
        )

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(token)
    except Exception as e:
        raise APIContractError(
            code="UNAUTHENTICATED",
            message=f"Invalid or expired token: {e}",
            status_code=401,
        )

    role = payload.get("role")
    if role not in ("TENANT", "OPERATOR", "SUPER_USER"):
        raise APIContractError(
            code="UNAUTHENTICATED",
            message=f"Unknown role in token: {role}",
            status_code=401,
        )

    user_id = payload.get("user_id") or payload.get("sub")
    if not user_id:
        raise APIContractError(
            code="UNAUTHENTICATED",
            message="Token missing subject user_id",
            status_code=401,
        )

    tenant_id = payload.get("tenant_id")
    if role == "TENANT" and not tenant_id:
        raise APIContractError(
            code="UNAUTHENTICATED",
            message="Tenant token missing tenant_id",
            status_code=401,
        )

    return Scope(
        role=role,
        tenant_id=tenant_id,
        user_id=user_id,
    )


async def record_scope_denial(
    db: aiosqlite.Connection,
    scope: Scope,
    resource_type: str,
    resource_id: str,
) -> None:
    """
    Audits a scope denial. Hashes the resource ID to avoid leaking sensitive identifiers.
    """
    hashed_resource = hashlib.sha256(resource_id.encode("utf-8")).hexdigest()
    await append_audit_event(
        db=db,
        event="SCOPE_DENIED",
        actor=scope.user_id,
        subject={"resource_type": resource_type, "hashed_resource_id": hashed_resource},
        payload={"tenant_id": scope.tenant_id, "role": scope.role},
    )

