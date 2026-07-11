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
Campaign 1───* EntityGroup
Campaign 1───* Entity  *───1 EntityGroup   (Entity.group_id nullable)
Session  1───* NoteEmbedding  (also FK campaign_id, denormalized)
```

**campaigns**: `id`, `name`, `description`, `created_at`, `updated_at`

**sessions**: `id`, `campaign_id (FK)`, `title`, `session_date`, `order_index`,
`raw_notes` (markdown, the canonical text you write), `summary` (markdown, nullable —
filled by Gemini later, editable), `search_vector` (tsvector, generated),
`created_at`, `updated_at`. GIN index on `search_vector`.

**note_embeddings** (Phase 5, RAG): `id`, `session_id (FK, cascade)`,
`campaign_id (FK, cascade — denormalized from the session so retrieval filters by campaign
without a join)`, `chunk_index`, `content` (the chunk text), `embedding`
(`vector(768)`, pgvector), `created_at`. A session's notes are chunked and embedded into these
rows; they're fully owned by the session (editing notes replaces them, deleting cascades).
HNSW index on `embedding` (`vector_cosine_ops`). Requires the `vector` extension
(`CREATE EXTENSION IF NOT EXISTS vector`, in the migration) — hence the `pgvector/pgvector`
Postgres image. The embedding width is fixed in code (`services/ai.EMBED_DIM` /
`models/note_embedding.EMBED_DIM`) and the migration; changing it needs a new migration.

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

### Character sheet — planned structured overhaul (Phases 8–14)

The freeform `equipment` / `spells` / `features` **text** columns become **structured JSONB
lists** on the same `characters` table (consistent with today's proficiency lists — one table,
no joins; Pydantic validates each element). New derived values stay computed in
`character_calc` (never stored). Blob→structured migrations preserve the old text as a
section-level `notes`. Planned columns/shapes:

- **`currency`** (JSONB) `{cp, sp, ep, gp, pp}` — money tracking *(feat. 7)*.
- **`other_proficiencies`** (JSONB) — list of `{category, name}`, category ∈
  `language|weapon|armor|tool|other`, rendered split by category *(feat. 6)*.
- **Spellcasting ability** — **derived from class, not stored**: a pure
  `character_calc.spellcasting_ability_for_class(class_name, subclass)` maps each 5E class to its
  fixed ability (Wizard/Artificer→INT, Cleric/Druid/Ranger→WIS, Bard/Paladin/Sorcerer/Warlock→CHA,
  Fighter/Rogue→INT via Eldritch Knight / Arcane Trickster, else none). Feeds new derived **spell
  attack bonus** (`mod + prof`) and **spell save DC** (`8 + mod + prof`), all in the `derived`
  block *(feat. 8)*.
- **`equipment`** (JSONB) — items `{name, quantity, category, weight?, equipped?, attuned?,
  description(md)}`; optional derived total weight / attunement count *(feat. 1)*.
- **`spells`** (JSONB) — `{name, level, school, prepared, always_prepared, ritual, concentration,
  casting_time, range, components, duration, description(md)}`; **`spell_slots`** (JSONB) per
  level `{total, expended}` *(feat. 2)*.
- **`features`** (JSONB) — `{name, source, level?, uses?{max, expended, recharge}, description(md)}`
  *(feat. 3)*.
- **`attacks`** (JSONB) — `{name, ability, proficient, damage_dice, damage_type, bonus?, range,
  notes, source}`; `character_calc` derives each attack's **to-hit** and **damage string**
  *(feat. 4)*.

**5etools reference import** *(feat. 5)*: `services/fivetools.py` reads the **5etools static
JSON** (5etools has **no API**) from a configured `FIVETOOLS_DATA_DIR` — spells
(`spells/index.json` → `spells-<src>.json`), classes (`class/class-<name>.json`), items
(`items.json` + `items-base.json` + `magicvariants.json`), `races`/`backgrounds`/`feats`/
`optionalfeatures` — builds a searchable in-memory index, and a **pure** renderer converts the
nested `entries` arrays + `{@tag name|source|display}` markup into Markdown while normalizing
each object into our item/spell/feature schema. Auto-registered `api/routers/reference.py`:
Stage 1 — `GET /api/reference/search?type=&q=` (autocomplete) + `/api/reference/{type}/{id}`
(full record) fill a structured entry; Stage 2 — `POST /api/characters/{id}/populate` parses the
class JSON for level-appropriate features / proficiencies / slots (reviewed before applying).
**The dataset is user-supplied, never bundled**: it's verbatim WotC-copyrighted content (not
SRD/OGL — the 5etools mirror was DMCA'd in 2024), so Kleio ships no game data; the user mounts
their own copy for personal single-user use, and import is disabled (503) when the dir is unset.
Import is additive and optional. Full plan + sequencing in `docs/roadmap.md` (Character Sheet
Overhaul).

### Entities & mentions ("Codex")

Notes can tag important words — names, places, factions, items — as **entities**. In the note
you type `@`, pick from (or create) the campaign's entities, and a delimited token is stored in
the canonical `raw_notes`:

```
...then @[Gandalf] drew @[Glamdring] and faced the @[Balrog] at @[The Bridge of Khazad-dûm].
```

**entity_groups**: `id`, `campaign_id (FK, cascade)`, `name`, `order_index`, `created_at`,
`updated_at`. Unique `(campaign_id, name)`. User-defined buckets ("Player Characters",
"Allies", "Places", …) — created/renamed/deleted freely on the Codex page.

**entities**: `id`, `campaign_id (FK, cascade)`, `name` (the canonical text used inside
`@[…]`), `group_id (FK entity_groups.id, nullable, ON DELETE SET NULL)`, `description`
(markdown, nullable — optional lore shown on the Codex page), `created_at`, `updated_at`.
Unique **case-insensitive** on `(campaign_id, lower(name))` (functional unique index, or
`citext`) so `@[balrog]` and `@[Balrog]` don't fork.

**Reference model — by name (locked).** The token stores the entity's display *name*, not an
id, keeping `raw_notes` human-readable and clean for Gemini. `name` is therefore the stable
key that ties note text to an `entities` row.
- **Rename tradeoff:** renaming an entity on the Codex page does **not** retroactively rewrite
  existing `@[old name]` tokens in notes — they keep the old text until the note is edited.
  (A "rename & rewrite mentions across notes" helper is a possible later convenience — see
  roadmap Phase 7 stretch.)
- **Name constraints:** names may contain spaces but **not** `[` or `]` (they delimit the
  token). Enforced on create/rename.

**Mention grammar:** `@[` + name (`[^\[\]\n]+`) + `]`. A pure helper
`extract_mentions(text) -> set[str]` (regex, no DB/IO) is the single source of truth for
parsing, and is exhaustively unit-tested (spaces, adjacency, multiple per line, ignoring a
bare `@word` with no brackets and anything inside code spans/fences is a non-goal — keep it a
simple regex over the raw text).

**Lifecycle:**
- **Eager create (primary):** choosing *Create "Name"* in the `@` dropdown immediately
  `POST`s a new entity (group unset), so it's reusable in every other note at once. Create is
  **idempotent** — an existing (case-insensitive) name returns the existing row.
- **Save-time backfill (safety net):** on session create/update the server runs
  `extract_mentions(raw_notes)` and **inserts** any names not yet present (never deletes —
  removing a mention must not delete a curated, grouped entity). Covers pasted text and
  offline edits.
- Deleting an entity (Codex page) removes only the row; note text is untouched (a now-unknown
  `@[Name]` still renders as an emphasized mention and still searches — see §5).

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
    models/                 # SQLAlchemy: campaign.py, session.py, character.py, entity.py,
                            #   note_embedding.py (pgvector chunks)
    schemas/                # Pydantic v2 request/response models
    api/
      deps.py               # get_db, get_current_user
      routers/
        auth.py             # POST /api/auth/login  → JWT
        campaigns.py        # CRUD
        sessions.py         # CRUD (nested under campaign)
        characters.py       # CRUD (nested under campaign)
        search.py           # GET /api/search?q=
        entities.py         # entities + entity-groups CRUD (auto-registered)
        ai.py               # POST /api/sessions/{id}/summarize
        ask.py              # POST /api/campaigns/{id}/ask  (RAG Q&A)
        reference.py        # (planned Ph13/14) 5etools autocomplete/import + populate-from-class
    services/
      character_calc.py     # PURE derived-stat math (unit-tested)
      search.py             # Postgres FTS query builder
      entities.py           # PURE extract_mentions() + save-time backfill/upsert
      ai.py                 # Gemini client: summarize, embeddings, RAG answer
      rag.py                # PURE chunk_text() + index/retrieve/answer orchestration
      fivetools.py          # (planned Ph13/14) 5etools static-JSON loader + PURE entries/@tag
                            #   → Markdown renderer + schema normalizer (no API; data mounted)
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
- `GET/POST /api/campaigns/{id}/entities`, `GET/PUT/DELETE /api/entities/{id}`
  — `POST` is **idempotent** (existing name ⇒ existing row); `PUT` renames / reassigns
  `group_id` / edits `description`; `DELETE` removes the row only (note text untouched).
- `GET/POST /api/campaigns/{id}/entity-groups`, `GET/PUT/DELETE /api/entity-groups/{id}`
  — deleting a group sets member entities' `group_id` to `NULL` (they become ungrouped).
- `POST /api/sessions/{id}/summarize` → AI summary of the saved notes (Phase 4).
- `POST /api/campaigns/{id}/ask` → RAG answer over the campaign's notes, with citations
  (Phase 5). Body `{question}`; returns `{question, answer, citations[]}`. Maps errors to
  400 (blank question) / 503 (no key) / 502 (model error).

**Auth:** single set of credentials from env (`APP_USERNAME`, `APP_PASSWORD_HASH`,
`JWT_SECRET`). Login returns a JWT; all data routes require a valid bearer token.

On session create/update the `sessions` router calls `services/entities.reconcile_mentions`
(runs `extract_mentions` over the new `raw_notes`, insert-only upsert) so mentioned names
always exist as entity rows.

**Testing:** Pytest. Unit tests for `character_calc` (modifiers, prof bonus across levels,
saves/skills with/without proficiency, edge scores 1–30) and for `extract_mentions` (spaces,
adjacency, multiple/line, bare `@word` ignored, names with punctuation, `[`/`]` excluded).
Integration tests spin a test Postgres, use FastAPI `TestClient`, each test in a rolled-back
transaction — entities/groups CRUD, `POST` idempotency, group-delete → `NULL`, and the
save-time backfill (create a session with mentions ⇒ entities appear). Coverage gate in CI.

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
    sessions/      # list, markdown editor + preview (+ @-mention autocomplete)
    characters/    # 5E sheet (inputs for manual, read-only for derived); planned Ph8–14:
                   #   structured equipment/spells/features/attacks in modals, 5etools import
    workspace/     # side-by-side notes|character view (desktop)
    search/        # global search box + results
    entities/      # Codex page: entities grouped by user-defined group; group + entity CRUD
    ask/           # AI Q&A (RAG): question box + answer + citations; embedded as the notes
                   #   editor's "Ask" tab (campaign-scoped, not a separate route)
  shared/          # our own presentational bits: markdown-view, collapsible-pane,
                   #   confirm-dialog, mention-autocomplete (@ typeahead over a textarea)
```

