import json
import pytest
from starlette.testclient import TestClient

from backend.core.auth import create_access_token
from backend.main import app
from backend.services.ai.client import set_mock_llm_handler

client = TestClient(app)


def test_rfid_login_success():
    """Verify physical RFID badge authentication generates valid JWT with operator role."""
    resp = client.post("/api/auth/rfid-login", json={"card_uid": "04A1B2C3D4"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["role"] == "OPERATOR"
    assert data["display_name"] == "Shift Operator"


def test_rfid_login_invalid():
    """Verify unregistered RFID card is rejected with 401."""
    resp = client.post("/api/auth/rfid-login", json={"card_uid": "FF:FF:FF:FF:FF"})
    assert resp.status_code == 401
    data = resp.json()
    assert data["error"]["code"] == "UNAUTHENTICATED"


def test_login_with_demo_aliases():
    """Verify judges demo aliases work for fast 1-click evaluation."""
    for user_alias, expected_role in [
        ("operator", "OPERATOR"),
        ("superuser", "SUPER_USER"),
        ("tenant", "TENANT"),
    ]:
        resp = client.post("/api/auth/login", json={"username": user_alias, "password": "password123"})
        assert resp.status_code == 200
        assert resp.json()["role"] == expected_role


def test_simulations_list():
    """Verify simulation scenarios catalog returns all 5 realistic scenarios."""
    token = create_access_token({"sub": "u-op1", "role": "OPERATOR", "tenant_id": None})
    resp = client.get("/api/simulations", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    scenarios = resp.json()
    assert len(scenarios) == 5
    ids = [s["id"] for s in scenarios]
    assert "thermal_breach" in ids
    assert "fan_vibration" in ids
    assert "air_stagnation" in ids
    assert "compute_surge" in ids
    assert "nominal_recovery" in ids


def test_simulation_run_thermal_breach():
    """Verify running a simulation injects telemetry, creates audit event, and returns AI proposal."""
    def mock_handler(system_prompt: str, user_prompt: str, *args, **kwargs):
        return {
            "action": "MIGRATE_TENANT",
            "target": "r1-n1",
            "rationale": "Thermal breach observed: inlet temperature 28.2 C breaches ASHRAE limit.",
            "expected_effect": "Lowers rack thermal load by 40% within 10 minutes.",
            "evidence": ["ev_node_r1-n1"],
            "risk_tier": "MEDIUM",
        }

    set_mock_llm_handler(mock_handler)
    try:
        token = create_access_token({"sub": "u-op1", "role": "OPERATOR", "tenant_id": None})
        resp = client.post(
            "/api/simulations/run",
            json={"scenario_id": "thermal_breach"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "COMPLETED"
        assert data["points_injected"] > 0
        assert "proposal" in data
        assert data["proposal"] is not None
        assert "alternative_options" in data["proposal"]
        assert len(data["proposal"]["alternative_options"]) >= 2
    finally:
        set_mock_llm_handler(None)


def test_ai_chat_advisory_discussion():
    """Verify pre-approval chat handles questions and generates responses."""
    def mock_handler(system_prompt: str, user_prompt: str, *args, **kwargs):
        if "Propose action" in user_prompt:
            return {
                "action": "REDUCE_TENANT_LOAD",
                "target": "r1-n1",
                "rationale": "Mitigate thermal drift via compute power reduction.",
                "expected_effect": "Restores safe headroom.",
                "evidence": ["ev_node_r1-n1"],
                "risk_tier": "MEDIUM",
            }
        return {
            "reply": "Workload migration to Rack 01 Bay U18 is recommended to preserve safety margins.",
            "proposal_revision": {
                "action": "MIGRATE_TENANT",
                "target": "r1-n1",
                "rationale": "Migrating tenant instances preserves thermal safety margins.",
                "expected_effect": "Temperature drops below 26.0 C within 15 minutes.",
                "evidence": ["ev_node_r1-n1"],
                "risk_tier": "MEDIUM",
            },
        }

    set_mock_llm_handler(mock_handler)
    try:
        token = create_access_token({"sub": "u-op1", "role": "OPERATOR", "tenant_id": None})
        resp = client.post(
            "/api/ai/chat",
            json={
                "node_id": "r1-n1",
                "message": "Why not migrate tenant workload instead of reducing power?",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "reply" in data
        assert isinstance(data["reply"], str)
        assert "proposal_revision" in data
    finally:
        set_mock_llm_handler(None)
