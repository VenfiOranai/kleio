from fastapi import FastAPI

from app.core.config import get_settings
from app.utils.router_registry import register_routers


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    register_routers(app)
    return app


app = create_app()
