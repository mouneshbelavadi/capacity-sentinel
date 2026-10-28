from collections import defaultdict
import time
from fastapi import Request

from backend.api.errors import APIContractError


class SimpleRateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> None:
        now = time.time()
        window_start = now - self.window_seconds
        # Clean older requests
        timestamps = [ts for ts in self.requests[key] if ts > window_start]
        self.requests[key] = timestamps

        if len(timestamps) >= self.max_requests:
            raise APIContractError(
                code="RATE_LIMITED",
                message=f"Rate limit exceeded ({self.max_requests} req / {self.window_seconds}s). Try again later.",
                status_code=429,
            )

        self.requests[key].append(now)


# Global rate limiters
login_limiter = SimpleRateLimiter(max_requests=10, window_seconds=60.0)
tap_limiter = SimpleRateLimiter(max_requests=30, window_seconds=60.0)

