from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from backend.api.deps import get_current_scope, record_scope_denial
from backend.api.errors import APIContractError
from backend.core.config import settings
from backend.db.connection import get_db
from backend.repos.scope import Scope
from backend.repos.topology import get_site_topology, list_tenants

router = APIRouter(prefix="/api", tags=["topology"])


class SlotPosition(BaseModel):
    slot_id: str
    u_start: int
    u_height: int
    tenant_id: str | None
    tenant_label: str | None
    node_id: str | None
    status: str


class RackPosition(BaseModel):
    row: int
    col: int


class RackItem(BaseModel):
    rack_id: str
    label: str
    position: RackPosition
    slots: list[SlotPosition]


class TopologyResponse(BaseModel):
    site_id: str
    racks: list[RackItem]


class TenantItem(BaseModel):
    tenant_id: str
    label: str
    slot_count: int
    contact: str


class TenantsResponse(BaseModel):
    tenants: list[TenantItem]


@router.get("/topology", response_model=TopologyResponse)
async def get_topology(
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> Any:
    """
    Returns full topology.
    For TENANT: full geometry is preserved, but foreign slots are redacted.
    """
    topology = await get_site_topology(db, site_id=settings.SITE_ID, scope=scope)
    return topology


@router.get("/tenants", response_model=TenantsResponse)
async def get_tenants(
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> TenantsResponse:
    """
    List all tenants. Restrict to SUPER_USER; any other role gets 404 (Contract §2, §3).
    """
    if scope.role != "SUPER_USER":
        await record_scope_denial(db, scope, "tenants", "tenants")
        raise APIContractError(
            code="NOT_FOUND",
            message="Resource not found",
            status_code=404,
        )

    tenants = await list_tenants(db, scope=scope)
    return TenantsResponse(tenants=[TenantItem(**t) for t in tenants])
