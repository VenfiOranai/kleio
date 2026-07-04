from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App configuration, read from environment / .env. See repo-root .env.example."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Kleio Oracle"

    # Database
    database_url: str = "postgresql+psycopg://kleio:kleio@localhost:5432/kleio"

    # Single-user auth (used from the auth phase onward)
    app_username: str = "changeme"
    app_password_hash: str = ""
    jwt_secret: str = ""
    jwt_expire_minutes: int = 1440

    # AI (Gemini) — used from the summarization phase onward
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    # Embedding model for RAG Q&A (Phase 5). The output width is fixed in code/migration
    # (see app.services.ai.EMBED_DIM), so change the model here but not the dimension.
    gemini_embed_model: str = "gemini-embedding-001"


@lru_cache
def get_settings() -> Settings:
    return Settings()