- **@-mention autocomplete:** the note editor's `raw_notes` `<textarea>` gets a
  `MentionAutocomplete` directive (`shared/mention-autocomplete`). It watches the text before
  the caret for a `@fragment` token (regex `/@([^\[\]\n]*)$/`), shows a caret-anchored dropdown
  of the campaign's matching entities plus a *Create "fragment"* row, and on pick replaces the
  fragment with the `@[Name]` token (re-emitting `input` so the reactive form/CVA stays in
  sync). It takes the entity list as an input and emits `(create)` for eager creation; the
  editor `POST`s the new entity and appends it to the local list. Positioning uses a caret
  "mirror div" to get pixel coords; a plain absolutely-positioned `<ul>` in a
  `position: relative` wrapper keeps it dependency-free (**no new CDK** — the CDK allowance
  stays layout/`BreakpointObserver` only; revisit only if we adopt CDK Overlay).
- **Rendering mentions:** `MarkdownView` registers a `marked` **inline extension** that
  tokenizes `@[Name]` and renders it — with the `@` stripped — as
  `<a class="entity-mention" href="/search?q=<enc>"><strong><em>Name</em></strong></a>`
  (bold + italic). DOMPurify keeps `<a>`/`<strong>`/`<em>` + `class`/`href` (all default-safe).
  Because both the raw-notes preview and the AI-summary preview use `MarkdownView`, both get
  mention rendering for free. A delegated click handler on `MarkdownView` intercepts
  `a.entity-mention` clicks and does SPA navigation via `Router.navigateByUrl` (so it lands on
  the existing `/search?q=` page without a full reload).
