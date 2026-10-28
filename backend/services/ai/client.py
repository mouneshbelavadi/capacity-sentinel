import json
import os
from typing import Any, Callable
import httpx

from backend.api.errors import APIContractError
from backend.core.config import settings
from backend.core.logging import logger

# Type for mock handler in tests: (system_prompt, user_prompt, schema) -> str | dict
MockHandler = Callable[[str, str, dict[str, Any]], str | dict[str, Any]]
_mock_handler: MockHandler | None = None


def set_mock_llm_handler(handler: MockHandler | None) -> None:
    """Used in unit and integration tests to simulate LLM behavior."""
    global _mock_handler
    _mock_handler = handler


async def call_llm_json(
    system_prompt: str,
    user_prompt: str,
    json_schema: dict[str, Any],
    max_retries: int = 1,
) -> tuple[dict[str, Any], str]:
    """
    Calls cloud LLM provider expecting strict JSON structured output.
    Retries once on malformed JSON; raises AI_UNAVAILABLE on connection failure or repeated parse error.
    Returns (parsed_json_dict, raw_response_text).
    """
    global _mock_handler

    # 1. Test mock hook
    if _mock_handler is not None:
        last_err = None
        for attempt in range(max_retries + 1):
            try:
                res = _mock_handler(system_prompt, user_prompt, json_schema)
                if isinstance(res, dict):
                    return res, json.dumps(res)
                raw_text = str(res)
                parsed = json.loads(raw_text)
                return parsed, raw_text
            except Exception as e:
                last_err = e
                logger.warning(f"Mock LLM JSON parse attempt {attempt+1} failed: {e}")
        raise APIContractError(
            code="AI_UNAVAILABLE",
            message=f"LLM response malformed JSON after retry: {last_err}",
            status_code=503,
        )

    # 2. Check provider credentials
    api_key = settings.GEMINI_API_KEY or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    openai_key = settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")

    if not api_key and not openai_key:
        raise APIContractError(
            code="AI_UNAVAILABLE",
            message="No cloud LLM API key configured in .env",
            status_code=503,
        )

    last_err: Exception | None = None

    for attempt in range(max_retries + 1):
        try:
            if api_key:
                # Use Google Gemini API
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.AI_MODEL}:generateContent?key={api_key}"
                payload = {
                    "contents": [
                        {"role": "user", "parts": [{"text": f"{system_prompt}\n\nTask:\n{user_prompt}"}]}
                    ],
                    "generationConfig": {
                        "response_mime_type": "application/json",
                        "temperature": 0.2,
                    },
                }
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(url, json=payload)
                    if resp.status_code != 200:
                        raise RuntimeError(f"Gemini API returned status {resp.status_code}: {resp.text}")
                    data = resp.json()
                    candidates = data.get("candidates", [])
                    if not candidates:
                        raise RuntimeError("No candidate responses returned by Gemini API")
                    raw_text = candidates[0]["content"]["parts"][0]["text"]
                    parsed = json.loads(raw_text)
                    return parsed, raw_text

            elif openai_key:
                # Use OpenAI compatible API
                url = "https://api.openai.com/v1/chat/completions"
                payload = {
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.2,
                }
                headers = {"Authorization": f"Bearer {openai_key}"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(url, headers=headers, json=payload)
                    if resp.status_code != 200:
                        raise RuntimeError(f"OpenAI API returned status {resp.status_code}: {resp.text}")
                    data = resp.json()
                    raw_text = data["choices"][0]["message"]["content"]
                    parsed = json.loads(raw_text)
                    return parsed, raw_text

        except (httpx.RequestError, httpx.TimeoutException) as conn_err:
            logger.error(f"Cloud LLM provider network error: {conn_err}")
            raise APIContractError(
                code="AI_UNAVAILABLE",
                message=f"Cloud LLM provider unreachable: {conn_err}",
                status_code=503,
            )
        except Exception as parse_or_api_err:
            last_err = parse_or_api_err
            logger.warning(f"LLM call attempt {attempt+1} failed: {parse_or_api_err}")

    raise APIContractError(
        code="AI_UNAVAILABLE",
        message=f"LLM generation failed after retry: {last_err}",
        status_code=503,
    )

