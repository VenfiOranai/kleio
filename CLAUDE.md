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
- **Routers auto-register.** Don't edit `main.py` to add endpoints — drop a module under
  `oracle/app/api/routers/` that defines an `APIRouter` named `router`; `register_routers()`
  (in `app/utils/router_registry.py`) discovers and mounts it under `/api` automatically.
- **No `__all__`.** We don't maintain `__all__` lists. Re-export modules (`__init__.py`,
  `api/deps.py`) just import names; ruff's F401 is ignored there via `per-file-ignores` in
  `pyproject.toml` — extend that list if you add another re-export hub.
- **Single-user auth.** One credential from env (`APP_USERNAME`, `APP_PASSWORD_HASH`,
  `JWT_SECRET`); JWT bearer token on all data routes. No signup/multi-user.
- **Database is PostgreSQL** (+ `pgvector`, reserved for the later AI Q&A). One engine for
  relational data, full-text search, and embeddings. Migrations via **Alembic**.
- **Styling = Tailwind CSS v4 + Zard UI** (shadcn-style), **not** Angular Material. Zard
  components are added with `npx zard-cli add <name>` (init is interactive: `npx zard-cli init`)
  and are **copied into `herald/src/app/components/` (alias `@/components`) and committed** —
  treat them as our source, not a dependency. Helpers live in `@/utils` (e.g. `cn` /
  `merge-classes`) and Zard runtime directives in `@/core`; `@/*` maps to `src/app/*`. Requires
  Tailwind v4 and **plain CSS (no SCSS)** — `herald` is scaffolded with `--style=css`. Angular
  CDK is allowed for layout/`BreakpointObserver` only. Gotcha: after `zard-cli add card`, fix
  its `@/shared/core` import to `@/core` (beta CLI bug).
- **Split component files:** template, styles, and logic live in **separate files** —
  `templateUrl`/`styleUrl`, never inline `template:`/`styles:`. `ng generate component` already
  does this by default. **Zard components from `zard-cli add` come with inline template/styles
  — extract them** into `.html`/`.css` and switch to `templateUrl`/`styleUrl` after adding
  (see `components/button` and `components/card` for the pattern). Directives (e.g. `input`)
  have no template and need no split.
- **Frontend testing:** unit runner is **Vitest** (not Karma/Jasmine); spec files are **not
  auto-generated** (`skipTests: true` in `angular.json`) — write them by hand when wanted.
  End-to-end is Playwright (added in Phase 2). Backend tests are Pytest.
- **Split view is desktop-only** by design; mobile degrades to stacked/tabbed navigation.
- **Secrets live in `.env`** (gitignored). See `.env.example` for the full list. Never commit
  real secrets.

## Commands
Oracle uses a local venv at `oracle/.venv` (Windows paths shown; use `.venv/bin/…` on posix).
- Oracle tests: `cd oracle && ./.venv/Scripts/python -m pytest`
- Oracle lint: `cd oracle && ./.venv/Scripts/python -m ruff check .`
- Oracle dev server: `cd oracle && ./.venv/Scripts/python run.py`
- Herald build: `cd herald && npx ng build`
- Herald e2e: `cd herald && npx playwright test` — Playwright starts both the oracle (system/venv
  Python, overridable via `ORACLE_PYTHON`) and herald (`ng serve`) itself, so you only need
  **Postgres up + migrated** first (`docker compose -f infra/docker-compose.yml up -d db` then
  `alembic upgrade head`). It runs against a real backend seeded with a static e2e credential;
  tests use uniquely-named entities so a shared dev DB isn't clobbered. First run needs
  `npx playwright install chromium`.
- Local stack (API + Postgres): `docker compose -f infra/docker-compose.yml up`
- Apply migrations: `cd oracle && ./.venv/Scripts/python -m alembic upgrade head`
- New migration: `cd oracle && ./.venv/Scripts/python -m alembic revision --autogenerate -m "msg"`
  (needs Postgres up: `docker compose -f infra/docker-compose.yml up -d db`)

## Status
**Phase 0 complete** (pending review/commit). Scaffolded herald (Angular + Tailwind v4 + Zard
UI) and oracle (FastAPI); `infra/docker-compose.yml` (Postgres + oracle); **single-user JWT
auth** end to end — oracle `POST /api/auth/login` + `GET /api/auth/me` (`core/security.py`,
`api/deps.get_current_user`, `scripts/hash_password.py`), herald `AuthService` + `jwtInterceptor`
+ `authGuard` + login/home screens with a dev proxy (`herald/proxy.conf.json`); and
`.github/workflows/ci.yml`.

