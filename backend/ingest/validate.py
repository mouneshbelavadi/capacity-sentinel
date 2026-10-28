import json
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from backend.core.logging import logger


class RawTelemetryPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    node: str = Field(..., min_length=1)
    seq: int = Field(..., ge=0)
    ts: int | float | str
    fw: str = Field(..., min_length=1)

    tenant: str | None = None
    t_c: float | None = None
    rh: float | None = None
    dew_c: float | None = None
    mq_ratio: float | None = None
    mq_warm: bool | None = None
    vib_rms_g: float | None = None
    vib_peak_g: float | None = None
    vib_crest: float | None = None
    shock_count: int | None = None
    rssi: int | None = None
    uptime_s: int | float | None = None

    @field_validator("t_c")
    @classmethod
    def check_temp(cls, v: float | None) -> float | None:
        if v is not None and not (-40.0 <= v <= 85.0):
            raise ValueError(f"Temperature {v} outside physical range [-40, 85] C")
        return v

    @field_validator("rh")
    @classmethod
    def check_rh(cls, v: float | None) -> float | None:
        if v is not None and not (0.0 <= v <= 100.0):
            raise ValueError(f"Relative humidity {v} outside physical range [0, 100] %")
        return v

    @field_validator("dew_c")
    @classmethod
    def check_dew(cls, v: float | None) -> float | None:
        if v is not None and not (-40.0 <= v <= 85.0):
            raise ValueError(f"Dew point {v} outside physical range [-40, 85] C")
        return v

    @field_validator("mq_ratio")
    @classmethod
    def check_mq_ratio(cls, v: float | None) -> float | None:
        if v is not None and v <= 0.0:
            raise ValueError(f"MQ ratio {v} must be strictly positive")
        return v

    @field_validator("vib_rms_g")
    @classmethod
    def check_vib_rms(cls, v: float | None) -> float | None:
        if v is not None and v < 0.0:
            raise ValueError(f"Vibration RMS {v} must be non-negative")
        return v

    @field_validator("vib_peak_g")
    @classmethod
    def check_vib_peak(cls, v: float | None) -> float | None:
        if v is not None and v < 0.0:
            raise ValueError(f"Vibration peak {v} must be non-negative")
        return v

    @field_validator("vib_crest")
    @classmethod
    def check_vib_crest(cls, v: float | None) -> float | None:
        if v is not None and v < 0.0:
            raise ValueError(f"Vibration crest {v} must be non-negative")
        return v

    @field_validator("shock_count")
    @classmethod
    def check_shock_count(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError(f"Shock count {v} must be non-negative")
        return v

    @field_validator("rssi")
    @classmethod
    def check_rssi(cls, v: int | None) -> int | None:
        if v is not None and not (-120 <= v <= 0):
            raise ValueError(f"RSSI {v} outside expected range [-120, 0] dBm")
        return v

    @field_validator("uptime_s")
    @classmethod
    def check_uptime(cls, v: int | float | None) -> int | float | None:
        if v is not None and v < 0:
            raise ValueError(f"Uptime {v} must be non-negative")
        return v


def validate_telemetry_message(raw_bytes: bytes | str) -> RawTelemetryPayload | None:
    """
    Validates an incoming telemetry message against Contract §15.
    Logs and drops malformed messages. Never partially stores invalid payloads.
    """
    try:
        if isinstance(raw_bytes, bytes):
            text = raw_bytes.decode("utf-8")
        else:
            text = raw_bytes
        data = json.loads(text)
        if not isinstance(data, dict):
            logger.warning("Dropped non-dict telemetry payload", extra={"extra_data": {"raw": str(text)[:100]}})
            return None
        payload = RawTelemetryPayload.model_validate(data)
        return payload
    except Exception as exc:
        logger.warning(
            f"Validation failure for telemetry message: {exc}",
            extra={"extra_data": {"error": str(exc), "raw": str(raw_bytes)[:120]}},
        )
        return None