- **Codex page (`features/entities`):** route `campaigns/:campaignId/entities`, reached from a
  "Codex" button in the workspace header. Lists entities bucketed by group (plus an "Ungrouped"
  bucket); create/rename/delete groups; create/rename/delete entities, edit an entity's
  `description`, and assign its group via a `<select>` (drag-drop between groups is optional
  polish and would pull in CDK DragDrop — deferred). Each entity links to `/search?q=Name`.
- **Models/services:** `core/api/models.ts` gains `Entity` + `EntityGroup`; a new
  `core/api/entity.service.ts` wraps the entities + entity-groups endpoints.

- **Markdown:** edit raw markdown; render preview with a sanitized lib (`ngx-markdown` /
  `marked` + DOMPurify).
- **Split-screen workspace (desktop only):** two-pane layout — notes | character — each
  pane independently collapsible to give the other full width, via Angular CDK. A
  `BreakpointObserver` detects desktop vs mobile.
- **Responsive:** mobile-first Tailwind utilities; on phones the split view degrades to
  tabbed/stacked navigation (notes and character as separate full-width screens).
- **Character overhaul UI (planned Ph8–14):** the sheet shows compact per-section summaries;
  each structured section (equipment, spells, features, attacks) opens a roomy **modal** (Zard
  `dialog`) via a shared "structured-list section" component — grouped/collapsible entries,
  add/edit/remove, in-modal search, and quantity/use/slot trackers. Structured-entry forms get
  a **5etools name autocomplete** (`/api/reference/search`, backed by a user-mounted 5etools JSON
  dataset) that imports full data; a "Populate from class" action reviews level-appropriate
  suggestions before applying.
