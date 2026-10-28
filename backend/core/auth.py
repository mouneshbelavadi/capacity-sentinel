from datetime import datetime, timezone, timedelta
from typing import Any
import bcrypt
import jwt
from backend.core.config import settings


def hash_password(password: str) -> str:
    """Hashes a plaintext password using bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Verifies a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(
    payload: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    """Creates a signed JWT access token."""
    to_encode = payload.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(hours=settings.JWT_EXPIRE_HOURS)

    to_encode.update({"iat": now, "exp": expire})
    token = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token


def decode_access_token(token: str) -> dict[str, Any]:
    """Decodes and validates a JWT access token."""
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])

