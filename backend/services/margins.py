import math
from typing import Any

ASHRAE_TEMP_LIMIT = 27.0
ASHRAE_TEMP_LIMIT_SOURCE = "ASHRAE TC 9.9 recommended inlet upper bound"

DEW_POINT_UPPER = 15.0
DEW_POINT_LOWER = -9.0
DEW_POINT_LIMIT_SOURCE = "dew-point envelope"

MQ_RATIO_WARN_FACTOR = 1.5
MQ_RATIO_CRIT_FACTOR = 2.0
MQ_RATIO_LIMIT_SOURCE = "clean-air R0 baseline captured on this bench"

VIB_RMS_WARN_FACTOR = 2.0
VIB_RMS_CRIT_FACTOR = 4.0
VIB_RMS_LIMIT_SOURCE = "commissioning baseline captured on this bench"


def compute_dew_point(temp_c: float, rh_pct: float) -> float:
    """
    Computes dew point in Celsius using the Magnus formula.
    Do not approximate.
    """
    if rh_pct <= 0.0:
        return -40.0
    a = 17.27
    b = 237.7
    alpha = (a * temp_c) / (b + temp_c) + math.log(rh_pct / 100.0)
    dew_c = (b * alpha) / (a - alpha)
    return round(dew_c, 2)


def get_metric_limit_info(metric: str, baseline_val: float | None = None) -> tuple[float | None, str]:
    """
    Returns (limit_value, limit_source) for a given metric.
    Relative metrics (mq_ratio, vib_rms_g) require a baseline value.
    """
    if metric == "t_c":
        return ASHRAE_TEMP_LIMIT, ASHRAE_TEMP_LIMIT_SOURCE
    if metric == "dew_c":
        return DEW_POINT_UPPER, DEW_POINT_LIMIT_SOURCE
    if metric == "mq_ratio":
        if baseline_val is None:
            return None, MQ_RATIO_LIMIT_SOURCE
        return round(baseline_val * MQ_RATIO_WARN_FACTOR, 3), MQ_RATIO_LIMIT_SOURCE
    if metric == "vib_rms_g":
        if baseline_val is None:
            return None, VIB_RMS_LIMIT_SOURCE
        return round(baseline_val * VIB_RMS_WARN_FACTOR, 4), VIB_RMS_LIMIT_SOURCE
    return None, "System default"


def assess_metric_status(
    metric: str,
    value: float,
    baseline_val: float | None = None,
) -> str:
    """
    Returns 'OK', 'WARN', or 'CRIT' status for a metric reading.
    """
    if metric == "t_c":
        if value >= ASHRAE_TEMP_LIMIT:
            return "CRIT"
        if value >= 25.0:
            return "WARN"
        return "OK"

    if metric == "dew_c":
        if value >= DEW_POINT_UPPER or value <= DEW_POINT_LOWER:
            return "CRIT"
        if value >= 13.0 or value <= -7.0:
            return "WARN"
        return "OK"

    if metric == "mq_ratio":
        if baseline_val is None or baseline_val <= 0:
            return "UNKNOWN"
        if value >= baseline_val * MQ_RATIO_CRIT_FACTOR:
            return "CRIT"
        if value >= baseline_val * MQ_RATIO_WARN_FACTOR:
            return "WARN"
        return "OK"

    if metric == "vib_rms_g":
        if baseline_val is None or baseline_val <= 0:
            return "UNKNOWN"
        if value >= baseline_val * VIB_RMS_CRIT_FACTOR:
            return "CRIT"
        if value >= baseline_val * VIB_RMS_WARN_FACTOR:
            return "WARN"
        return "OK"

    return "OK"

