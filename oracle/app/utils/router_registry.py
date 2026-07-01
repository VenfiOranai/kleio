import importlib
import pkgutil

from fastapi import APIRouter, FastAPI


def register_routers(app: FastAPI, prefix: str = "/api") -> None:
    """Auto-discover and include every ``router`` exposed by a module in ``app.api.routers``.

    Drop a new module under ``app/api/routers/`` that defines an ``APIRouter`` named
    ``router`` and it is mounted automatically — no edits to ``main.py`` needed.
    """
    from app.api import routers as routers_pkg

    for module_info in sorted(pkgutil.iter_modules(routers_pkg.__path__), key=lambda m: m.name):
        module = importlib.import_module(f"{routers_pkg.__name__}.{module_info.name}")
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            app.include_router(router, prefix=prefix)