**Phase 1 backend done**: `Campaign`/`Session`/`Character` models, initial Alembic migration,
`character_calc` service, Pydantic schemas (`CharacterRead` exposes a computed `derived` block),
auth-protected CRUD routers — **46 tests pass** against Postgres.

**Phase 1 herald UI done** (pending review/commit): typed API services (`core/api/`), a markdown
renderer (`shared/markdown-view`, marked + DOMPurify), a `Shell` layout, campaign list/detail,
session editor (markdown + live preview), and the character sheet (manual inputs + server-computed
derived panel). Reactive forms throughout (Zard input is a CVA). Builds clean.

**Phase 1 deploy pipeline written** (pending review/commit + EC2 provisioning): prod stack
`infra/docker-compose.prod.yml` (db + oracle-with-migrations-on-start + herald nginx on :80),
herald prod `Dockerfile` + `nginx.conf` (serves SPA, proxies `/api`), oracle `Dockerfile` now
ships Alembic, `.github/workflows/deploy.yml` (SSH build-on-box on push to master), and a full
AWS runbook in `docs/deployment.md`. HTTP-only for now (no domain); add TLS later. Local image
builds couldn't be verified — this machine's Docker data dir is read-only — but contents are
sound (`pip install`/wheel succeeded in-build; `ng build` verified natively); they build on EC2.

**Phase 2 complete** (pending review/commit): desktop split-screen `Workspace`
(`features/workspace`) showing a session editor and character sheet side by side, with a
Notes/Split/Character toggle and a mobile tab fallback (CDK `BreakpointObserver`). To enable
reuse, `SessionEditor` and `CharacterSheet` are now **input-driven** (`sessionId`/`characterId`/
`campaignId` as signal inputs via `numberAttribute`, loaded in an `effect`, with an `embedded`
input to hide page chrome) — they work both as routed pages (router `withComponentInputBinding`)
and embedded in the workspace. Reachable via "Open workspace" on campaign detail.

**Playwright e2e added** (`herald/e2e/`, config `herald/playwright.config.ts`): full-stack specs
covering login/auth-guard, campaign CRUD, the session markdown editor + live preview, the
server-computed character derived stats, the workspace split-pane toggle, and global search.
Playwright's `webServer` boots the oracle + herald; a new **`e2e` CI job**
(`.github/workflows/ci.yml`) spins up Postgres, runs migrations, installs Chromium, and runs the
suite on every PR/push.

**Phase 3 complete** (pending review/commit): **global search**. Oracle — `sessions` gains a
generated, weighted `search_vector` (`tsvector`, title A > summary B > raw_notes C) with a GIN
index (migration `015bb0666895`); `services/search.py` (FTS query builder: `websearch_to_tsquery`
+ `ts_rank` + `ts_headline` highlight for sessions, ILIKE name match for characters, optional
`campaign_id` scope); `schemas/search.py`; auto-registered `api/routers/search.py`
(`GET /api/search?q=&campaign_id=`) returning a unified `results` list (`type` = session|character).
Herald — `SearchService` + types, a global search box in the `Shell` header (navigates to
`/search?q=`), and a `features/search` results page (`SearchResults`, `?q=` bound via component
input binding) that groups session/character hits and renders the server `<mark>` snippet via
sanitized `[innerHTML]`.

**Phase 4 complete** (pending review/commit): **AI summarization (Gemini)**. Oracle — `services/ai.py`
wraps the `google-genai` SDK (added to `pyproject`): a lazily-created, cached `genai.Client`
(`summarize_session(raw_notes) -> markdown`, system-instruction prompt), raising
`AINotConfiguredError`/`AIError`. Config gains `gemini_api_key` + `gemini_model`
(default `gemini-2.5-flash`). Auto-registered `api/routers/ai.py` exposes
`POST /api/sessions/{id}/summarize` — summarizes the **saved** `raw_notes` (never mutated) into the
editable `summary`; maps errors to 400 (no notes) / 503 (not configured) / 502 (model error).
**65 tests pass** (11 new: `tests/unit/test_ai.py` mocks the genai client, `tests/integration/test_ai_summarize.py`
mocks the service). Herald — `SessionService.summarize`, and the session editor now has an editable
`summary` textarea + live preview and a "Summarize with AI" button (`save-then-summarize`, `zLoading`
state, graceful error line). e2e `ai.spec.ts` covers summary-editing/persistence and the not-configured
error path (Playwright forces `GEMINI_API_KEY=''` so `/summarize` never calls Gemini).

Phase 4 is done. Next up is **Phase 5 — AI Q&A over notes (RAG)**. See `docs/roadmap.md`.
