from datetime import datetime, timezone
import hashlib
import json
import secrets
from typing import Any
import aiosqlite

from backend.api.errors import APIContractError
from backend.core.config import settings
from backend.core.logging import logger
from backend.repos.analysis import (
    get_cached_forecast_by_id,
    query_cached_forecasts,
    query_changepoints,
)
from backend.repos.nodes import get_node
from backend.repos.proposals import (
    RISK_TIERS,
    WHITELISTED_ACTIONS,
    create_proposal,
    get_proposal,
    update_proposal_status,
)
from backend.repos.scope import Scope, SYSTEM_SCOPE
from backend.repos.telemetry import query_node_telemetry
from backend.repos.topology import get_rack_nodes_stats
from backend.services.ai.client import call_llm_json
from backend.services.ai.rag import rag_corpus
from backend.services.audit import append_audit_event
from backend.services.margins import assess_metric_status, compute_dew_point, get_metric_limit_info


def _hash_prompt(prompt_text: str) -> str:
    return hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()[:16]


async def ai_summarize(
    db: aiosqlite.Connection,
    scope_type: str,
    target_id: str,
    caller_scope: Scope,
) -> dict[str, Any]:
    """
    Summarizer: produces 2-3 sentence overview + status_hint (OK/WARN/CRIT) + evidence IDs.
    Strictly validates that evidence IDs in output were supplied in context.
    """
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    context_data: dict[str, Any] = {"scope": scope_type, "id": target_id}
    supplied_evidence_ids: set[str] = set()

    if scope_type == "node":
        node = await get_node(db, target_id, scope=caller_scope)
        if not node:
            raise APIContractError(code="NOT_FOUND", message=f"Node '{target_id}' not found", status_code=404)
        context_data["node"] = node
        supplied_evidence_ids.add(f"ev_node_{target_id}")

        # Add latest telemetry and margins
        points_tc = await query_node_telemetry(db, target_id, "t_c", limit=1, scope=caller_scope)
        points_rh = await query_node_telemetry(db, target_id, "rh", limit=1, scope=caller_scope)
        points_vib = await query_node_telemetry(db, target_id, "vib_rms_g", limit=1, scope=caller_scope)
        points_mq = await query_node_telemetry(db, target_id, "mq_ratio", limit=1, scope=caller_scope)

        latest_tc = points_tc[0]["value"] if points_tc else None
        latest_rh = points_rh[0]["value"] if points_rh else None
        latest_vib = points_vib[0]["value"] if points_vib else None
        latest_mq = points_mq[0]["value"] if points_mq else None

        margins: dict[str, Any] = {}
        if latest_tc is not None:
            limit_tc, _ = get_metric_limit_info("t_c")
            margins["t_c"] = {
                "value": latest_tc,
                "limit": limit_tc,
                "margin": round(limit_tc - latest_tc, 2) if limit_tc else None,
                "status": assess_metric_status("t_c", latest_tc),
            }
        if latest_tc is not None and latest_rh is not None:
            dew = compute_dew_point(latest_tc, latest_rh)
            limit_dew, _ = get_metric_limit_info("dew_c")
            margins["dew_c"] = {
                "value": dew,
                "limit": limit_dew,
                "margin": round(limit_dew - dew, 2) if limit_dew else None,
                "status": assess_metric_status("dew_c", dew),
            }
        if latest_vib is not None:
            margins["vib_rms_g"] = {"value": latest_vib}
        if latest_mq is not None:
            margins["mq_ratio"] = {"value": latest_mq}

        context_data["margins"] = margins

        # Add cached forecasts
        forecasts = await query_cached_forecasts(db, node_id=target_id, scope=caller_scope)
        context_data["forecasts"] = []
        for fc in forecasts:
            fid = f"fc_{fc['forecast_id']}"
            supplied_evidence_ids.add(fid)
            context_data["forecasts"].append({
                "metric": fc["metric"],
                "forecast_id": fid,
                "has_trend": fc["payload"].get("has_trend"),
                "crossing": fc["payload"].get("crossing"),
                "no_breach_fraction": fc["payload"].get("no_breach_fraction"),
            })

        # Add changepoints
        cps = await query_changepoints(db, node_id=target_id, scope=caller_scope)
        context_data["changepoints"] = []
        for cp in cps:
            cpid = f"cp_{cp['cp_id']}"
            supplied_evidence_ids.add(cpid)
            context_data["changepoints"].append({
                "cp_id": cpid,
                "metric": cp["metric"],
                "delta": cp["delta"],
                "detected_at": cp["detected_at"],
            })

    elif scope_type == "rack":
        online, total, nodes = await get_rack_nodes_stats(db, target_id, scope=caller_scope)
        if total == 0 and caller_scope.role == "TENANT":
            raise APIContractError(code="NOT_FOUND", message=f"Rack '{target_id}' not found", status_code=404)
        context_data["rack_summary"] = {"rack_id": target_id, "nodes_online": online, "nodes_total": total}
        supplied_evidence_ids.add(f"ev_rack_{target_id}")
    else:
        context_data["site_id"] = target_id
        supplied_evidence_ids.add(f"ev_site_{target_id}")

    # RAG Retrieval (Scope-first)
    rag_docs = rag_corpus.retrieve(f"{scope_type} {target_id} capacity margin", scope=caller_scope, top_k=2)
    context_data["retrieved_runbook"] = []
    for doc in rag_docs:
        supplied_evidence_ids.add(doc.doc_id)
        context_data["retrieved_runbook"].append({"doc_id": doc.doc_id, "title": doc.title, "content": doc.content})

    system_prompt = (
        "You are RackSense Advisory AI (OWASP LLM06 compliant, advisory only).\n"
        "Rules:\n"
        "1. You compute NO numbers. Use only figures present in the context.\n"
        "2. Provide 2-3 concise factual sentences on capacity and operational margin.\n"
        "3. In 'evidence', cite ONLY IDs from the 'allowed_evidence_ids' list.\n"
        "4. Output MUST be strict JSON: {\"text\": string, \"status_hint\": \"OK\"|\"WARN\"|\"CRIT\", \"evidence\": [string]}"
    )

    user_prompt = json.dumps({
        "task": "Summarize capacity status",
        "allowed_evidence_ids": list(supplied_evidence_ids),
        "context": context_data,
    }, sort_keys=True)

    prompt_hash = _hash_prompt(user_prompt)

    try:
        parsed, raw_text = await call_llm_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_schema={"type": "object", "properties": {"text": {"type": "string"}, "status_hint": {"type": "string"}, "evidence": {"type": "array"}}},
            max_retries=1,
        )
    except APIContractError as err:
        # Audit provider failure
        await append_audit_event(
            db=db,
            event="AI_PROPOSAL",
            actor=f"user:{caller_scope.user_id}",
            subject={"target_id": target_id, "scope_type": scope_type},
            payload={"role": "summarizer", "error": err.message, "status": "AI_UNAVAILABLE"},
        )
        raise

    # Validation: evidence check
    output_evidence = parsed.get("evidence", [])
    invalid_ids = [eid for eid in output_evidence if eid not in supplied_evidence_ids]
    if invalid_ids:
        await append_audit_event(
            db=db,
            event="AI_EVIDENCE_INVALID",
            actor=f"user:{caller_scope.user_id}",
            subject={"target_id": target_id},
            payload={
                "role": "summarizer",
                "invalid_evidence": invalid_ids,
                "supplied_evidence": list(supplied_evidence_ids),
                "raw_response": raw_text,
            },
        )
        raise APIContractError(
            code="AI_EVIDENCE_INVALID",
            message=f"Model cited unknown evidence IDs: {invalid_ids}",
            status_code=400,
        )

    # Validated audit log
    await append_audit_event(
        db=db,
        event="AI_PROPOSAL",
        actor=f"user:{caller_scope.user_id}",
        subject={"target_id": target_id, "scope_type": scope_type},
        payload={
            "role": "summarizer",
            "model": settings.AI_MODEL,
            "prompt_hash": prompt_hash,
            "evidence_supplied": list(supplied_evidence_ids),
            "evidence_cited": output_evidence,
            "status": "VALIDATED",
        },
    )

    status_hint = parsed.get("status_hint", "OK")
    if status_hint not in ("OK", "WARN", "CRIT"):
        status_hint = "OK"

    return {
        "text": parsed.get("text", "Capacity is within nominal envelope."),
        "status_hint": status_hint,
        "evidence": output_evidence,
        "meta": {
            "quality": "ai_generated",
            "model": settings.AI_MODEL,
            "as_of": now_iso,
        },
    }


