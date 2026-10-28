from typing import Any
import aiosqlite
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from backend.api.deps import get_current_scope
from backend.db.connection import get_db
from backend.repos.scope import Scope
from backend.services.ai.prompts import (
    ai_chat,
    ai_explain,
    ai_propose,
    ai_summarize,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])


class SummarizeRequest(BaseModel):
    scope: str = Field(..., description="Scope type: site | rack | node")
    id: str = Field(..., description="Target identifier (site_id, rack_id, or node_id)")


class ExplainRequest(BaseModel):
    forecast_id: str = Field(..., description="Forecast identifier to explain")


class ProposeRequest(BaseModel):
    node_id: str | None = None
    rack_id: str | None = None


class ChatRequest(BaseModel):
    proposal_id: str = Field(..., description="Proposal ID being discussed")
    message: str = Field(..., description="Operator message or question")


@router.post("/summarize")
async def handle_summarize(
    req: SummarizeRequest,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Summarizer: produces 2-3 sentences + status_hint + evidence IDs from real computed metrics.
    """
    return await ai_summarize(
        db=db,
        scope_type=req.scope,
        target_id=req.id,
        caller_scope=scope,
    )


@router.post("/explain")
async def handle_explain(
    req: ExplainRequest,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Explainer: explains real forecast parameters (slope, CI, damping, crossing, calibration)
    citing supplied evidence IDs.
    """
    return await ai_explain(
        db=db,
        forecast_id=req.forecast_id,
        caller_scope=scope,
    )


@router.post("/propose", status_code=status.HTTP_201_CREATED)
async def handle_propose(
    req: ProposeRequest,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Proposer: proposes a capacity mitigation action from the closed whitelist.
    Creates a new proposal with status PROPOSED.
    """
    return await ai_propose(
        db=db,
        node_id=req.node_id,
        rack_id=req.rack_id,
        caller_scope=scope,
    )


@router.post("/chat")
async def handle_chat(
    req: ChatRequest,
    scope: Scope = Depends(get_current_scope),
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Discussion before approval: talk to the AI about a proposal before deciding to arm it.
    Can revise proposal fields while strictly keeping status DISCUSSING.
    Discussion can NEVER approve or authorize.
    """
    return await ai_chat(
        db=db,
        proposal_id=req.proposal_id,
        message=req.message,
        caller_scope=scope,
    )

