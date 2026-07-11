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
- **Entity mentions (planned, Phase 7).** Notes tag important words with an `@[Name]` token
  stored inline in `raw_notes` — **referenced by name, not id** (keeps raw text readable /
  Gemini-friendly; `entities.name` is the stable key). `@[Name]` renders as bold+italic with
  the `@` stripped, linking to `/api/search?q=Name`. Parsing lives in one **pure**
  `extract_mentions()` (like `character_calc`); entities/groups are first-class tables
  (user-defined groups). Design in `docs/architecture.md` §2/§3/§4; not yet implemented.
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

**UI polish** (pending review/commit): **dark mode** — `core/theme/theme.service.ts` toggles a
`dark` class on `<html>` (the `.dark` token set already exists in `styles.css`), persisted to
localStorage, defaulting to the OS preference; applied at bootstrap (injected in root `App`) and
toggled from a sun/moon button in the `Shell` header. Plus a small inline **lyre-stylized-as-"K"
SVG logo** next to the title (Kleio = Muse of History; `currentColor`, theme-adaptive). e2e
`theme.spec.ts` covers toggle + persistence.

**Workspace-centric navigation** (pending review/commit): a campaign now opens **straight into its
workspace** — `campaigns/:campaignId` renders `Workspace` (the standalone campaign-detail, session,
and character page routes + `campaign-detail` component were removed). The workspace grew **+ New
session / + New character** buttons; the embedded `SessionEditor`/`CharacterSheet` now emit a
`deleted` output (instead of navigating) so the workspace reselects, and honor `?session=`/
`?character=` query params for global-search deep-links (search results now link to the workspace
with that param). The components keep their `embedded` dual-mode input, but are only ever used
embedded now (the non-embedded page chrome is dead but retained). e2e reworked accordingly (helpers
`newSession`/`newCharacter`; **11 specs green**).

**Phase 5 complete** (pending review/commit): **AI Q&A over notes (RAG)**. Oracle —
`pgvector` dep + `note_embeddings` model (768-dim `Vector`, HNSW cosine index) + migration
`85a5f301d4ba` (enables the `vector` extension); `services/ai.py` gains `embed_texts` /
`embed_query` / `answer_question`; `services/rag.py` (**pure** `chunk_text`, plus
`reindex_session[_safe]`, `ensure_campaign_indexed`, `retrieve`, `answer_campaign_question`);
`schemas/rag.py`; auto-registered `api/routers/ask.py` (`POST /api/campaigns/{id}/ask` →
answer + one citation per source session; 400/503/502 error mapping). Notes are re-embedded
**best-effort** on session create/update (never blocks a save); `/ask` back-fills missing
embeddings on demand. Config gains `gemini_embed_model`; DB image → `pgvector/pgvector:pg17`
(dev/prod/CI). Tests: unit `test_rag_chunking.py` + embedding/answer cases in `test_ai.py`;
integration `test_ask.py` (router/error mapping, mocked) and `test_rag.py` (real pgvector
retrieval with a deterministic fake embedder). **Phase 5 tests green** (the pre-existing
`test_list_campaigns` asserts an empty-table count and only passes on a fresh DB — unrelated).
Herald — `QaService` + `features/ask` `Ask` component (question box → Markdown answer +
citation cards deep-linking to the workspace `?session=`), surfaced as an **"Ask" tab in the
notes editor** alongside Write/Preview/Summary (campaign-scoped, embedded — no separate route;
`Ask` uses a `[formGroup]` div, not a `<form>`, so it nests validly inside the session form).
e2e `ask.spec.ts` covers the not-configured (503) path. `ng build` clean.

Phase 5 is done.

