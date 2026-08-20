# Kleio — working notes for Claude

Personal web app to chronicle D&D campaigns: session notes + 5E character sheets, grouped
under campaigns. Read `docs/architecture.md` and `docs/roadmap.md` for the full design, and
`docs/status.md` for the detailed build log; this file is the quick, durable reference. Keep it
updated as the code lands.

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
- **One Markdown input: `shared/markdown-editor`.** Every place Markdown is written (session notes
  + summary, entity descriptions, equipment/spell/feature/attack descriptions, character notes)
  uses `app-markdown-editor` — never a bare `<textarea>`. It's a plain textarea (the raw Markdown
  stays canonical — no WYSIWYG, no third-party editor) plus a formatting toolbar, Ctrl/Cmd
  shortcuts, a Write/Preview toggle, and the optional `@`-mention typeahead (`[mentions]="true"`,
  which absorbed the old `mention-textarea`). All the text transforms live in one **pure**
  `markdown-commands.ts` (`applyCommand(state, command)`, like `character_calc`). It's a
  `ControlValueAccessor` (`formControlName`) *and* takes `[value]`/`(valueChange)`/`(commit)` for
  the modals that edit JSONB rows — `commit` fires on blur, the save-on-blur hook. Set
  `[preview]="false"` where the host already renders its own preview pane. Gotcha: it strips
  `placeholder`/`arialabel` off its host element (a static attribute in a host template feeds the
  input *and* stays in the DOM, so lookups would match twice), and it must not be wrapped in a
  `<label>` — the toolbar buttons are labelable and would steal the association.
- **Entity mentions (Phase 7).** Notes tag important words with an `@[Name]` token stored inline
  in `raw_notes` — **referenced by name, not id** (keeps raw text readable / Gemini-friendly;
  `entities.name` is the stable key). `@[Name]` renders as bold+italic with the `@` stripped,
  linking to search. Parsing lives in one **pure** `extract_mentions()` (like `character_calc`);
  entities/groups are first-class tables (user-defined groups).
- **5etools reference data is user-supplied and loaded once.** `services/fivetools/` reads the
  5etools JSON from `FIVETOOLS_DATA_DIR` (repo root *or* its `data/` dir — both are accepted),
  else from `FIVETOOLS_DOWNLOAD_DIR` (`oracle/var/fivetools`, gitignored) where the optional
  **download** puts it, and builds one in-memory index, cached for the process (`index._build`
  is `lru_cache`d; a daemon thread warms it from `main.lifespan`). **Kleio ships no game data**
  — it's WotC-copyrighted, so nothing is bundled or committed; with neither source present
  `/api/reference/status` answers `available: false`, the data routes 503, and herald hides its
  Browse buttons. The download (`fetch.py` → `POST /api/reference/fetch`, or
  `scripts/fetch_fivetools.py`) is a **background job, never startup** — it walks undocumented
  static paths on a third-party host, so it must fail loudly once, not silently on every boot;
  it's refused when `FIVETOOLS_DATA_DIR` is set, since the index would ignore what it wrote.
  Records
  are indexed **raw** with cheap facets; Markdown rendering happens per record on
  `GET /api/reference/{type}/{id}`. The two transform modules are **pure** (like
  `character_calc`): `render.py` (`{@tag}` + `entries` → Markdown) and `normalize.py` (5etools
  objects → our `Spell`/`EquipmentItem`/`Feature`/`Attack`, plus `_copy` and magic-variant
  assembly). Only `index.py` touches the filesystem.
- **Routers auto-register.** Don't edit `main.py` to add endpoints — drop a module under
  `oracle/app/api/routers/` that defines an `APIRouter` named `router`; `register_routers()`
  (in `app/utils/router_registry.py`) discovers and mounts it under `/api` automatically.
- **No `__all__`.** We don't maintain `__all__` lists. Re-export modules (`__init__.py`,
  `api/deps.py`) just import names; ruff's F401 is ignored there via `per-file-ignores` in
  `pyproject.toml` — extend that list if you add another re-export hub.
- **Single-user auth.** One credential from env (`APP_USERNAME`, `APP_PASSWORD_HASH`,
  `JWT_SECRET`); JWT bearer token on all data routes. No signup/multi-user.
- **Database is PostgreSQL** (+ `pgvector`, now used by Phase 5 RAG — the `note_embeddings`
  table). One engine for relational data, full-text search, and embeddings. Dev/prod/CI all use
  the **`pgvector/pgvector:pg17`** image (the migration runs `CREATE EXTENSION vector`).
  Migrations via **Alembic**.
- **RAG embeddings are derived + best-effort.** Session notes are chunked + embedded into
  `note_embeddings` on save via `rag.reindex_session_safe`, which **swallows AI errors** so a
  missing/failing `GEMINI_API_KEY` never blocks a save; `/ask` back-fills missing embeddings on
  demand. Chunking (`rag.chunk_text`) is a **pure**, unit-tested module. Embedding width is
  fixed in code (`ai.EMBED_DIM = 768`) and the migration — changing it needs a new migration.
- **Styling = Tailwind CSS v4 + Zard UI** (shadcn-style), **not** Angular Material. Zard
  components are added with `npx zard-cli add <name>` (init is interactive: `npx zard-cli init`)
  and are **copied into `herald/src/app/components/` (alias `@/components`) and committed** —
  treat them as our source, not a dependency. Helpers live in `@/utils` (e.g. `cn` /
  `merge-classes`) and Zard runtime directives in `@/core`; `@/*` maps to `src/app/*`. Requires
  Tailwind v4 and **plain CSS (no SCSS)** — `herald` is scaffolded with `--style=css`. Angular
  CDK is allowed for layout/`BreakpointObserver` only. Gotcha: after `zard-cli add card`, fix
  its `@/shared/core` import to `@/core` (beta CLI bug).
