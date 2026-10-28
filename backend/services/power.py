import os
from datetime import datetime, timezone
from typing import Any
import psutil

P_IDLE_W = 0.4
P_BUSY_W = 1.4
REFERENCE_CITE = "Fan, Weber & Barroso (ISCA 2007); UNO Q idle/load figures from independent bench tests"


def read_cpu_utilization() -> float:
    """
    Reads CPU utilization fraction u in [0, 1].
    Reads from /proc/stat on Linux / Arduino UNO Q, falls back to psutil on other platforms.
    """
    proc_stat_path = "/proc/stat"
    if os.path.exists(proc_stat_path):
        try:
            with open(proc_stat_path, "r", encoding="utf-8") as f:
                line = f.readline()
                parts = line.split()[1:]
                # user, nice, system, idle, iowait, irq, softirq
                times = [float(p) for p in parts]
                idle_time = times[3]
                total_time = sum(times)
                if total_time > 0:
                    u = (total_time - idle_time) / total_time
                    return max(0.0, min(1.0, u))
        except Exception:
            pass

    # Fallback to psutil
    try:
        pct = psutil.cpu_percent(interval=None)
        if pct > 0:
            return round(pct / 100.0, 3)
    except Exception:
        pass

    return 0.45


def estimate_power(node_id: str, u: float | None = None) -> dict[str, Any]:
    """
    Estimates power consumption for an edge compute node using the linear CPU model:
    P = P_idle + (P_busy - P_idle) * u

    HONESTY RULE: Power is ALWAYS 'estimated' here (no current sensor fitted).
    """
    if u is None:
        u = read_cpu_utilization()

    power_w = round(P_IDLE_W + (P_BUSY_W - P_IDLE_W) * u, 2)
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    return {
        "node_id": node_id,
        "value": {
            "value": power_w,
            "unit": "W",
            "meta": {
                "quality": "estimated",
                "source": "model",
                "model": "linear-cpu-v1",
                "uncertainty_pct": 30,
                "as_of": now_iso,
            },
        },
        "model_detail": {
            "formula": "P = P_idle + (P_busy - P_idle) * u",
            "p_idle_w": P_IDLE_W,
            "p_busy_w": P_BUSY_W,
            "u": round(u, 3),
            "calibrated": False,
            "reference": REFERENCE_CITE,
        },
    }

