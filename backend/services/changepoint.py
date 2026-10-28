import json
import uuid
from datetime import datetime, timezone
from typing import Any
import numpy as np
import ruptures as rpt
from backend.core.logging import logger


def run_cusum(
    values: np.ndarray,
    k_mult: float = 0.5,
    h_mult: float = 5.0,
) -> list[int]:
    """
    Two-sided CUSUM detector on series values or residuals.
    Returns list of indices where CUSUM exceeded the decision threshold h*sigma.
    """
    if len(values) < 15:
        return []

    # Use first 15 samples as baseline or overall
    baseline_slice = values[:min(30, len(values))]
    mean_val = float(np.mean(baseline_slice))
    std_val = float(np.std(baseline_slice))
    if std_val < 1e-4:
        std_val = 1e-4

    k = k_mult * std_val
    h = h_mult * std_val

    s_pos = 0.0
    s_neg = 0.0
    triggers = []

    for i in range(len(values)):
        diff = values[i] - mean_val
        s_pos = max(0.0, s_pos + diff - k)
        s_neg = max(0.0, s_neg - diff - k)

        if s_pos > h or s_neg > h:
            triggers.append(i)
            # Reset after trigger
            s_pos = 0.0
            s_neg = 0.0

    return triggers


def run_pelt(
    values: np.ndarray,
    min_size: int = 20,
    jump: int = 5,
) -> list[int]:
    """
    Ruptures PELT L2 change-point detector.
    Returns list of candidate break indices (excluding the end index).
    """
    if len(values) < (min_size * 2):
        return []

    try:
        var_est = float(np.var(values))
        if var_est < 1e-4:
            return []

        algo = rpt.Pelt(model="l2", min_size=min_size, jump=jump).fit(values)
        pen = np.log(len(values)) * var_est * 2.0
        breaks = algo.predict(pen=pen)
        # Exclude the final point (which ruptures returns as the series length)
        return [b for b in breaks if b < len(values)]
    except Exception as e:
        logger.warning(f"PELT execution error: {e}")
        return []


def detect_agreed_changepoint(
    node_id: str,
    metric: str,
    points: list[dict[str, Any]],
    topology_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """
    Dual-detector verification: CUSUM trigger + PELT confirmation.
    A change-point is ONLY confirmed if both detectors locate a break within +/-60s.
    """
    if len(points) < 40:
        return None

    y = np.array([float(p["value"]) for p in points])
    timestamps = [p["ts"] for p in points]

    cusum_triggers = run_cusum(y)
    if not cusum_triggers:
        return None  # No CUSUM trigger

    pelt_breaks = run_pelt(y, min_size=20, jump=5)
    if not pelt_breaks:
        return None  # PELT did not confirm

    # Check for agreement: break within +/- 6 samples (6 * 10s = 60s)
    agreed_break_idx: int | None = None
    for p_idx in pelt_breaks:
        for c_idx in cusum_triggers:
            if abs(p_idx - c_idx) <= 6:
                agreed_break_idx = p_idx
                break
        if agreed_break_idx is not None:
            break

    if agreed_break_idx is None:
        # Detectors disagreed: suppress false alarm!
        return None

    # Compute shifts
    before_slice = y[max(0, agreed_break_idx - 30):agreed_break_idx]
    after_slice = y[agreed_break_idx:min(len(y), agreed_break_idx + 30)]

    if len(before_slice) == 0 or len(after_slice) == 0:
        return None

    before_mean = float(np.mean(before_slice))
    after_mean = float(np.mean(after_slice))
    delta = round(after_mean - before_mean, 3)

    located_ts = timestamps[agreed_break_idx]
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    # Correlate with topology event if occurred within +/- 60s
    matched_topology_event = None
    if topology_events:
        break_dt = datetime.fromisoformat(located_ts.replace("Z", "+00:00"))
        for te in topology_events:
            te_ts = te.get("ts")
            if te_ts:
                try:
                    te_dt = datetime.fromisoformat(te_ts.replace("Z", "+00:00"))
                    if abs((break_dt - te_dt).total_seconds()) <= 60:
                        matched_topology_event = te.get("event_data")
                        break
                except Exception:
                    pass

    cp_id = f"cp_{uuid.uuid4().hex[:8]}"

    return {
        "cp_id": cp_id,
        "node_id": node_id,
        "metric": metric,
        "detected_at": now_iso,
        "located_at": located_ts,
        "detector": "cusum+pelt",
        "confirmed": True,
        "shift": {
            "before_mean": round(before_mean, 2),
            "after_mean": round(after_mean, 2),
            "delta": delta,
        },
        "topology_event": matched_topology_event,
        "topology_event_json": json.dumps(matched_topology_event) if matched_topology_event else None,
        "meta": {
            "quality": "measured",
            "source": "analysis:cusum+pelt",
            "model": "cusum+pelt",
            "uncertainty_pct": None,
            "as_of": now_iso,
        },
    }