async def ai_explain(
    db: aiosqlite.Connection,
    forecast_id: str,
    caller_scope: Scope,
) -> dict[str, Any]:
    """
    Explainer: explains real forecast parameters (slope, CI, damping, crossing, calibration)
    citing supplied evidence IDs.
    """
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    cached_fc = await get_cached_forecast_by_id(db, forecast_id=forecast_id, scope=caller_scope)
    if not cached_fc:
        raise APIContractError(code="NOT_FOUND", message=f"Forecast '{forecast_id}' not found", status_code=404)

    fc_payload = cached_fc["payload"]
    fc_evidence_id = f"fc_{forecast_id}"
    supplied_evidence_ids = {fc_evidence_id}

    context_data = {
        "forecast_id": fc_evidence_id,
        "node_id": cached_fc["node_id"],
        "metric": cached_fc["metric"],
        "has_trend": fc_payload.get("has_trend"),
        "slope_estimate": fc_payload.get("slope"),
        "slope_95_ci": fc_payload.get("slope_ci"),
        "window_reason": fc_payload.get("window_reason"),
        "crossing_quantiles": fc_payload.get("crossing"),
        "no_breach_fraction": fc_payload.get("no_breach_fraction"),
        "calibration_widening_factor": 1.18,
    }

    # If window reason points to a changepoint, include it
    w_reason = fc_payload.get("window_reason", "")
    if "changepoint:" in w_reason:
        cp_id = w_reason.split("changepoint:")[-1]
        supplied_evidence_ids.add(f"cp_{cp_id}")
        context_data["related_changepoint"] = f"cp_{cp_id}"

    # Scoped RAG
    rag_docs = rag_corpus.retrieve(f"ASHRAE limit explanation for {cached_fc['metric']}", scope=caller_scope, top_k=2)
    context_data["retrieved_runbook"] = []
    for doc in rag_docs:
        supplied_evidence_ids.add(doc.doc_id)
        context_data["retrieved_runbook"].append({"doc_id": doc.doc_id, "title": doc.title, "content": doc.content})

    system_prompt = (
        "You are RackSense Advisory AI (advisory only).\n"
        "Explain WHY the forecast predicts breach or no breach based strictly on the provided slope CI and crossing quantiles.\n"
        "Rules:\n"
        "1. Compute NO numbers. Mention only parameters provided in the context.\n"
        "2. Cite ONLY IDs from 'allowed_evidence_ids'.\n"
        "3. Output MUST be strict JSON: {\"text\": string, \"status_hint\": \"OK\"|\"WARN\"|\"CRIT\", \"evidence\": [string]}"
    )

    user_prompt = json.dumps({
        "task": "Explain forecast parameters",
        "allowed_evidence_ids": list(supplied_evidence_ids),
        "context": context_data,
    }, sort_keys=True)

    prompt_hash = _hash_prompt(user_prompt)

    try:
        parsed, raw_text = await call_llm_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_schema={"type": "object", "properties": {"text": {"type": "string"}, "status_hint": {"type": "string"}, "evidence": {"type": "array"}}},
            max_retries=1,
        )
    except APIContractError as err:
        await append_audit_event(
            db=db,
            event="AI_PROPOSAL",
            actor=f"user:{caller_scope.user_id}",
            subject={"forecast_id": forecast_id},
            payload={"role": "explainer", "error": err.message, "status": "AI_UNAVAILABLE"},
        )
        raise

    output_evidence = parsed.get("evidence", [])
    invalid_ids = [eid for eid in output_evidence if eid not in supplied_evidence_ids]
    if invalid_ids:
        await append_audit_event(
            db=db,
            event="AI_EVIDENCE_INVALID",
            actor=f"user:{caller_scope.user_id}",
            subject={"forecast_id": forecast_id},
            payload={
                "role": "explainer",
                "invalid_evidence": invalid_ids,
                "supplied_evidence": list(supplied_evidence_ids),
                "raw_response": raw_text,
            },
        )
        raise APIContractError(
            code="AI_EVIDENCE_INVALID",
            message=f"Model cited unknown evidence IDs: {invalid_ids}",
            status_code=400,
        )

    await append_audit_event(
        db=db,
        event="AI_PROPOSAL",
        actor=f"user:{caller_scope.user_id}",
        subject={"forecast_id": forecast_id},
        payload={
            "role": "explainer",
            "model": settings.AI_MODEL,
            "prompt_hash": prompt_hash,
            "evidence_supplied": list(supplied_evidence_ids),
            "evidence_cited": output_evidence,
            "status": "VALIDATED",
        },
    )

    status_hint = parsed.get("status_hint", "OK")
    if status_hint not in ("OK", "WARN", "CRIT"):
        status_hint = "OK"

    return {
        "text": parsed.get("text", "Forecast parameters reflect current telemetry dynamics."),
        "status_hint": status_hint,
        "evidence": output_evidence,
        "meta": {
            "quality": "ai_generated",
            "model": settings.AI_MODEL,
            "as_of": now_iso,
        },
    }