- **Modals = native `<dialog>`, not Zard `dialog`.** `zard-cli add dialog` pulls in
  `@angular/cdk/overlay` + `@angular/cdk/portal`, which violates the CDK-for-layout-only rule
  above. Instead we have a dependency-free `shared/modal` (`app-modal`) built on the native
  `<dialog>` element (`showModal()` gives focus-trap/Esc/backdrop for free); project content via
  `<ng-content>` and drive it with `open()`/`close()`. The structured character-sheet sections
  (equipment, and later spells/features/attacks) reuse it.
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
- Download 5etools reference data (same job as the campaigns-page button, for a headless box):
  `cd oracle && ./.venv/Scripts/python scripts/fetch_fivetools.py [DEST]`
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
All work to date is **pending review/commit**. Per-phase detail lives in `docs/status.md`; the
one-liners below are the map.

- **Phase 0** — scaffold (herald + oracle) + single-user JWT auth end to end + CI.
- **Phase 1** — `Campaign`/`Session`/`Character` models, `character_calc`, CRUD routers; herald API
  services, markdown renderer, `Shell`, campaign/session/character UI; prod deploy pipeline (pending
  EC2).
- **Phase 2** — desktop split-screen `Workspace`; `SessionEditor`/`CharacterSheet` made input-driven
  + embeddable. Playwright e2e + `e2e` CI job added.
- **Phase 3** — global search (weighted `tsvector` + GIN; unified session/character results).
- **Phase 4** — AI summarization via Gemini (`services/ai.py`, `POST /sessions/{id}/summarize`).
- **UI polish** — dark mode (theme service) + lyre-"K" logo.
- **Workspace-centric nav** — campaigns open straight into the workspace; deep-link `?session=`/
  `?character=`.
- **Phase 5** — AI Q&A over notes (RAG): `pgvector` + `note_embeddings`, `services/rag.py`,
  `POST /campaigns/{id}/ask`; "Ask" tab in the editor.
- **Phase 7** — Entities & mentions ("Codex"): `@[Name]` tokens, entities/groups tables + CRUD,
  mention typeahead, Codex page, hover tooltips.
- **Character Sheet Overhaul (8–14)** — freeform text → structured JSONB (derived stays in
  `character_calc`). Done: **8** basics/spellcasting stats + currency + proficiencies; **9**
  equipment + modal; **10** spells + slot tracking; **long rest + structured hit dice**; **11**
  features & traits; **12** attacks panel (JSONB `attacks` + derived to-hit/damage + modal).
- **Session ordering** — sessions list newest play-date first (undated last); new sessions default to
  today; saving re-sorts/relabels the workspace picker live via the editor's `updated` output.
- **Character JSON view** — a `JSON` toggle by Delete/Save swaps the sheet for the raw editable
  character, to migrate one between environments (copy there, paste here, Save). Serializing/parsing
  lives in one **pure** `character-json.ts`; the two views sync in memory on every toggle.
- **Spells preview** — the sheet's spells block now tracks slot *usage* (clickable dots; totals stay
  modal-only) and lists spells in collapsible per-level sections, names only, with a hover popover
  showing a spell's full data. Dot maths lives in one **pure** `spell-slots.ts` shared with the modal.
- **Features preview** — same treatment for features & traits: collapsible per-*source* sections sorted
  by level (lowest first), names only with a hover popover, and clickable use dots for limited-use
  features (max/recharge stay modal-only). Grouping + use maths live in one **pure** `features.ts`
  shared with the modal (its dot helpers wrap `spell-slots.ts`).
- **Pinnable popovers** — the equipment/spells/features preview popovers are hover-only *until
  clicked*: **clicking a chip pins** its popover so a scrollable one is reachable (it survives
  mouseleave and takes the pointer), closing on an outside click, Escape, or a second click of the
  chip. The state machine is one shared `characters/popover.ts` (`PinnablePopover<T>` +
  `clampToViewport`), one instance per section, driven by `(document:click)`/
  `(document:keydown.escape)` host listeners on `CharacterSheet`. Unpinned popovers **must** stay
  `pointer-events-none` or they steal the hover from their own chip. Chips with nothing to show
  (equipment without a description) are gated by the optional `opensFor` predicate and render
  `[disabled]`.
- **Markdown editor** — every Markdown input is now `shared/markdown-editor` (toolbar + shortcuts +
  Write/Preview toggle) instead of a bare textarea; it absorbed `shared/mention-textarea`, which is
  gone. See the convention above.
- **Phase 13 — 5etools reference import.** `services/fivetools/` + `api/routers/reference.py`
  (`status` / `facets` / `search` / `{type}/{id}` / `fetch`) expose spells, items (base + magic +
  assembled variants) and features (feats + optional features) from a dataset the user either
  mounts or downloads with the campaigns page's **Download reference data** button
  (`features/reference/reference-data-card`, polling the job). Herald browses
  them through **one** modal, `characters/reference-modal` — opened by a **Browse** button beside
  the *+ Add* button in each section modal (equipment, spells, features, and attacks, which opens
  it weapons-only) — with search, per-type filters/sorts, expandable detail, and multi-add. Picking
  a result imports the full record into the entry, still fully editable.

**Next up:** Phase 14 (populate from class/subclass/level), or Phase 6 (polish/hardening, backups)
— see `docs/roadmap.md`.
