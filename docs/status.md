# Kleio — build log

Detailed, phase-by-phase record of what's been built. `CLAUDE.md` keeps only a one-line
summary per phase; this file is the long form. Everything below is **pending review/commit**
unless noted. See `docs/roadmap.md` for what's next and `docs/architecture.md` for design.

## Phase 0 — scaffold + auth
Scaffolded herald (Angular + Tailwind v4 + Zard UI) and oracle (FastAPI); `infra/docker-compose.yml`
(Postgres + oracle); **single-user JWT auth** end to end — oracle `POST /api/auth/login` +
`GET /api/auth/me` (`core/security.py`, `api/deps.get_current_user`, `scripts/hash_password.py`),
herald `AuthService` + `jwtInterceptor` + `authGuard` + login/home screens with a dev proxy
(`herald/proxy.conf.json`); and `.github/workflows/ci.yml`.

## Phase 1 — core models + UI + deploy pipeline
**Backend:** `Campaign`/`Session`/`Character` models, initial Alembic migration, `character_calc`
service, Pydantic schemas (`CharacterRead` exposes a computed `derived` block), auth-protected CRUD
routers — 46 tests pass against Postgres.

**Herald UI:** typed API services (`core/api/`), a markdown renderer (`shared/markdown-view`, marked +
DOMPurify), a `Shell` layout, campaign list/detail, session editor (markdown + live preview), and the
character sheet (manual inputs + server-computed derived panel). Reactive forms throughout (Zard input
is a CVA).

