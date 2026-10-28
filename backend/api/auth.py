from typing import Literal
import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from backend.api.deps import get_current_scope
from backend.api.errors import APIContractError
from backend.core.auth import create_access_token, verify_password
from backend.core.config import settings
from backend.core.ratelimit import login_limiter
from backend.db.connection import get_db
from backend.repos.scope import Scope, SYSTEM_SCOPE
from backend.repos.users import get_user_by_id, get_user_by_username

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    role: Literal["TENANT", "OPERATOR", "SUPER_USER"]
    tenant_id: str | None
    display_name: str


class MeResponse(BaseModel):
    user_id: str
    role: Literal["TENANT", "OPERATOR", "SUPER_USER"]
    tenant_id: str | None
    display_name: str


@router.post("/login", response_model=LoginResponse)
async def login(
    req: LoginRequest,
    db: aiosqlite.Connection = Depends(get_db),
) -> LoginResponse:
    login_limiter.check(req.username)
    user = await get_user_by_username(db, req.username, scope=SYSTEM_SCOPE)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise APIContractError(
            code="UNAUTHENTICATED",
            message="Invalid username or password",
            status_code=401,
        )

    expires_in_seconds = settings.JWT_EXPIRE_HOURS * 3600
    token_payload = {
        "sub": user["user_id"],
        "user_id": user["user_id"],
        "role": user["role"],
        "tenant_id": user["tenant_id"],
        "display_name": user["display_name"],
    }
    access_token = create_access_token(token_payload)

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=expires_in_seconds,
        role=user["role"],
        tenant_id=user["tenant_id"],
        display_name=user["display_name"],
    )


@router.get("/me", response_model=MeResponse)
async def get_me(
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> MeResponse:
    user = await get_user_by_id(db, scope.user_id, scope=SYSTEM_SCOPE)
    if not user:
        raise APIContractError(
            code="NOT_FOUND",
            message="User profile not found",
            status_code=404,
        )

    return MeResponse(
        user_id=user["user_id"],
        role=user["role"],
        tenant_id=user["tenant_id"],
        display_name=user["display_name"],
    )