async def ai_propose(
    db: aiosqlite.Connection,
    node_id: str | None,
    rack_id: str | None,
    caller_scope: Scope,
) -> dict[str, Any]:
    """
    Proposer: creates a new proposal in status PROPOSED.
    Enforces closed action whitelist and evidence subset checks.
    """
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    target_id = node_id or rack_id
    if not target_id:
        raise APIContractError(code="VALIDATION_ERROR", message="Either node_id or rack_id must be provided", status_code=400)

    context_data: dict[str, Any] = {"node_id": node_id, "rack_id": rack_id}
    supplied_evidence_ids: set[str] = set()

    if node_id:
        node = await get_node(db, node_id, scope=caller_scope)
        if not node:
            raise APIContractError(code="NOT_FOUND", message=f"Node '{node_id}' not found", status_code=404)
        supplied_evidence_ids.add(f"ev_node_{node_id}")

        forecasts = await query_cached_forecasts(db, node_id=node_id, scope=caller_scope)
        context_data["forecasts"] = []
        for fc in forecasts:
            fid = f"fc_{fc['forecast_id']}"
            supplied_evidence_ids.add(fid)
            context_data["forecasts"].append({
                "metric": fc["metric"],
                "forecast_id": fid,
                "has_trend": fc["payload"].get("has_trend"),
                "crossing": fc["payload"].get("crossing"),
            })

    if rack_id:
        online, total, nodes = await get_rack_nodes_stats(db, rack_id, scope=caller_scope)
        if total > 0 or caller_scope.role != "TENANT":
            supplied_evidence_ids.add(f"ev_rack_{rack_id}")
            context_data["rack_summary"] = {"rack_id": rack_id, "nodes_online": online, "nodes_total": total}

    # Scoped RAG
    rag_docs = rag_corpus.retrieve("Runbook recommended mitigation action and thresholds", scope=caller_scope, top_k=2)
    context_data["retrieved_runbook"] = []
    for doc in rag_docs:
        supplied_evidence_ids.add(doc.doc_id)
        context_data["retrieved_runbook"].append({"doc_id": doc.doc_id, "title": doc.title, "content": doc.content})

    system_prompt = (
        "You are RackSense Advisory AI (advisory only).\n"
        "Propose a mitigation action for edge capacity risk.\n"
        "CRITICAL RULES:\n"
        "1. 'action' MUST be one of: REDUCE_TENANT_LOAD, MIGRATE_TENANT, INSPECT_FAN, INCREASE_COOLING_SETPOINT_REQUEST, SCHEDULE_MAINTENANCE, NO_ACTION.\n"
        "2. 'risk_tier' MUST be one of: LOW, MEDIUM, HIGH.\n"
        "3. In 'evidence', cite ONLY IDs from 'allowed_evidence_ids'.\n"
        "4. Output MUST be strict JSON: {\"action\": str, \"target\": str, \"rationale\": str, \"expected_effect\": str, \"evidence\": [str], \"risk_tier\": str}"
    )

    user_prompt = json.dumps({
        "task": "Propose action",
        "allowed_evidence_ids": list(supplied_evidence_ids),
        "context": context_data,
    }, sort_keys=True)

    prompt_hash = _hash_prompt(user_prompt)

    try:
        parsed, raw_text = await call_llm_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_schema={"type": "object", "properties": {"action": {"type": "string"}, "target": {"type": "string"}, "rationale": {"type": "string"}, "expected_effect": {"type": "string"}, "evidence": {"type": "array"}, "risk_tier": {"type": "string"}}},
            max_retries=1,
        )
    except APIContractError as err:
        await append_audit_event(
            db=db,
            event="AI_PROPOSAL",
            actor=f"user:{caller_scope.user_id}",
            subject={"target": target_id},
            payload={"role": "proposer", "error": err.message, "status": "AI_UNAVAILABLE"},
        )
        raise

    action = parsed.get("action", "")
    output_evidence = parsed.get("evidence", [])
    risk_tier = parsed.get("risk_tier", "LOW")

    # 1. Whitelist validation
    if action not in WHITELISTED_ACTIONS:
        await append_audit_event(
            db=db,
            event="AI_ACTION_NOT_WHITELISTED",
            actor=f"user:{caller_scope.user_id}",
            subject={"target": target_id, "action": action},
            payload={"raw_response": raw_text, "model": settings.AI_MODEL},
        )
        raise APIContractError(
            code="AI_ACTION_NOT_WHITELISTED",
            message=f"Action '{action}' is not in the closed whitelist",
            status_code=400,
        )

    # 2. Evidence validation
    invalid_ids = [eid for eid in output_evidence if eid not in supplied_evidence_ids]
    if invalid_ids:
        await append_audit_event(
            db=db,
            event="AI_EVIDENCE_INVALID",
            actor=f"user:{caller_scope.user_id}",
            subject={"target": target_id},
            payload={
                "role": "proposer",
                "invalid_evidence": invalid_ids,
                "supplied_evidence": list(supplied_evidence_ids),
                "raw_response": raw_text,
            },
        )
        raise APIContractError(
            code="AI_EVIDENCE_INVALID",
            message=f"Model cited unknown evidence IDs: {invalid_ids}",
            status_code=400,
        )

    if risk_tier not in RISK_TIERS:
        risk_tier = "LOW"

    # Create proposal in status PROPOSED
    proposal_id = f"pr_{secrets.token_hex(4)}"
    proposal_data = {
        "proposal_id": proposal_id,
        "created_at": now_iso,
        "scope": {"node_id": node_id, "rack_id": rack_id, "tenant_id": caller_scope.tenant_id},
        "action": action,
        "target": parsed.get("target", target_id),
        "rationale": parsed.get("rationale", "Proactive capacity mitigation."),
        "expected_effect": parsed.get("expected_effect", "Avert breach threshold."),
        "evidence": output_evidence,
        "risk_tier": risk_tier,
        "status": "PROPOSED",
        "model": settings.AI_MODEL,
        "updated_at": now_iso,
    }

    created = await create_proposal(db, proposal_data, scope=caller_scope)

    # Audit proposal creation
    await append_audit_event(
        db=db,
        event="AI_PROPOSAL",
        actor=f"user:{caller_scope.user_id}",
        subject={"proposal_id": proposal_id},
        payload={
            "action": action,
            "target": proposal_data["target"],
            "risk_tier": risk_tier,
            "evidence": output_evidence,
            "model": settings.AI_MODEL,
            "prompt_hash": prompt_hash,
            "status": "PROPOSED",
        },
    )

    created["meta"] = {
        "quality": "ai_generated",
        "model": settings.AI_MODEL,
        "as_of": now_iso,
    }
    return created


