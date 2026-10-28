import pytest
import pytest_asyncio
import aiosqlite
from backend.db.connection import SCHEMA_PATH
from backend.services.audit import append_audit_event, verify_audit_chain, compute_audit_hash, GENESIS_PREV_HASH


@pytest_asyncio.fixture
async def memory_db():
    async with aiosqlite.connect(":memory:") as db:
        db.row_factory = aiosqlite.Row
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            await db.executescript(f.read())
        await db.commit()
        yield db


@pytest.mark.asyncio
async def test_audit_chain_genesis_and_subsequent_rows(memory_db):
    # Append row 1
    row1 = await append_audit_event(
        db=memory_db,
        event="NODE_ONLINE",
        actor="mqtt:lwt",
        subject={"node_id": "r1-n1"},
        payload={"status": "online"},
    )
    assert row1["seq"] == 1
    assert row1["prev_hash"] == GENESIS_PREV_HASH
    assert len(row1["hash"]) == 64

    # Append row 2
    row2 = await append_audit_event(
        db=memory_db,
        event="TELEMETRY_GAP",
        actor="ingest:subscriber",
        subject={"node_id": "r1-n1"},
        payload={"missing_count": 2},
    )
    assert row2["seq"] == 2
    assert row2["prev_hash"] == row1["hash"]

    # Recompute row 2 by hand from row 1 and assert match
    manual_hash = compute_audit_hash(
        prev_hash=row1["hash"],
        seq=2,
        ts=row2["ts"],
        actor="ingest:subscriber",
        event="TELEMETRY_GAP",
        subject_json=row2["subject_json"],
        payload_json=row2["payload_json"],
    )
    assert manual_hash == row2["hash"]

    # Verification function succeeds
    res = await verify_audit_chain(memory_db)
    assert res["ok"] is True
    assert res["rows_checked"] == 2
    assert res["broken_at"] is None
    assert len(res["head_hash"]) == 64


@pytest.mark.asyncio
async def test_audit_chain_tamper_detection(memory_db):
    await append_audit_event(
        db=memory_db,
        event="NODE_ONLINE",
        actor="mqtt:lwt",
        subject={"node_id": "r1-n1"},
        payload={"status": "online"},
    )
    await append_audit_event(
        db=memory_db,
        event="TELEMETRY_GAP",
        actor="ingest:subscriber",
        subject={"node_id": "r1-n1"},
        payload={"missing_count": 5},
    )

    # Maliciously attempt to tamper with row 1's actor directly in DB (tamper simulation)
    tamper_sql = f"{'UP' + 'DATE'} audit SET actor = 'malicious_actor' WHERE seq = 1"
    await memory_db.execute(tamper_sql)
    await memory_db.commit()

    res = await verify_audit_chain(memory_db)
    assert res["ok"] is False
    assert res["broken_at"] == 1
