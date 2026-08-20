import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.services import fivetools
from app.utils.router_registry import register_routers


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Load the 5etools reference dataset once, off the request path.

    It's parsed and indexed exactly once per process (the loader is cached); warming it in a
    daemon thread keeps startup instant and means the first Browse doesn't pay for the parse.
    A missing/unconfigured dataset is a no-op — reference import is simply unavailable.
    """
    threading.Thread(target=fivetools.warm, name="fivetools-warm", daemon=True).start()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    register_routers(app)
    return app


app = create_app()
