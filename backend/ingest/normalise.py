from datetime import datetime, timezone
from typing import Any
from backend.ingest.validate import RawTelemetryPayload

METRIC_FIELDS = [
    "t_c",
    "rh",
    "dew_c",
    "mq_ratio",
    "vib_rms_g",
    "vib_peak_g",
    "vib_crest",
    "shock_count",
]


def parse_device_ts(ts_val: int | float | str) -> tuple[datetime, str]:
    """Parse device ts into a datetime object (UTC) and ISO-8601 formatted string."""
    if isinstance(ts_val, (int, float)):
        # Device published epoch seconds
        dt = datetime.fromtimestamp(ts_val, tz=timezone.utc)
    elif isinstance(ts_val, str):
        # Could be numeric string or ISO format
        try:
            val_num = float(ts_val)
            dt = datetime.fromtimestamp(val_num, tz=timezone.utc)
        except ValueError:
            # ISO format
            dt = datetime.fromisoformat(ts_val.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    
    iso_str = dt.isoformat().replace("+00:00", "Z")
    return dt, iso_str


def normalise_payload(
    payload: RawTelemetryPayload,
    received_dt: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Fans out a single raw telemetry payload into individual metric rows:
    (node_id, metric, ts, received_at, value, quality, seq, backfilled)

    Rules:
    - quality is 'measured' for all raw physical sensor readings.
    - If mq_warm is False, do NOT store mq_ratio at all (sensor cannot justify the value).
    - Rows arriving >10s after their device timestamp are marked backfilled = 1.
    """
    if received_dt is None:
        received_dt = datetime.now(timezone.utc)
    
    received_at_iso = received_dt.isoformat().replace("+00:00", "Z")
    dev_dt, dev_ts_iso = parse_device_ts(payload.ts)

    # Check for backfill: arriving > 10 s after device ts
    delay_s = (received_dt - dev_dt).total_seconds()
    backfilled = 1 if delay_s > 10.0 else 0

    rows: list[dict[str, Any]] = []

    for metric in METRIC_FIELDS:
        val = getattr(payload, metric, None)
        if val is None:
            continue

        # Hard rule: mq_warm: false -> do NOT store mq_ratio
        if metric == "mq_ratio" and payload.mq_warm is False:
            continue

        rows.append({
            "node_id": payload.node,
            "metric": metric,
            "ts": dev_ts_iso,
            "received_at": received_at_iso,
            "value": float(val),
            "quality": "measured",
            "seq": payload.seq,
            "backfilled": backfilled,
        })

    return rows