**Phase 7 complete** (pending review/commit): **Entities & mentions ("Codex")**. Oracle —
`entity_groups` + `entities` models (entities unique **case-insensitively** per campaign via a
functional index on `lower(name)`; group delete `SET NULL` with `passive_deletes`) + migration
`164e5aa4a525`; `services/entities.py` (**pure** `extract_mentions` regex `@\[([^\[\]\n]+)\]`,
plus `get_or_create` (idempotent) and insert-only `reconcile_mentions`); `schemas/entity.py`;
auto-registered `api/routers/entities.py` (entities + entity-groups CRUD — `POST` entity is
idempotent 201/200, rename/group clashes → 409, foreign group → 400). Sessions router now
backfills mentions on save (`reconcile_mentions`, alongside the RAG reindex). The **summarize**
router post-processes the AI summary through `entities.mark_entities` (**pure**) — Gemini drops
the notes' `@[Name]` tokens, so it re-tags the first whole-word occurrence of each known entity
(case-insensitive, longest-wins, skips existing tokens/markdown links) so summary mentions render
+ link too. Tests: unit `test_entity_mentions.py` (incl. `mark_entities`); integration
`test_entities.py` (CRUD, idempotency, group-delete ungroups, save-time backfill) +
`test_ai_summarize.py` (auto-tag). Herald — `EntityService`; `MarkdownView` gained a `marked`
inline extension rendering `@[Name]` as bold+italic (`<strong><em>`) linking to `/search?q=`
(SPA-nav via a delegated click handler); a `MentionTextarea` CVA (caret-anchored `@` typeahead
over the notes textarea, mirror-div caret coords, eager *Create "…"* → idempotent POST) wired
into the session editor's Write tab; a **Codex page** (`features/entities`, route
`campaigns/:id/entities`, "Codex" button in the workspace) grouping entities into user-defined
groups with create/rename/delete + a per-entity group `<select>` and description. Reference is
**by name** (renames don't rewrite existing `@[old]` tokens). Hovering a mention shows a
**tooltip to the right** — titled with the entity's canonical name (bold, underlined) over its
**Markdown-rendered description**. `MarkdownView` takes an `entities` input, and on mouseover of
`a.entity-mention` looks up the entity (by lower-cased name) and renders a fixed-positioned
`.entity-tooltip` (reusing the shared `renderMarkdown` + the `.markdown` styles); the session
editor passes `entities()` to the preview + summary views. e2e `entities.spec.ts`
(mention insert → bold render → click-to-search; Codex grouping + collapse; hover tooltip);
unit `markdown-view.spec.ts` (render, click-nav, tooltip). `ng build` clean (bundle warning only).

**Phase 8 complete** (pending review/commit): **structured basics & spellcasting stats** (first
slice of the Character Sheet Overhaul). Oracle — `characters` gains `currency` JSONB
`{cp,sp,ep,gp,pp}` and `other_proficiencies` JSONB (list of `{category, name}`, category ∈
`language|weapon|armor|tool|other`) via migration `5a6d6f8fdbb3` (server-defaults preserve existing
rows). **Spellcasting ability is derived from class, not stored** (per user feedback — matches the
"computed, never stored" rule): a **pure** `character_calc.spellcasting_ability_for_class(class_name,
subclass)` maps Artificer/Wizard→INT, Cleric/Druid/Ranger→WIS, Bard/Paladin/Sorcerer/Warlock→CHA,
Fighter/Rogue→INT only via the Eldritch Knight / Arcane Trickster subclasses, else `""`
(case/whitespace-normalized; unknown/homebrew → none). `compute_derived` takes `class_name`/
`subclass` and adds `spellcasting_ability` (str), `spell_attack_bonus` (`mod + prof`), and
`spell_save_dc` (`8 + mod + prof`) to `derived` — the two ints **`null`** for non-casters. Schemas:
`Currency` + `OtherProficiency` (Literal-validated category), `DerivedStats` extended (no stored
spellcasting field). Tests: unit `test_character_calc.py` (class→ability map incl. subclass casters
+ homebrew none + normalization; spell attack/DC across classes/levels); integration
`test_characters.py` (currency/proficiency round-trip + class-derived spellcasting, non-caster
null/default, EK subclass grants casting). Herald — `models.ts` gains `Currency`/`OtherProficiency`/
`ProficiencyCategory` and `DerivedStats.spellcasting_ability`; the character sheet adds a **Money**
row (5 coin inputs, nested `currency` form group), a read-only **Spellcasting** panel (ability + DC
+ attack from `derived`, driven by the class field — no selector), and an **Other Proficiencies**
section split into per-category cards with add-on-Enter / removable chips (client `otherProfs`
signal, sent on save). e2e `character.spec.ts` gains a class-derived-spellcasting +
proficiency-chip-persistence test (**2 specs green**); `ng build` clean.

**Phase 9 complete** (pending review/commit): **structured equipment + item modal**. Oracle —
`characters.equipment` moves from freeform `Text` to a **JSONB list** of items `{name, quantity,
category, weight?, equipped?, attuned?, description(md)}` via migration `1757898c7dd2` (which
preserves any existing text as a single **"Imported equipment"** seed item; lossy best-effort
downgrade). `character_calc` gains a pure `equipment_totals()` and surfaces `total_weight`,
`carrying_capacity` (STR × 15), `encumbered` (weight > capacity), and `attunement_count` in
`derived`. Schemas: `EquipmentItem` (category is free-form; presets are a UI convention);
`CharacterBase.equipment`/`CharacterUpdate.equipment` become `list[EquipmentItem]`; `DerivedStats`
extended. Tests: unit `test_character_calc.py` (weight/attunement totals, carry capacity,
encumbrance); integration `test_characters.py` (equipment round-trip + derived, empty default). The
migration's text→seed conversion was verified against a seeded row. Herald — a dependency-free
**`shared/modal`** (`app-modal`, native `<dialog>` — see the modal convention above); an
**`EquipmentModal`** (`features/characters/equipment-modal`) grouping items by category
(preset-order then custom), collapsible, with add/edit/remove/**duplicate**, quantity steppers,
equipped/attuned toggles, live weight + attuned/3 readout, and a search + equipped-only filter
(edits a working copy keyed by a transient `_id` so `@for` tracking survives in-place edits, and
emits on every change). The character sheet drops the equipment textarea for a compact **summary**
(item chips + derived weight/capacity/attunement) and an **"Open equipment"** button; `equipment`
rides along in the sheet's Save via an `equipmentItems` signal. `models.ts` gains `EquipmentItem`
+ `EQUIPMENT_CATEGORIES` and `DerivedStats` weight/attunement fields. e2e `character.spec.ts`
gains an equipment-modal test (add item → stepper → derived weight 6 → summary) (**3 specs green**);
`ng build` clean (bundle-budget warning only).

**Phase 10 complete** (pending review/commit): **structured spells + slot tracking**. Oracle —
`characters.spells` moves from freeform `Text` to a **JSONB list** of spells `{name, level 0–9,
school, prepared, always_prepared, ritual, concentration, casting_time, range, components,
duration, description(md)}`, plus a new `spell_slots` JSONB list `{level 1–9, total, expended}`
(manual now; auto-from-class in Phase 14) — migration `2b9f4c1e0a3d` (preserves any existing spells
text as a single **"Imported spells"** seed item, mirroring Phase 9's equipment downgrade). Slots
are **manual** — no `character_calc` changes (the spell DC/attack from Phase 8 already cover the
derived side). Schemas: `Spell` (level bounded `ge=0,le=9`) + `SpellSlot` (`ge=1,le=9`);
`CharacterBase`/`CharacterUpdate` `spells` become `list[Spell]` and gain `spell_slots`. Tests:
integration `test_characters.py` (spells + slots round-trip, empty defaults, cast-persists,
out-of-range level → 422). Herald — a **`SpellsModal`** (`features/characters/spells-modal`,
reusing the shared `<dialog>` `Modal`): a read-only **spellcasting header** (ability/DC/attack fed
from the sheet's `derived`), **per-level slot trackers** (total steppers + clickable available/
expended **dots**, per-level Cast/Restore, and a **Long rest (reset)**), spells grouped by level
(Cantrips first), prepared/always-prepared/ritual/concentration toggles, a per-spell **Cast**
(disabled when no slot of that level is left), duplicate/remove, and filters (search, level
`<select>`, prepared-only, ritual-only). Edits a working copy keyed by a transient `_id` (like the
equipment modal) and emits `spells`/`spell_slots` on every change. The character sheet drops the
freeform spells textarea for a compact **summary** (spell/prepared counts + per-level remaining-slot
chips) and an **"Open spells"** button; `spells` + `spell_slots` ride along in the sheet's Save via
`spellItems`/`spellSlots` signals. `models.ts` gains `Spell`/`SpellSlot`/`SPELL_SCHOOLS` and
`Character.spells: Spell[]` + `spell_slots`. e2e `character.spec.ts` gains a spells-modal test (set
2 lvl-1 slots → add a prepared spell → expend a dot → summary shows 1 prepared + `Lvl 1: 1/2` →
survives reload) (**4 specs green**); the two existing modal tests were rescoped for the second
`<dialog>` (`getByRole('dialog')` / `:visible`). `ng build` clean (bundle-budget warning only).

Next up: **Phase 11 — Structured features** (reuses the Phase 9/10 modal + structured-list
pattern), **Phase 12 — Attacks panel** (needs 8/9/10), or **Phase 6 — Polish & hardening**
(backups) — see `docs/roadmap.md`.

**Planned — Character Sheet Overhaul (Phases 11–14)**: designed, not implemented (Phases 8–10 done —
see above). Turns the
character sheet's freeform `equipment`/`spells`/`features` text into **structured JSONB** on the
`characters` table (money, misc proficiencies, spellcasting DC/attack; equipment/spells/features
in modals; an attacks panel; **5etools** autocomplete-import then auto-populate-by-class). Derived
values stay computed in the **pure** `character_calc`. 5etools has **no API** — `services/fivetools.py`
reads user-mounted static JSON (`FIVETOOLS_DATA_DIR`) and a **pure** renderer converts its
`entries`/`{@tag}` format to Markdown; the dataset is **never bundled** (verbatim WotC content,
not SRD/OGL — DMCA'd 2024). Full plan in `docs/roadmap.md` (Character Sheet Overhaul epic) +
`docs/architecture.md` (§2 structured schema, §3 fivetools/reference, §4 modal UI). Independent
of the notes/AI/entities phases.