- **E2E:** Playwright covers login → create campaign → add session → add character (verify a
  derived stat) → global search → split-view collapse/expand. Entities: type `@` in a note →
  dropdown → *Create* a new entity → token inserted → preview shows the name in bold+italic with
  no `@` → click navigates to `/search?q=…`; Codex page → create a group → assign an entity → it
  appears under that group. Ask (RAG): open the notes editor's "Ask" tab → ask a question → with
  no key configured, a graceful "not configured" message (503) rather than a crash.

---

## 5. Search

**MVP:** PostgreSQL full-text search. A generated `search_vector tsvector` on `sessions`
(weighted: title > summary > raw_notes), GIN-indexed. `/api/search` runs
`websearch_to_tsquery`, ranks with `ts_rank`, returns snippet + session/campaign refs; also
matches character names. Optionally scoped to a campaign.

**Entity mentions reuse search unchanged.** Clicking a `@[Name]` mention navigates to
`/search?q=Name`. No backend change is needed: `search_vector` tokenizes `raw_notes`, and the
`@[…]` punctuation splits off, so the bare name (`gandalf`) is already an indexed lexeme —
every session that mentions the entity is found by the existing FTS. (Optional later polish:
strip the `@[]` syntax from `ts_headline` snippets so highlights read cleanly, and/or add an
`entity` result `type` that links to the Codex — deferred; the plain search route is enough.)

**AI Q&A (Phase 5 — implemented, RAG).** `note_embeddings` (`pgvector`) holds chunked,
embedded notes (§2). Flow:
- **Chunking** (`services/rag.chunk_text`, pure): notes split into ~1200-char chunks by
  paragraph, over-long paragraphs hard-split with overlap.
- **Embedding** (`services/ai.embed_texts`): Gemini `gemini-embedding-001`, 768-dim
  (`output_dimensionality`); documents use `RETRIEVAL_DOCUMENT`, the question `RETRIEVAL_QUERY`.
- **Indexing:** on session create/update the sessions router calls
  `rag.reindex_session_safe` — **best-effort**, so a missing/failing key never blocks a save.
  At ask time, `ensure_campaign_indexed` back-fills any not-yet-embedded sessions (bootstraps
  notes written before the key existed).
- **Retrieval + answer** (`POST /api/campaigns/{id}/ask`): embed the question, retrieve the
  top-K nearest chunks for the campaign (HNSW cosine distance), feed them to Gemini
  (`answer_question`) under a "answer only from these excerpts, cite inline" system prompt, and
  return the answer plus one **citation per source session** (best-ranked chunk → title +
  snippet). Same DB engine, no new infra — just the `pgvector` extension/image.

Cosine distance is scale-invariant, so the Matryoshka-truncated 768-dim vectors need no manual
normalization. Errors map to 503 (no key) / 502 (model). Herald surfaces this as an **"Ask" tab
in the notes editor** (alongside Write/Preview/Summary) — the `Ask` component renders the answer
as Markdown and links each citation to the workspace deep-link (`?session=<id>`). `Ask` is
campaign-scoped and embedded (no separate route); it uses a `[formGroup]` div rather than a
`<form>` so it nests validly inside the editor's session form.

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
