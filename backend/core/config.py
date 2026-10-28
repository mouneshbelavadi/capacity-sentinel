from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    CONTRACT_VERSION: str = "1.0.0"
    SITE_ID: str = "site-01"
    DB_PATH: str = str(Path(__file__).parent.parent / "data" / "racksense.db")
    
    # MQTT Configuration
    MQTT_BROKER_HOST: str = "127.0.0.1"
    MQTT_BROKER_PORT: int = 1883
    MQTT_USERNAME: str | None = None
    MQTT_PASSWORD: str | None = None
    MQTT_KEEPALIVE: int = 60
    
    # Logging
    LOG_LEVEL: str = "INFO"

    # JWT Authentication
    JWT_SECRET_KEY: str = "racksense-edge-jwt-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 8

    # AI Configuration
    GEMINI_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    AI_PROVIDER: str = "gemini"  # "gemini" | "openai"
    AI_MODEL: str = "gemini-2.5-flash"
    RUNBOOK_PATH: str = str(Path(__file__).parent.parent.parent / "shared" / "runbook.md")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
