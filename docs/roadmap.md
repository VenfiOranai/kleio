# Kleio — Roadmap

Incremental delivery. Each phase is independently shippable; the deploy pipeline goes up
early (Phase 1) so every later phase ships continuously.

---

## Phase 0 — Scaffolding & foundations
- `git init`; monorepo layout; `docs/` + `README.md`.
- **Oracle** (FastAPI) skeleton + **Herald** (Angular) skeleton + local
  `infra/docker-compose.yml` (Postgres).
- Single-user JWT auth (Oracle + Herald login / guard / interceptor).
- `ci.yml` running lint + tests on PRs.

## Phase 1 — Core data + CRUD (MVP) + deploy pipeline
- Models / schemas / migrations for Campaign, Session, Character.
- CRUD endpoints + Pytest unit (`character_calc`) and integration tests.
- Herald: campaign list/detail, session list + **markdown editor/preview**, character
  sheet with manual inputs and read-only **derived** stats.
- `deploy.yml` + prod compose + nginx; first real deploy to EC2 with HTTPS.

## Phase 2 — Workspace UI: split screen + responsive
- Desktop side-by-side notes | character workspace with collapse / fullscreen per pane.
- Mobile tabbed/stacked layout; verify breakpoints.
- Playwright e2e for core flows.

## Phase 3 — Global search
- `search_vector` + GIN; `/api/search`; Angular global search box + results page.

## Phase 4 — AI summarization (Gemini)
- `services/ai.py` Gemini wrapper; per-session "Summarize" action: raw notes → readable
  markdown `summary` (raw always preserved; summary editable). Tests mock the API.

## Phase 5 — AI Q&A over notes (RAG)
- `pgvector` + `note_embeddings`; embed on save; `/api/campaigns/{id}/ask` retrieval +
  Gemini answer **with citations**; Angular "Ask" UI.

## Phase 6 — Polish & hardening (ongoing)
- Automated `pg_dump` backups; rate-limit / login lockout; error monitoring; export
  campaign to markdown; dice-roller / encounter helpers (optional stretch).

## Phase 7 — Entities & mentions ("Codex")
Tag important words (names, places, factions, items) inside notes and manage them per campaign.
Independent of the AI phases; needs only Phase 1 (notes/CRUD) and Phase 3 (search) in place.

**Step 1 — inline `@`-mentions.**
- Oracle: `entity` + `entity_group` models + migration; `services/entities.py`
  (**pure** `extract_mentions`, plus insert-only `reconcile_mentions`); auto-registered
  `entities.py` router (entities + entity-groups CRUD; `POST` entity idempotent); wire the
  save-time backfill into the sessions router. Unit-test `extract_mentions`; integration-test
  CRUD + backfill.
- Herald: `@` typeahead over the notes `<textarea>` (`shared/mention-autocomplete`) with
  eager *Create "…"*; store `@[Name]` in `raw_notes`; `MarkdownView` `marked` extension renders
  `@[Name]` as bold+italic (no `@`) linking to `/search?q=Name` (SPA-nav on click). Reuses the
  existing search page unchanged.

**Step 2 — the Codex page.**
- Herald `features/entities` at `campaigns/:campaignId/entities` (from a "Codex" button in the
  workspace): entities bucketed by **user-defined groups** (+ an "Ungrouped" bucket); create /
  rename / delete groups and entities; edit an entity `description`; assign group via a
  `<select>`. Each entity links to its search.

**Stretch:** "rename entity & rewrite its `@[old]` mentions across notes" helper; drag-drop
group assignment (CDK DragDrop); an `entity` search-result type; strip `@[]` from search
snippets.

---

## Character Sheet Overhaul (Phases 8–14)

Turn the character sheet's freeform `equipment` / `spells` / `features` **text blobs** into
**structured, trackable data**, add the derived combat stats a real sheet shows, an attacks
panel, and **5etools** reference auto-import. (Maps the eight requested items — annotated
`feat. N` below.)

