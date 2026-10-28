from datetime import datetime, timezone, timedelta
from typing import Any
import numpy as np


def generate_flat_series(
    base_val: float = 24.0,
    noise_std: float = 0.05,
    n_points: int = 60,
    step_s: int = 10,
) -> list[dict[str, Any]]:
    """Synthetic flat series with no sustained trend."""
    start_dt = datetime.now(timezone.utc) - timedelta(seconds=n_points * step_s)
    rng = np.random.default_rng(42)
    noise = rng.normal(0, noise_std, n_points)

    points = []
    for i in range(n_points):
        dt = start_dt + timedelta(seconds=i * step_s)
        val = round(float(base_val + noise[i]), 2)
        points.append({"ts": dt.isoformat().replace("+00:00", "Z"), "value": val})
    return points


def generate_clean_ramp(
    start_val: float = 24.0,
    slope_per_s: float = 0.01,
    n_points: int = 60,
    step_s: int = 10,
) -> list[dict[str, Any]]:
    """Synthetic clean ramp with steady linear increase."""
    start_dt = datetime.now(timezone.utc) - timedelta(seconds=n_points * step_s)
    points = []
    for i in range(n_points):
        dt = start_dt + timedelta(seconds=i * step_s)
        val = round(float(start_val + (i * step_s) * slope_per_s), 2)
        points.append({"ts": dt.isoformat().replace("+00:00", "Z"), "value": val})
    return points


def generate_noisy_ramp(
    start_val: float = 24.0,
    slope_per_s: float = 0.01,
    noise_std: float = 0.35,
    n_points: int = 60,
    step_s: int = 10,
) -> list[dict[str, Any]]:
    """Synthetic noisy ramp."""
    start_dt = datetime.now(timezone.utc) - timedelta(seconds=n_points * step_s)
    rng = np.random.default_rng(42)
    noise = rng.normal(0, noise_std, n_points)

    points = []
    for i in range(n_points):
        dt = start_dt + timedelta(seconds=i * step_s)
        val = round(float(start_val + (i * step_s) * slope_per_s + noise[i]), 2)
        points.append({"ts": dt.isoformat().replace("+00:00", "Z"), "value": val})
    return points


def generate_step_change(
    before_val: float = 24.0,
    after_val: float = 26.5,
    step_idx: int = 40,
    n_points: int = 80,
    step_s: int = 10,
) -> list[dict[str, Any]]:
    """Synthetic step change (regime shift) for change point detection."""
    start_dt = datetime.now(timezone.utc) - timedelta(seconds=n_points * step_s)
    rng = np.random.default_rng(42)

    points = []
    for i in range(n_points):
        dt = start_dt + timedelta(seconds=i * step_s)
        base = before_val if i < step_idx else after_val
        val = round(float(base + rng.normal(0, 0.05)), 2)
        points.append({"ts": dt.isoformat().replace("+00:00", "Z"), "value": val})
    return points

