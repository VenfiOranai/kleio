# Kleio — working notes for Claude

Personal web app to chronicle D&D campaigns: session notes + 5E character sheets, grouped
under campaigns. Read `docs/architecture.md` and `docs/roadmap.md` for the full design; this
file is the quick, durable reference. Keep it updated as the code lands.

## Themed naming (important)
- **`herald/`** = the **frontend** (Angular). "Announces & presents."
- **`oracle/`** = the **backend** (FastAPI). "Holds the answers."

Use these names in code, paths, and prose. `frontend`/`backend` appear in docs only as
one-word glosses.

## Git workflow (do this)
- **Start every new feature/task on a new branch** — create it before making changes; never
  work directly on `main`.
- **Never stage or commit.** Leave all `git add` / `git commit` to the user — they review the
  diff before the PR stage to avoid redundant CI runs. Make the edits, then stop and let them
  commit.

## Layout
```
herald/    Angular SPA
oracle/    FastAPI app + Alembic migrations + tests
infra/     docker-compose (dev + prod), nginx config
docs/      architecture.md, roadmap.md  (source of truth for design)
```

## Conventions & gotchas (don't violate without reason)
- **Derived character stats are computed, never stored.** Ability modifiers, proficiency
  bonus, saving throws, skills, passive perception, initiative are calculated from the
  manually-entered fields. All the math lives in one **pure** module,
  `oracle/app/services/character_calc.py` (no DB/IO) so it's exhaustively unit-tested.
  **The backend is authoritative**; the frontend may mirror the math for live preview only.
- **Notes are Markdown.** `raw_notes` is the canonical text the user writes and is **always
  preserved**; `summary` is a separate, nullable, editable field (filled by Gemini later).
- **Single-user auth.** One credential from env (`APP_USERNAME`, `APP_PASSWORD_HASH`,
  `JWT_SECRET`); JWT bearer token on all data routes. No signup/multi-user.
- **Database is PostgreSQL** (+ `pgvector`, reserved for the later AI Q&A). One engine for
  relational data, full-text search, and embeddings. Migrations via **Alembic**.
- **Split view is desktop-only** by design; mobile degrades to stacked/tabbed navigation.
- **Secrets live in `.env`** (gitignored). See `.env.example` for the full list. Never commit
  real secrets.

## Commands
_Filled in during Phase 0 scaffolding. Intended shape:_
- Backend tests: `cd oracle && pytest`
- Backend lint: `cd oracle && ruff check .`
- Frontend build: `cd herald && ng build`
- Frontend e2e: `cd herald && npx playwright test`
- Local stack: `docker compose -f infra/docker-compose.yml up`
- Migrations: `cd oracle && alembic upgrade head`

## Status
Planning done, docs committed. Next: **Phase 0** (scaffold herald + oracle, local Postgres,
single-user auth, CI). See `docs/roadmap.md`.