**Deploy pipeline** (pending EC2 provisioning): prod stack `infra/docker-compose.prod.yml` (db +
oracle-with-migrations-on-start + herald nginx on :80), herald prod `Dockerfile` + `nginx.conf`
(serves SPA, proxies `/api`), oracle `Dockerfile` ships Alembic, `.github/workflows/deploy.yml` (SSH
build-on-box on push to master), full AWS runbook in `docs/deployment.md`. HTTP-only for now; add TLS
later. Local image builds unverified (this machine's Docker data dir is read-only) but sound; they
build on EC2.

## Phase 2 — workspace split-screen
Desktop split-screen `Workspace` (`features/workspace`) showing a session editor and character sheet
side by side, with a Notes/Split/Character toggle and a mobile tab fallback (CDK `BreakpointObserver`).
To enable reuse, `SessionEditor` and `CharacterSheet` are **input-driven** (`sessionId`/`characterId`/
`campaignId` as signal inputs via `numberAttribute`, loaded in an `effect`, with an `embedded` input to
hide page chrome) — they work both as routed pages (router `withComponentInputBinding`) and embedded in
the workspace.

**Playwright e2e** (`herald/e2e/`, config `herald/playwright.config.ts`): full-stack specs covering
login/auth-guard, campaign CRUD, the session markdown editor + live preview, server-computed character
derived stats, the workspace split-pane toggle, and global search. Playwright's `webServer` boots the
oracle + herald; a new `e2e` CI job spins up Postgres, runs migrations, installs Chromium, and runs the
suite on every PR/push.

## Phase 3 — global search
**Oracle:** `sessions` gains a generated, weighted `search_vector` (`tsvector`, title A > summary B >
raw_notes C) with a GIN index (migration `015bb0666895`); `services/search.py` (FTS query builder:
`websearch_to_tsquery` + `ts_rank` + `ts_headline` highlight for sessions, ILIKE name match for
characters, optional `campaign_id` scope); `schemas/search.py`; auto-registered `api/routers/search.py`
(`GET /api/search?q=&campaign_id=`) returning a unified `results` list (`type` = session|character).

**Herald:** `SearchService` + types, a global search box in the `Shell` header (navigates to
`/search?q=`), and a `features/search` results page (`SearchResults`, `?q=` bound via component input
binding) that groups session/character hits and renders the server `<mark>` snippet via sanitized
`[innerHTML]`.

## Phase 4 — AI summarization (Gemini)
**Oracle:** `services/ai.py` wraps the `google-genai` SDK: a lazily-created, cached `genai.Client`
(`summarize_session(raw_notes) -> markdown`, system-instruction prompt), raising
`AINotConfiguredError`/`AIError`. Config gains `gemini_api_key` + `gemini_model` (default
`gemini-2.5-flash`). Auto-registered `api/routers/ai.py` exposes `POST /api/sessions/{id}/summarize` —
summarizes the **saved** `raw_notes` (never mutated) into the editable `summary`; maps errors to 400
(no notes) / 503 (not configured) / 502 (model error). 65 tests pass (11 new).

**Herald:** `SessionService.summarize`; the session editor gains an editable `summary` textarea + live
preview and a "Summarize with AI" button (`save-then-summarize`, `zLoading` state, graceful error
line). e2e `ai.spec.ts` covers summary-editing/persistence and the not-configured error path.

## UI polish — dark mode + logo
`core/theme/theme.service.ts` toggles a `dark` class on `<html>` (the `.dark` token set already exists
in `styles.css`), persisted to localStorage, defaulting to the OS preference; applied at bootstrap
(injected in root `App`) and toggled from a sun/moon button in the `Shell` header. Plus a small inline
lyre-stylized-as-"K" SVG logo (Kleio = Muse of History; `currentColor`, theme-adaptive). e2e
`theme.spec.ts` covers toggle + persistence.

## Workspace-centric navigation
A campaign now opens straight into its workspace — `campaigns/:campaignId` renders `Workspace` (the
standalone campaign-detail, session, and character page routes + `campaign-detail` component were
removed). The workspace grew **+ New session / + New character** buttons; the embedded `SessionEditor`/
`CharacterSheet` now emit a `deleted` output (instead of navigating) so the workspace reselects, and
honor `?session=`/`?character=` query params for global-search deep-links. The components keep their
`embedded` dual-mode input but are only ever used embedded now (non-embedded page chrome is dead but
retained). e2e reworked (helpers `newSession`/`newCharacter`; 11 specs green).

## Phase 5 — AI Q&A over notes (RAG)
**Oracle:** `pgvector` dep + `note_embeddings` model (768-dim `Vector`, HNSW cosine index) + migration
`85a5f301d4ba` (enables the `vector` extension); `services/ai.py` gains `embed_texts` / `embed_query` /
`answer_question`; `services/rag.py` (**pure** `chunk_text`, plus `reindex_session[_safe]`,
`ensure_campaign_indexed`, `retrieve`, `answer_campaign_question`); `schemas/rag.py`; auto-registered
`api/routers/ask.py` (`POST /api/campaigns/{id}/ask` → answer + one citation per source session;
400/503/502 error mapping). Notes are re-embedded best-effort on session create/update (never blocks a
save); `/ask` back-fills missing embeddings on demand. Config gains `gemini_embed_model`; DB image →
`pgvector/pgvector:pg17` (dev/prod/CI). Tests: unit `test_rag_chunking.py` + embedding/answer cases in
`test_ai.py`; integration `test_ask.py` (mocked) and `test_rag.py` (real pgvector retrieval with a
deterministic fake embedder).

**Herald:** `QaService` + `features/ask` `Ask` component (question box → Markdown answer + citation
cards deep-linking to the workspace `?session=`), surfaced as an "Ask" tab in the notes editor
alongside Write/Preview/Summary (campaign-scoped, embedded — no separate route; `Ask` uses a
`[formGroup]` div, not a `<form>`, so it nests validly inside the session form). e2e `ask.spec.ts`
covers the not-configured (503) path.

## Phase 7 — Entities & mentions ("Codex")
**Oracle:** `entity_groups` + `entities` models (entities unique case-insensitively per campaign via a
functional index on `lower(name)`; group delete `SET NULL` with `passive_deletes`) + migration
`164e5aa4a525`; `services/entities.py` (**pure** `extract_mentions` regex `@\[([^\[\]\n]+)\]`, plus
`get_or_create` (idempotent) and insert-only `reconcile_mentions`); `schemas/entity.py`; auto-registered
`api/routers/entities.py` (entities + entity-groups CRUD — `POST` entity is idempotent 201/200,
rename/group clashes → 409, foreign group → 400). Sessions router backfills mentions on save. The
**summarize** router post-processes the AI summary through `entities.mark_entities` (**pure**) — Gemini
drops the notes' `@[Name]` tokens, so it re-tags the first whole-word occurrence of each known entity
(case-insensitive, longest-wins, skips existing tokens/markdown links).

**Herald:** `EntityService`; `MarkdownView` gained a `marked` inline extension rendering `@[Name]` as
bold+italic (`<strong><em>`) linking to `/search?q=` (SPA-nav via a delegated click handler); a
`MentionTextarea` CVA (caret-anchored `@` typeahead over the notes textarea, mirror-div caret coords,
eager *Create "…"* → idempotent POST) wired into the session editor's Write tab; a **Codex page**
(`features/entities`, route `campaigns/:id/entities`, "Codex" button in the workspace) grouping entities
into user-defined groups with create/rename/delete + a per-entity group `<select>` and description.
Reference is **by name** (renames don't rewrite existing `@[old]` tokens). Hovering a mention shows a
tooltip to the right — canonical name (bold, underlined) over its Markdown-rendered description
(`MarkdownView` takes an `entities` input, renders a fixed-positioned `.entity-tooltip`). e2e
`entities.spec.ts`; unit `markdown-view.spec.ts`.

## Character Sheet Overhaul (Phases 8–14)

Turns the character sheet's freeform `equipment`/`spells`/`features` text into **structured JSONB** on
the `characters` table. Derived values stay computed in the **pure** `character_calc`. Full plan in
`docs/roadmap.md` + `docs/architecture.md` (§2 structured schema, §3 fivetools/reference, §4 modal UI).
Independent of the notes/AI/entities phases. Each structured-field migration preserves any existing
freeform text as a single "Imported …" seed item (lossy best-effort downgrade).

### Phase 8 — structured basics & spellcasting stats
**Oracle:** `characters` gains `currency` JSONB `{cp,sp,ep,gp,pp}` and `other_proficiencies` JSONB
(list of `{category, name}`, category ∈ `language|weapon|armor|tool|other`) via migration `5a6d6f8fdbb3`
(server-defaults preserve existing rows). **Spellcasting ability is derived from class, not stored**
(per user feedback — matches "computed, never stored"): a **pure**
`character_calc.spellcasting_ability_for_class(class_name, subclass)` maps Artificer/Wizard→INT,
Cleric/Druid/Ranger→WIS, Bard/Paladin/Sorcerer/Warlock→CHA, Fighter/Rogue→INT only via the Eldritch
Knight / Arcane Trickster subclasses, else `""` (case/whitespace-normalized; unknown/homebrew → none).
`compute_derived` takes `class_name`/`subclass` and adds `spellcasting_ability` (str),
`spell_attack_bonus` (`mod + prof`), and `spell_save_dc` (`8 + mod + prof`) — the two ints **null** for
non-casters. Schemas: `Currency` + `OtherProficiency` (Literal-validated category), `DerivedStats`
extended.

**Herald:** `models.ts` gains `Currency`/`OtherProficiency`/`ProficiencyCategory` and
`DerivedStats.spellcasting_ability`; the character sheet adds a **Money** row (5 coin inputs, nested
`currency` form group), a read-only **Spellcasting** panel (ability + DC + attack from `derived`, driven
by the class field), and an **Other Proficiencies** section split into per-category cards with
add-on-Enter / removable chips. e2e `character.spec.ts` class-derived-spellcasting +
proficiency-chip-persistence test (2 specs green).

### Phase 9 — structured equipment + item modal
**Oracle:** `characters.equipment` moves from freeform `Text` to a **JSONB list** of items `{name,
quantity, category, weight?, equipped?, attuned?, description(md)}` via migration `1757898c7dd2`.
`character_calc` gains a pure `equipment_totals()` and surfaces `total_weight`, `carrying_capacity`
(STR × 15), `encumbered` (weight > capacity), and `attunement_count` in `derived`. Schemas:
`EquipmentItem` (category free-form; presets are a UI convention); `equipment` fields become
`list[EquipmentItem]`.

**Herald:** a dependency-free **`shared/modal`** (`app-modal`, native `<dialog>`); an **`EquipmentModal`**
(`features/characters/equipment-modal`) grouping items by category (preset-order then custom),
collapsible, with add/edit/remove/duplicate, quantity steppers, equipped/attuned toggles, live weight +
attuned/3 readout, and search + equipped-only filter (edits a working copy keyed by a transient `_id` so
`@for` tracking survives in-place edits, emits on every change). The sheet drops the equipment textarea
for a compact **summary** (item chips + derived weight/capacity/attunement) and an "Open equipment"
button; `equipment` rides along in Save via an `equipmentItems` signal. e2e equipment-modal test (3 specs
green).

### Phase 10 — structured spells + slot tracking
**Oracle:** `characters.spells` moves from freeform `Text` to a **JSONB list** of spells `{name, level
0–9, school, prepared, always_prepared, ritual, concentration, casting_time, range, components,
duration, description(md)}`, plus a new `spell_slots` JSONB list `{level 1–9, total, expended}` (manual
now; auto-from-class in Phase 14) — migration `2b9f4c1e0a3d`. Slots are **manual** — no `character_calc`
changes. Schemas: `Spell` (level `ge=0,le=9`) + `SpellSlot` (`ge=1,le=9`).

**Herald:** a **`SpellsModal`** (`features/characters/spells-modal`): a read-only spellcasting header
(ability/DC/attack from `derived`), per-level slot trackers (total steppers + clickable available/
expended **dots**, per-level Cast/Restore), spells grouped by level (Cantrips first), prepared/
always-prepared/ritual/concentration toggles, per-spell **Cast** (disabled when no slot of that level is
left), duplicate/remove, and filters (search, level `<select>`, prepared-only, ritual-only). Working
copy keyed by transient `_id`, emits `spells`/`spell_slots` on every change. The sheet drops the freeform
spells textarea for a compact summary (spell/prepared counts + per-level remaining-slot chips) and an
"Open spells" button. e2e spells-modal test (4 specs green).

### Long rest + structured hit dice
The spells modal's "Long rest (reset)" button moved to the **character sheet** as a single **Long rest**
action (Combat section) that also restores health — and `characters.hit_dice` became **structured**.
**Oracle:** `hit_dice` moves from freeform `String(50)` to a **JSONB list** of pools `{die, total,
spent}` (one per die size, so multiclass survives) via migration `3c8e2f1a9b4d`. Schema `HitDie` (`die`
free-form). No `character_calc` change.

**Herald:** the sheet drops the freeform `hit_dice` control for an inline pools editor (`hitDice`
signal: die/total/spent + available readout, add/remove) and a `longRest()` that sets `current_hp →
max_hp`, `temp_hp → 0`, restores spent hit dice **up to half each pool** (`spent → max(0, spent −
⌊total/2⌋)`), and resets every spell slot's `expended → 0` (local edit, persisted on next Save). The
spells modal loses its `resetSlots()`. **Bug fix:** the per-spell level `<select>` uses `[selected]` per
option instead of `[value]` on the select. e2e long-rest test (5 specs green).

### Phase 11 — structured features & traits
**Oracle:** `characters.features` moves from freeform `Text` to a **JSONB list** of features `{name,
source (class|subclass|race|background|feat|other), level?, uses?{max, expended, recharge
(short|long|other)}, description(md)}` via migration `4d9f0a2b1c5e`. `uses` is **null** for passive
traits. Features aren't derived. Schemas: `Feature` + `FeatureUses` (`source` and `recharge`
Literal-validated).

**Herald:** a **`FeaturesModal`** (`features/characters/features-modal`): features grouped by source
(canonical order), each with an opt-in limited-use tracker (Max stepper + recharge `<select>` +
clickable available/expended **dots** with Use/Restore), plus filters (search, source `<select>`,
limited-use-only) and duplicate/remove. Working copy keyed by transient `_id`, emits `features` on every
change. The sheet drops the freeform `features` textarea (only `notes` remains) for a compact summary
(feature/limited-use counts + per-feature remaining-use chips) and an "Open features" button. The sheet's
**Long rest** now also resets limited-use features that recharge on short/long rest (`recharge !==
'other'` → `expended → 0`). **Bug fix:** the spells modal's `slots` signal is now seeded with all nine
levels up front (the always-rendered `<dialog>` content called `slotFor(level).total` on an empty list
before `open()`, throwing during unrelated CD cycles). e2e features test (6 specs green).