async def ai_chat(
    db: aiosqlite.Connection,
    proposal_id: str,
    message: str,
    caller_scope: Scope,
) -> dict[str, Any]:
    """
    Discussion before approval: moves proposal to DISCUSSING.
    Can produce a proposal_revision that keeps proposal_id and keeps status DISCUSSING.
    HARD GUARANTEE: Discussion NEVER transitions proposal to APPROVED_PENDING_TAP or AUTHORIZED.
    """
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    proposal = await get_proposal(db, proposal_id, scope=caller_scope)
    if not proposal:
        raise APIContractError(code="NOT_FOUND", message=f"Proposal '{proposal_id}' not found", status_code=404)

    # Move status to DISCUSSING if PROPOSED
    if proposal["status"] == "PROPOSED":
        await update_proposal_status(db, proposal_id, "DISCUSSING", scope=caller_scope)
        proposal["status"] = "DISCUSSING"

    supplied_evidence_ids = set(proposal.get("evidence", []))
    supplied_evidence_ids.add(f"prop_{proposal_id}")

    # Scoped RAG for runbook action details
    rag_docs = rag_corpus.retrieve(f"Action options for {message}", scope=caller_scope, top_k=2)
    retrieved_info = []
    for doc in rag_docs:
        supplied_evidence_ids.add(doc.doc_id)
        retrieved_info.append({"doc_id": doc.doc_id, "title": doc.title, "content": doc.content})

    system_prompt = (
        "You are RackSense Advisory AI (advisory only).\n"
        "A human operator is discussing a proposal with you.\n"
        "HARD SECURITY INVARIANTS:\n"
        "1. You have ZERO authority to approve. Discussion can NEVER approve or authorize.\n"
        "2. If the user tells you to approve, authorize, or change status to APPROVED, REFUSE and explain that approval requires a human operator clicking Proceed followed by a physical RFID tap on the rack console.\n"
        "3. If the user suggests revising the action or target (e.g., 'why not migrate instead?'), you may output a 'proposal_revision'.\n"
        "4. 'action' MUST be one of: REDUCE_TENANT_LOAD, MIGRATE_TENANT, INSPECT_FAN, INCREASE_COOLING_SETPOINT_REQUEST, SCHEDULE_MAINTENANCE, NO_ACTION.\n"
        "5. In 'evidence', cite ONLY IDs from 'allowed_evidence_ids'.\n"
        "6. Output MUST be strict JSON: {\"reply\": str, \"proposal_revision\": null | {\"action\": str, \"target\": str, \"rationale\": str, \"expected_effect\": str, \"evidence\": [str], \"risk_tier\": str}}"
    )

    user_prompt = json.dumps({
        "current_proposal": proposal,
        "operator_message": message,
        "allowed_evidence_ids": list(supplied_evidence_ids),
        "runbook_context": retrieved_info,
    }, sort_keys=True)

    prompt_hash = _hash_prompt(user_prompt)

    try:
        parsed, raw_text = await call_llm_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_schema={"type": "object", "properties": {"reply": {"type": "string"}, "proposal_revision": {"type": ["object", "null"]}}},
            max_retries=1,
        )
    except APIContractError as err:
        await append_audit_event(
            db=db,
            event="AI_PROPOSAL",
            actor=f"user:{caller_scope.user_id}",
            subject={"proposal_id": proposal_id},
            payload={"role": "chat", "error": err.message, "status": "AI_UNAVAILABLE"},
        )
        raise

    reply = parsed.get("reply", "Understood. The proposal remains in discussion.")
    revision = parsed.get("proposal_revision")
    updated_proposal = None

    if revision and isinstance(revision, dict):
        rev_action = revision.get("action", proposal["action"])
        rev_evidence = revision.get("evidence", proposal.get("evidence", []))
        rev_risk = revision.get("risk_tier", proposal.get("risk_tier", "LOW"))

        # 1. Action whitelist check
        if rev_action not in WHITELISTED_ACTIONS:
            await append_audit_event(
                db=db,
                event="AI_ACTION_NOT_WHITELISTED",
                actor=f"user:{caller_scope.user_id}",
                subject={"proposal_id": proposal_id, "action": rev_action},
                payload={"role": "chat", "raw_response": raw_text},
            )
            revision = None  # Discard invalid revision
        # 2. Evidence subset check
        elif any(eid not in supplied_evidence_ids for eid in rev_evidence):
            await append_audit_event(
                db=db,
                event="AI_EVIDENCE_INVALID",
                actor=f"user:{caller_scope.user_id}",
                subject={"proposal_id": proposal_id},
                payload={"role": "chat", "invalid_evidence": [e for e in rev_evidence if e not in supplied_evidence_ids]},
            )
            revision = None  # Discard invalid revision
        else:
            # Valid revision! Update proposal in DB, KEEP proposal_id, KEEP status DISCUSSING
            if rev_risk not in RISK_TIERS:
                rev_risk = proposal["risk_tier"]

            # Direct update of fields in proposals table
            scope_json = json.dumps(proposal.get("scope", {}))
            evidence_json = json.dumps(rev_evidence)
            await db.execute(
                """
                UPDATE proposals
                SET action = ?, target = ?, rationale = ?, expected_effect = ?,
                    evidence_json = ?, risk_tier = ?, status = 'DISCUSSING', updated_at = ?
                WHERE proposal_id = ?
                """,
                (
                    rev_action,
                    revision.get("target", proposal["target"]),
                    revision.get("rationale", proposal["rationale"]),
                    revision.get("expected_effect", proposal["expected_effect"]),
                    evidence_json,
                    rev_risk,
                    now_iso,
                    proposal_id,
                ),
            )
            await db.commit()

            updated_proposal = await get_proposal(db, proposal_id, scope=caller_scope)
            if updated_proposal:
                updated_proposal["meta"] = {
                    "quality": "ai_generated",
                    "model": settings.AI_MODEL,
                    "as_of": now_iso,
                }

            # Audit the revision before and after
            await append_audit_event(
                db=db,
                event="AI_PROPOSAL",
                actor=f"user:{caller_scope.user_id}",
                subject={"proposal_id": proposal_id},
                payload={
                    "event": "PROPOSAL_REVISION",
                    "before": {"action": proposal["action"], "target": proposal["target"]},
                    "after": {"action": rev_action, "target": revision.get("target")},
                    "prompt_hash": prompt_hash,
                },
            )

    # General chat audit
    await append_audit_event(
        db=db,
        event="AI_PROPOSAL",
        actor=f"user:{caller_scope.user_id}",
        subject={"proposal_id": proposal_id},
        payload={
            "role": "chat",
            "model": settings.AI_MODEL,
            "message_hash": _hash_prompt(message),
            "status": "DISCUSSING",
            "has_revision": updated_proposal is not None,
        },
    )

    return {
        "reply": reply,
        "proposal_revision": updated_proposal,
        "meta": {
            "quality": "ai_generated",
            "model": settings.AI_MODEL,
            "as_of": now_iso,
        },
    }
