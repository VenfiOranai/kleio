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


@lru_cache
def get_settings() -> Settings:
    return Settings()
