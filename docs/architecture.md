# Kleio — Architecture

## Context

Kleio is a personal web app to chronicle D&D campaigns: session notes and 5E character
sheets, both organized under campaigns. It must work on desktop and mobile, support a
desktop-only side-by-side notes/character view, and lay groundwork for later AI features
(Gemini summarization + Q&A over notes).

### Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Database | **PostgreSQL** (+ `pgvector` ext) | One engine for relational data, native full-text search, and later embedding/Q&A |
| Auth | **Single-user JWT** | One credential you set; keeps notes private without multi-user complexity |
| Notes format | **Markdown** | Clean input/output for Gemini; trivially full-text searchable as plain text |
| Packaging/deploy | **Docker Compose on EC2** | Reproducible, simple CI/CD, single-box friendly |

Fixed by requirements: Angular · FastAPI · Pytest · Playwright · GitHub Actions · Amazon EC2.

---

## 1. High-level architecture

```
┌─────────────────────────────────────────── EC2 instance ───────────────────────────────────┐
│                                                                                              │
│   ┌────────────┐      ┌──────────────────┐      ┌───────────────────┐    ┌────────────────┐  │
│   │  Browser   │─────▶│  nginx (reverse  │────▶ │  FastAPI (uvicorn  │──▶ │  PostgreSQL    │  │
│   │ (Angular   │ HTTPS│  proxy + static  │ /api │  /gunicorn)        │    │  + pgvector    │  │
│   │  SPA)      │◀─────│  Angular build)  │◀──── │                    │◀── │  (volume)      │  │
│   └────────────┘      └──────────────────┘      └─────────┬─────────┘    └────────────────┘  │
│                                                           │ (AI phases)                       │
│                                                           ▼                                   │
│                                                  Google Gemini API (external)                 │
│                                                                                               │
│   All app containers orchestrated by docker-compose.prod.yml                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **One repo (monorepo)**: `herald/` (frontend), `oracle/` (backend), `infra/`,
  `.github/workflows/`, `docs/`. **Herald** = the Angular SPA that announces & presents;
  **Oracle** = the FastAPI service that holds the answers (and, later, the AI Q&A).
- nginx serves the built Angular SPA and reverse-proxies `/api/*` to FastAPI → no CORS in prod.
- Postgres data on a named Docker volume (persisted across deploys); nightly `pg_dump` backup.

---

## 2. Data model

```
Campaign 1───* Session
Campaign 1───* Character
```

**campaigns**: `id`, `name`, `description`, `created_at`, `updated_at`

**sessions**: `id`, `campaign_id (FK)`, `title`, `session_date`, `order_index`,
`raw_notes` (markdown, the canonical text you write), `summary` (markdown, nullable —
filled by Gemini later, editable), `search_vector` (tsvector, generated),
`created_at`, `updated_at`. GIN index on `search_vector`.

**characters**: `id`, `campaign_id (FK)`, plus 5E fields below. Typed columns for the
well-known scalars; flexible/list-y bits (equipment, features, spells, proficiency
selections) as `JSONB`. Only **manually-entered** values are persisted — derived values
are computed, never stored (single source of truth).

### Character sheet — manual vs calculated

**Manual (stored):** name, class, subclass, level, race, background, alignment, XP; the six
ability scores (STR/DEX/CON/INT/WIS/CHA); max HP, current HP, temp HP, hit dice; armor
class, speed; proficiency selections (which skills + which saving throws are proficient,
stored as JSONB sets); equipment / features / spells / notes (JSONB/markdown).

**Calculated (derived, never stored):**
- ability modifier = `floor((score − 10) / 2)`
- proficiency bonus = `2 + (level − 1) // 4`
- saving throw = ability mod + (prof bonus if proficient)
- skill check = relevant ability mod + (prof bonus if proficient)  *(18 standard 5E skills)*
- passive perception = `10 + perception skill`
- initiative = DEX modifier

> Calculation lives in one **pure backend module** `oracle/app/services/character_calc.py`
> (no DB/IO) so it's exhaustively unit-tested. API responses include both stored fields and
> a `derived` block. Frontend renders `derived`; it may mirror the math locally for instant
> live-edit feedback, but **the backend is authoritative**.

Schema migrations managed by **Alembic**.

---

## 3. Oracle — backend (FastAPI)

```
oracle/
  app/
    main.py                 # app factory, router registration
    core/
      config.py             # pydantic-settings, reads env
      db.py                 # SQLAlchemy engine + session dependency
      security.py           # password hash (passlib/bcrypt), JWT encode/verify
    models/                 # SQLAlchemy: campaign.py, session.py, character.py
    schemas/                # Pydantic v2 request/response models
    api/
      deps.py               # get_db, get_current_user
      routers/
        auth.py             # POST /api/auth/login  → JWT
        campaigns.py        # CRUD
        sessions.py         # CRUD (nested under campaign)
        characters.py       # CRUD (nested under campaign)
        search.py           # GET /api/search?q=
        # (AI phases) ai.py # summarize, ask
    services/
      character_calc.py     # PURE derived-stat math (unit-tested)
      search.py             # Postgres FTS query builder
      # (AI phases) ai.py   # Gemini client wrapper
  alembic/                  # migrations
  tests/
    unit/                   # character_calc, security — no DB
    integration/            # API + test Postgres (transactional rollback per test)
  pyproject.toml
  Dockerfile
```

**API surface (MVP):**
- `POST /api/auth/login`
- `GET/POST /api/campaigns`, `GET/PUT/DELETE /api/campaigns/{id}`
- `GET/POST /api/campaigns/{id}/sessions`, `GET/PUT/DELETE /api/sessions/{id}`
- `GET/POST /api/campaigns/{id}/characters`, `GET/PUT/DELETE /api/characters/{id}`
- `GET /api/search?q=&campaign_id=` → unified results across sessions (+ character names)

**Auth:** single set of credentials from env (`APP_USERNAME`, `APP_PASSWORD_HASH`,
`JWT_SECRET`). Login returns a JWT; all data routes require a valid bearer token.

**Testing:** Pytest. Unit tests for `character_calc` (modifiers, prof bonus across levels,
saves/skills with/without proficiency, edge scores 1–30). Integration tests spin a test
Postgres, use FastAPI `TestClient`, each test in a rolled-back transaction. Coverage gate in CI.

---

## 4. Herald — frontend (Angular)

Standalone-components Angular, **Tailwind CSS v4** + **Zard UI** (shadcn-style, copy-in
components) for styling, signals for state, typed `HttpClient` services, route guard +
JWT interceptor. Angular CDK is used only for layout/`BreakpointObserver` (no Angular
Material).

> **Zard UI** components are scaffolded into the repo with `npx zard-cli add <name>` (init
> once with `npx zard-cli init`, which asks for theme + import aliases) and are **committed**
> — they're source, not a dependency. Requires Tailwind v4 and plain CSS (**no SCSS**), so
> `herald` is generated with `--style=css`. Aliases were set to `@/components` and `@/utils`
> (with `@/*` → `src/app/*` in `tsconfig.json`); Zard also drops runtime helpers into
> `core/`. Note: the beta CLI hardcodes `@/shared/core` in the card component — repoint it to
> `@/core` after `add`ing card (Zard bug).

```
herald/src/app/
  components/      # Zard UI components (@/components) — copied via `zard-cli add`, committed
  utils/           # Zard helpers: merge-classes (cn), number, etc. (@/utils)
  core/            # Zard runtime directives/providers (@/core), PLUS our own
                   #   auth.service, auth.guard, jwt.interceptor, api/*.service.ts
  features/
    campaigns/     # list + detail
    sessions/      # list, markdown editor + preview
    characters/    # 5E sheet (inputs for manual, read-only for derived)
    workspace/     # side-by-side notes|character view (desktop)
    search/        # global search box + results
  shared/          # our own presentational bits: markdown-view, collapsible-pane, confirm-dialog
```

- **Markdown:** edit raw markdown; render preview with a sanitized lib (`ngx-markdown` /
  `marked` + DOMPurify).
- **Split-screen workspace (desktop only):** two-pane layout — notes | character — each
  pane independently collapsible to give the other full width, via Angular CDK. A
  `BreakpointObserver` detects desktop vs mobile.
- **Responsive:** mobile-first Tailwind utilities; on phones the split view degrades to
  tabbed/stacked navigation (notes and character as separate full-width screens).
- **E2E:** Playwright covers login → create campaign → add session → add character (verify a
  derived stat) → global search → split-view collapse/expand.

---

## 5. Search

**MVP:** PostgreSQL full-text search. A generated `search_vector tsvector` on `sessions`
(weighted: title > summary > raw_notes), GIN-indexed. `/api/search` runs
`websearch_to_tsquery`, ranks with `ts_rank`, returns snippet + session/campaign refs; also
matches character names. Optionally scoped to a campaign.

**Later (AI Q&A):** add a `note_embeddings` table (`pgvector`). On session save, chunk +
embed via Gemini; `/api/campaigns/{id}/ask` does vector retrieval → feeds top chunks to
Gemini → returns an answer with source-session citations (RAG). Same DB engine, no new infra.

---

## 6. CI/CD & deployment

**`.github/workflows/`:**
- `ci.yml` (on PR/push): **oracle** lint (ruff) + Pytest against a Postgres service container;
  **herald** lint + `ng build` + Playwright e2e against the compose stack.
- `deploy.yml` (on push to `main`, after CI green): build & push images (GHCR), SSH to EC2,
  `docker compose -f docker-compose.prod.yml pull && up -d`, run `alembic upgrade head`.

**Infra (`infra/`):** `docker-compose.yml` (local dev: hot-reload backend, `ng serve`,
Postgres) and `docker-compose.prod.yml` (nginx + gunicorn/uvicorn + Postgres). Secrets via
GitHub Actions secrets → EC2 `.env` (never committed). HTTPS via nginx + Let's Encrypt
(certbot) or Caddy. Security group: 80/443 open, 22 restricted to your IP.

### Deferred choices (sensible defaults, revisit at execution)
- nginx + certbot vs Caddy for TLS (default: nginx + certbot).
- Gemini model + cost controls — decide at the summarization phase.
- Single EC2 box only (no autoscaling/RDS) — matches "personal, small data".