**Locked design decisions (apply to the whole epic):**
- **Storage = JSONB on `characters`.** Structured lists (items, spells, features, attacks,
  currency, other proficiencies, spell slots) are JSONB columns on the existing single
  `characters` table — consistent with today's `saving_throw_proficiencies` / `skill_proficiencies`
  lists. One table, no joins, no per-row routers. Pydantic models validate each element's shape.
- **Derived stays computed, never stored.** New derived values (spell attack bonus, spell save
  DC, per-attack to-hit/damage, carry weight) live in the **pure** `character_calc` and ship in
  the API `derived` block — same rule as ability mods/saves today. The backend is authoritative.
- **Migrations preserve the old blobs.** Each blob→structured migration keeps the existing text
  as a section-level freeform `notes` field (or a single seed entry) so nothing is lost.
- **5etools reference import is additive & optional.** Import only ever *fills* a structured
  entry the user can still edit; the sheet works fully without it.
  - **Source = 5etools static JSON, not an API.** 5etools has no API; its data is a set of
    JSON files split by source (`data/spells/spells-<src>.json` indexed by `spells/index.json`,
    `data/class/class-<name>.json`, `items.json` + `items-base.json` + `magicvariants.json`,
    `races.json`, `backgrounds.json`, `feats.json`, `optionalfeatures.json`, …). The oracle
    reads these files from a **configured local directory**, loads/indexes them on startup, and
    parses them on demand.
  - **The data is user-supplied — never bundled or redistributed.** The 5etools dataset is
    verbatim, WotC-copyrighted content (not SRD/OGL; the mirror repo was DMCA'd by WotC in 2024).
    So Kleio ships **no** game data: the user points `FIVETOOLS_DATA_DIR` at their own copy
    (a mounted volume). If the dir is unset/absent, reference import is simply disabled. This is
    a **personal, single-user** convenience, not content redistribution.
  - **A parser/renderer is the core work.** 5etools JSON uses nested `entries` arrays (strings +
    typed `entries`/`list`/`table` objects) and `{@tag name|source|display}` inline markup
    (`{@spell}`, `{@dice}`, `{@damage}`, `{@condition}`, `{@item}`, …). A **pure** module renders
    `entries` → Markdown and resolves/strips the tags (e.g. `{@dice 1d6}`→`1d6`,
    `{@condition prone}`→`prone`), and normalizes each 5etools object into our item/spell/feature
    schema (items must be assembled from `items` + `items-base` + `magicvariants`). Exhaustively
    unit-tested against sample fixtures.

### Phase 8 — Structured basics & spellcasting stats  (feat. 6, 7, 8) ✅ done
Small, high-value additions that need no big refactor; they establish patterns for later phases.
- **Oracle:** **spellcasting ability is derived from class, not stored** (keeps the "computed,
  never stored" rule). A **pure** `character_calc.spellcasting_ability_for_class(class_name,
  subclass)` returns the fixed 5E ability — Artificer/Wizard→INT, Cleric/Druid/Ranger→WIS,
  Bard/Paladin/Sorcerer/Warlock→CHA, Fighter/Rogue→INT only via Eldritch Knight / Arcane Trickster,
  else none (unknown/homebrew → none). `character_calc` gains **spell attack bonus** =
  mod(spellcasting) + prof and **spell save DC** = 8 + mod + prof (both `null` when the class isn't
  a caster), plus the resolved `spellcasting_ability`, surfaced in `derived` *(feat. 8)*. Add
  `currency` JSONB `{cp,sp,ep,gp,pp}` *(feat. 7)* and `other_proficiencies` JSONB — a categorized
  list (`language` / `weapon` / `armor` / `tool` / `other`) *(feat. 6)*. Migration + schema + unit
  tests for the new math.
- **Herald:** a money row (5 coin inputs) and a misc-proficiencies section **split by category**
  (chips you add/remove per category). The **Spellcasting** panel is fully read-only — ability +
  **DC / attack** come from `derived` and update from the class field (no selector).

### Phase 9 — Structured equipment + item modal  (feat. 1) ✅ done
Introduces the reusable **structured-list section** + a **modal** used by Phases 10–12.
- **Oracle:** `equipment` → JSONB list of items `{name, quantity, category, weight?, equipped?,
  attuned?, description(md)}`. Preset categories (Weapons, Armor, Gear, Consumables, Treasure,
  Other) plus custom. Derived **total weight**, **carrying capacity** (STR × 15), an **encumbered**
  flag, and **attunement count** (max 3) in the pure `character_calc`. Migration preserves the old
  text as a single seed item.
- **Herald:** an **Equipment modal** — a roomy, full view of items **grouped by category**, with
  add/edit/remove, quantity steppers, equipped/attuned toggles, collapsible categories, and
  in-modal search + equipped-only filter. The sheet shows a compact summary + "Open equipment".
  QoL: duplicate item, attunement readout. *(Built on a dependency-free `shared/modal` native
  `<dialog>` — not Zard `dialog`, which pulls in CDK Overlay/Portal that the project reserves for
  layout only.)*

### Phase 10 — Spell tracking (slots & prepared)  (feat. 2)
- **Oracle:** `spells` → JSONB list `{name, level 0–9, school, prepared, always_prepared, ritual,
  concentration, casting_time, range, components, duration, description(md)}`; `spell_slots`
  JSONB per level `{total, expended}` (manual now, auto-from-class in Phase 14). Migration
  preserves old text.
- **Herald:** a **Spells modal** — spells grouped by level (cantrips separate), per-level **slot
  trackers** (dots/steppers for expended vs total), prepared toggles, and filters (prepared-only,
  ritual, by level). A spellcasting header reuses Phase 8's ability / DC / attack. QoL: "cast"
  decrements a slot, concentration indicator, rest-reset *(stretch)*.

### Phase 11 — Structured features & traits  (feat. 3)
- **Oracle:** `features` → JSONB list `{name, source (class|subclass|race|background|feat|other),
  level?, uses?{max, expended, recharge (short|long|other)}, description(md)}`. Migration
  preserves old text.
- **Herald:** a **Features modal** grouped by source, with **limited-use trackers** (e.g. Rage
  3/long rest as dots/steppers), collapse, and filter. Compact summary on the sheet.

### Phase 12 — Attacks panel  (feat. 4)
A combat "Attacks & Spellcasting" panel like a standard sheet.
- **Oracle:** `attacks` JSONB list `{name, ability (str|dex|spellcasting), proficient,
  damage_dice, damage_type, bonus?, range, notes, source (weapon|spell|manual)}`. `character_calc`
  computes each attack's **to-hit** (mod + prof-if-proficient + bonus) and **damage string** (dice
  + mod) into `derived`. Attacks are an explicit list (not silently derived from equipment) for
  control; an "add from weapon/spell" helper pre-fills from a Phase 9 weapon or Phase 10 spell.
- **Herald:** an attacks **table** (name · to-hit · damage · range · notes) on the sheet, edited
  via the modal, with the quick "add from weapon/spell" action. *(Depends on 8, 9, 10.)*

### Phase 13 — 5etools import, Stage 1: autocomplete + full import  (feat. 5a)
- **Oracle:** `services/fivetools.py` — loads the 5etools JSON from `FIVETOOLS_DATA_DIR`
  (spells via `spells/index.json` → `spells-<src>.json`; `items.json` + `items-base.json` +
  `magicvariants.json` assembled; `feats.json`; `optionalfeatures.json`) and builds a
  **searchable in-memory index** (name + type + source). A **pure** `render.py` sub-module turns
  5etools `entries` arrays + `{@tag}` markup into Markdown and normalizes each object into our
  item / spell / feature schema. Config gains `fivetools_data_dir`; if unset, the endpoints
  return 503 (reference import unavailable) and the sheet still works. Auto-registered
  `api/routers/reference.py`: `GET /api/reference/search?type=&q=` (autocomplete over the index)
  and `GET /api/reference/{type}/{id}` (full normalized record). Unit-test the renderer/normalizer
  against small JSON fixtures (tags stripped, entries → Markdown, item assembly).
- **Herald:** the structured-entry forms (spell / item / feature) get a **name autocomplete**
  backed by `/api/reference/search`; picking a result **imports the full data** into the entry,
  still fully editable. Manual entry always remains; when reference import is unavailable it's
  simply hidden.

### Phase 14 — 5etools import, Stage 2: auto-populate by class/subclass/level  (feat. 5b)
- **Oracle:** extend `fivetools.py` to parse `class/class-<name>.json` — its `classFeature` /
  `subclassFeature` entries (ordered by level), starting **proficiencies**, and the
  **spellcasting** progression / **slot** table (`classTableGroups`, `casterProgression`,
  `spellcastingAbility`); plus `races.json` / `backgrounds.json` for their traits. A function
  returns, for a class/subclass/level, the level-appropriate **class features**, **proficiencies**,
  **spell options**, and **slot totals**. `POST /api/characters/{id}/populate` returns *suggested*
  additions (never auto-writes). (Richer than an SRD API would be — the full class progression is
  in the data.)
- **Herald:** a "Populate from class" action → a **review dialog** of suggested features /
  proficiencies / slots → apply the selected ones (skips already-present; never clobbers manual
  edits). Most complex; depends on 13 + all structured sections.

---

## Verification — "done" per phase

- **Oracle (backend):** `pytest` (unit + integration) green locally and in CI;
  `alembic upgrade head` applies cleanly on a fresh DB.
- **Character math:** unit tests assert known 5E values (e.g. STR 16 → +3; level 5 → prof +3;
  proficient DEX save = DEX mod + 3; passive perception = 10 + perception).
- **Herald (frontend):** `ng build` succeeds; Playwright e2e green (login → CRUD → derived
  stat → search → split-pane collapse).
- **Deploy:** push to `main` → GitHub Actions deploys → app reachable over HTTPS on EC2;
  data survives a redeploy (volume persists).
- **AI phases:** summarize produces a coherent summary while `raw_notes` is unchanged; ask
  returns an answer citing the correct source session(s).
- **Entities:** typing `@` offers existing entities + *Create*; `raw_notes` stores `@[Name]`;
  the preview shows it bold+italic without the `@` and clicking it lands on `/search?q=Name`;
  a mention typed in a note shows up (ungrouped) on the Codex page and can be assigned a group;
  deleting an entity leaves note text intact. `extract_mentions` unit tests green.
- **Character overhaul:** structured items / spells / features round-trip through their JSONB
  columns; each blob→structured migration applies cleanly on a fresh DB and preserves the old
  text. `character_calc` unit tests assert **spell save DC = 8 + prof + spellcasting mod** and
  **spell attack = prof + mod** across abilities/levels, and per-attack to-hit/damage. The
  attacks panel shows correct to-hit for a proficient weapon; the spells modal decrements a slot;
  the 5etools renderer strips `{@tag}`s + turns `entries` into Markdown (unit fixtures), and
  autocomplete imports a full spell's data when `FIVETOOLS_DATA_DIR` is set (Stage 1); "populate
  from class" suggests level-appropriate features without clobbering manual edits (Stage 2).

---

## Dependency notes
- Phases 0–1 are foundational and sequential.
- Phases 2 and 3 are independent of each other (can be done in either order after Phase 1).
- Phase 4 (summarization) should precede Phase 5 (Q&A): both need the Gemini client and the
  AI infra (`services/ai.py`, API key handling).
- Phase 7 (Entities/Codex) is independent of the AI phases — it only needs Phases 1 and 3, so
  it can slot in any time after search lands, before or after Phases 4–6.
- **Character Sheet Overhaul (8–14)** is independent of the notes/AI/entities phases (touches
  only the character model, `character_calc`, and the character-sheet UI). Internal order:
  Phase 8 is foundational (its spellcasting derived feeds 10 + 12); Phase 9 introduces the
  structured-list + modal pattern that 10 / 11 / 12 reuse; 12 (attacks) needs 8 + 9 + 10; 13
  (5etools autocomplete) needs the target schemas from 9–11; 14 (auto-populate) needs 13 + all
  structured sections. Phases 9, 10, 11 are otherwise independent of each other once 9 lands.
