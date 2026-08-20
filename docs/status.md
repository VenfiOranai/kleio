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
preview. Summarization has **no manual trigger** — `save()` persists first (so the save always lands
and is reported), then chains `/summarize` when the notes are non-empty, showing a "Summarizing…"
indicator and a graceful error line if the AI step fails. e2e `ai.spec.ts` covers
summary-editing/persistence and the not-configured error path.

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

### Phase 12 — attacks panel
**Oracle:** `characters` gains a brand-new `attacks` JSONB list `{name, ability (str|dex|spellcasting),
proficient, damage_dice, damage_type, bonus?, range, notes, source (weapon|spell|manual)}` via the
purely-additive migration `5e1f2a3b4c6d` (no prior freeform field to preserve). `character_calc` gains a
**pure** `attack_stats()` that computes each attack's **to-hit** (ability mod + prof-if-proficient +
flat `bonus`) and **damage string** (dice + ability mod, e.g. `1d8 + 3` — the flat `bonus` is to-hit
only, per a standard sheet); the governing ability is STR, DEX, or the class's derived spellcasting
ability (0 for a non-caster). A spell's casting mod is **to-hit only** by default — STR/DEX attacks
always add their mod to damage, while `ability: "spellcasting"` rows add it only when the opt-in
`spell_mod_damage` flag is set (agonizing blast and friends). `compute_derived` takes `attacks` and
returns a parallel `attacks` list of `{name, to_hit, damage}` in the `derived` block. Schemas: `Attack`
(Literal-validated `ability`/`source`, `bonus` nullable, `spell_mod_damage` defaulting false) +
`AttackDerived`; `DerivedStats.attacks`. Unit tests (proficient/non-proficient, finesse DEX,
spellcasting + negative mod, spell-mod-damage on/ignored for weapons, zero-mod damage, derived
round-trip) + integration round-trip (to-hit +7 for a proficient +1 weapon; invalid ability → 422).

**Herald:** an **`AttacksModal`** (`features/characters/attacks-modal`): a flat editable list with
add/duplicate/remove, ability `<select>` (STR/DEX/Spell), proficient toggle, a **"Spell mod to damage"**
checkbox that only appears for Spell-ability rows (off by default), damage-dice/type, flat
to-hit `bonus`, range, notes, a name search, and **"Add from weapon/spell"** `<select>`s that pre-fill a
row from a Phase 9 weapon (equipment whose category mentions "weapon") or a Phase 10 spell (spellcasting
ability, spell source). Working copy keyed by transient `_id`, emits `attacks` on every change. The sheet
shows an **attacks table** (name · to-hit · damage · range · notes) whose to-hit/damage come from the
server `derived` (zipped by index; refresh on save) plus an "Open attacks" button; `attacks` rides along
in Save. e2e attacks test (7 specs green).

## Session ordering by date
Sessions are now chronological instead of insertion-ordered. **Oracle:** `list_sessions` orders by
`session_date DESC NULLS LAST, created_at DESC` (`order_index` is no longer used for sessions);
integration test covers the ordering incl. undated sessions. **Herald:** the workspace stamps new
sessions with today's **local** date on create, and mirrors the oracle's ordering client-side
(`sortSessions` in `workspace.ts`) so an edit re-sorts the picker without a re-fetch — the embedded
`SessionEditor` gained an `updated` output (emitted on save, alongside `deleted`) that the workspace
folds into its list, so a renamed/re-dated session immediately changes label **and** position. The
picker's `<option>`s bind `[selected]` as well (reordering moves the option nodes, which otherwise
resets the browser's selection). e2e `session.spec.ts` covers today-default + re-sort on save.

## Character JSON view (environment migration)
Moving a character between environments (local → dev → prod) needed no import format: the sheet can
now be edited as **raw JSON** and pasted anywhere. A **JSON** toggle sits next to Delete/Save (off by
default) and swaps the sheet for a textarea holding the whole editable character.

**Herald only** — no oracle change; the document is exactly the payload Save already sent. The
serializer/parser is a **pure** module (`features/characters/character-json.ts`), unit-tested like
`character_calc`: `draftToJson` emits the `CharacterDraft` (= `Character` minus `id`, `campaign_id`,
timestamps and `derived`) with keys in sheet order, so two environments diff cleanly;
`parseCharacterDraft` **merges over the current draft** (a partial paste patches rather than wipes),
type-checks scalars, tolerates numeric strings, silently ignores the server-owned keys so a raw
`GET /api/characters/{id}` body pastes in, and **reports** unknown keys (catching `strenght`) plus
every type error in one message. List entries pass through — the backend stays the authority on shape.

The two views stay consistent **in memory**, without a save in between: toggling on re-serializes the
live form + section signals, toggling off parses and pushes back onto them (`applyDraft`). A parse
error blocks the toggle (and blocks Save) with the message shown under the editor, so an edit is never
silently dropped. Saving from the JSON view applies the text first, then re-serializes from the
response so the document shows what was actually stored. The sheet is **hidden, not destroyed** behind
the editor (`contents`/`hidden`), so collapse state, scroll position and the section modals survive
toggling. Component spec drives the toggle through the DOM (both sync directions, repeated
round-trips, bad-JSON handling, save payload); e2e `character.spec.ts` covers the same flow end to end.

## Spells preview (slot usage + spell list)
The sheet's spells block was a bare count; it now mirrors the equipment preview. **Herald only** — no
oracle or schema change; slot edits ride along in the existing Save payload.

**Slot usage is editable from the sheet.** Each level that carries slots gets the modal's dot tracker
(clickable, available-first) plus an `available/total` readout, and the summary reads
`Slots {available}/{total}`. **Totals stay modal-only** — the sheet spends and restores, it doesn't
re-budget. The dot maths moved into a **pure**, unit-tested `features/characters/spell-slots.ts`
(`slotDots`, `toggleSlotDot`, `clampExpended`) shared by both trackers; extracting it fixed a
pre-existing bug in the modal, where `slotDots` rendered expended dots first while `toggleDot` computed
against available-first ordering, so clicking a dot moved the count the wrong way.

**Spells are listed, not just counted.** The section collapses as a whole (like Equipment/Attacks) and
again per level — Cantrips first, then 1→9, alphabetical within a level, each header showing its count.
Expanded, a level shows **names only**; hovering a name opens a popover with the spell's full data
(level · school, casting time, range, components, duration, prepared/ritual/concentration tags, and the
Markdown description), and clicking the name pins it open (see *Pinnable popovers* below). The popover
is clamped back on screen after render by a shared `clampToViewport()` helper used by the attack
tooltip too. Component specs cover grouping/ordering, per-level collapse, the hover popover, pinning,
and expend/restore incl. the saved `spell_slots` payload.

## Features & traits preview (grouping + use tracking)
The features block listed every feature as one flat run of chips; it now mirrors the spells preview.
**Herald only** — no oracle or schema change; use edits ride along in the existing Save payload.

**Grouped by source, ordered by level.** The section collapses as a whole and again per source
(Class → Subclass → Race → Background → Feat → Other, each header showing its count); within a group
features sort by the level they were gained at, lowest first, with unleveled ones last and ties broken
by name. Grouping/ordering lives in a **pure**, unit-tested `features/characters/features.ts`
(`groupFeaturesBySource`, `SOURCE_LABELS`) now shared with the features modal, so the two views list
features in the same order. An unrecognised `source` (reachable by pasting through the JSON view)
buckets last under its raw name rather than disappearing off the sheet.

**Limited uses are trackable from the sheet.** Above the list, every feature with a `uses` pool gets
the modal's dot tracker (clickable, available-first) plus an `available/max · recharge` readout.
**Max and recharge stay modal-only** — the sheet spends and restores, it doesn't re-budget. The dot
maths delegates to `spell-slots.ts` (`useDots`/`toggleUseDot` wrap `slotDots`/`toggleSlotDot`, whose
params widened to a `{total, expended}` pool); sharing it fixed the same rendering bug the spells modal
had — the features modal drew expended dots first while its click handler computed against
available-first ordering, so a click moved the count the wrong way.

**Names carry their details on hover.** Expanded, a group shows **names only**; hovering one opens a
popover with source · level, the uses/recharge line, and the Markdown description, clamped back on
screen by the shared `clampToViewport()` helper, and clicking the name pins it open (see *Pinnable
popovers* below). Specs cover the pure module (grouping, level ordering, unknown sources, dot maths,
recharge wording) and the component (grouping/ordering, per-source collapse, the hover popover,
pinning, and expend incl. the saved `features` payload).

## Pinnable popovers (equipment + spells + features)
A description longer than the popover's `max-h-[60vh]` scrolls inside it — but it was unreachable:
the popover is `pointer-events-none` (it has to be, or it steals the hover from the chip it's anchored
to), so the moment the pointer left the chip, `mouseleave` closed it. **Clicking a chip now pins its
popover:** it survives `mouseleave`, drops `pointer-events-none` so it can be scrolled and clicked
through (a `ring-2` marks it pinned), and other chips stop stealing it on hover. It closes on a click
anywhere outside its own contents, on Escape, on a second click of the same chip, or when its
section/group collapses.

The state machine lives in one place, `features/characters/popover.ts` — a `PinnablePopover<T>`
holding the signal (`show`/`hide`/`pin`/`unpin`/`close`/`closeIfOutside`), plus the `clampToViewport()`
helper lifted out of the component. `CharacterSheet` owns one instance per section (`itemPopover`,
`spellPopover`, `featurePopover`) and wires them to two host listeners, `(document:click)` and
`(document:keydown.escape)`; the outside-click check skips the popover's own element **and its
anchor**, so the click that pins it doesn't immediately close it. Chip names became `<button>`s, so
pinning is keyboard-reachable.

The equipment popover joined last and brought two wrinkles: only items **with a description** have
anything to show, so its instance takes the optional `opensFor` predicate (which gates hover *and*
pin) and its chips render `[disabled]` when empty — inert and unfocusable, and Tailwind's preflight
(`color: inherit`, `opacity: 1` on buttons) keeps them looking exactly like the plain chips they
replaced. It was also the one popover with no `max-h`/`overflow` and no clamping, so it now matches
the other two. `popover.spec.ts` unit-tests the state machine (hover vs. pin precedence, re-pinning,
click-inside/outside, `opensFor`, unpin), on top of per-section component specs and e2e coverage of
the equipment + spells popovers.

## Markdown editor (all Markdown inputs)
Every Markdown field was a bare `<textarea>`: no formatting help, and preview only where a host
happened to render one. They all now use one component, **`shared/markdown-editor`**
(`app-markdown-editor`) — session notes and summary, entity descriptions on the Codex,
equipment/spell/feature/attack descriptions in the character modals, and the character's freeform
notes.

**Why no package.** Nothing off the shelf fits: the Angular Markdown editors are stale (Material-era,
none built for Angular 22), and the framework-agnostic ones (EasyMDE, ToastUI) swap the textarea for
CodeMirror/ProseMirror — which would break the `@[Name]` typeahead (it measures a real textarea's
caret via `caret-coordinates.ts`), bypass the `marked` + DOMPurify pipeline with our custom mention
extension, and drag in their own CSS to fight with Tailwind/dark mode. The editor is deliberately
**not** WYSIWYG: `raw_notes` stays the canonical text the user typed.

**What it is.** A plain textarea, plus:
- a toolbar in four groups — bold / italic / strikethrough / inline code · H1–H3 · bullet, numbered
  and task lists + quote · link, table, code block, rule (lucide icons, `mousedown` swallowed so the
  textarea keeps its selection);
- Ctrl/Cmd + **B**, **I**, **E**, **K** shortcuts (the tooltip shows `⌘` on Mac);
- a **Write/Preview** toggle rendering through the existing `app-markdown-view`, so mentions,
  tooltips and styling are identical to the read-only views. It's labelled "Toggle preview" so it
  can't be confused with a host's own Preview tab;
- the `@`-mention typeahead, moved here wholesale from `shared/mention-textarea` (now deleted) and
  gated behind `[mentions]="true"` — descriptions don't tag entities.

**The transforms are pure.** `markdown-commands.ts` exports `applyCommand(state, command)` over
`{value, selectionStart, selectionEnd}` — no DOM — so wrapping, unwrapping, list renumbering and
block insertion are exhaustively unit-tested (23 cases, written with `‸`/`‹…›` markers so the
expected text and selection read as one line). The fiddly parts it pins down: italic **nests** inside
bold rather than eating one asterisk (`**x**` → `***x***`); list styles **replace** one another
instead of stacking, and a task item counts as a task, not a bullet; quotes stack but never double
up; toggling a prefix off requires *every* non-blank line to have it; blank lines inside a selection
are left alone; a collapsed caret keeps its distance from the end of its line as prefixes change; and
tables/rules land **after** the current line so they can't overwrite a selection (the code fence is
the deliberate exception — it swallows the selection).

**Wiring.** It's a `ControlValueAccessor` (`formControlName`, as in the session form and the sheet)
and also takes `[value]` + `(valueChange)` for the modals that edit JSONB rows in place, plus
`(commit)` — the value at blur — for the Codex, where each save is a PATCH. `[preview]="false"`
turns the toggle off for session notes, which already sit beside (or tab with) a Preview pane; that
pane's separate summary `markdown-view` was dropped in favour of the editor's own toggle.

Two DOM gotchas are handled in the component: a static `placeholder="…"` in a host template feeds the
input *and* stays on the host element, so it strips `placeholder`/`arialabel` from itself via host
bindings (otherwise a placeholder lookup matches twice); and it must not be wrapped in a `<label>`,
since `<button>` is labelable and the label would bind to the first toolbar button instead of the
textarea (fixed in the attacks modal and the sheet's notes field).

`markdown-view.css` gained the styles the new buttons can now produce: GFM tables (scrolling inside
the note rather than stretching the pane), task-list checkboxes, and `<del>`.

E2E updated for the new markup (`app-markdown-editor textarea`), with a new spec covering the toolbar
end to end: bolding a selection, Ctrl+I nesting into it, a table landing below the line, and the
summary editor's preview toggle.

## Phase 13 — 5etools reference import (browse + import)
Structured entries no longer have to be typed from the book. Each section modal gained a **Browse**
button that opens the reference index and imports a full, still-editable entry.

**The dataset is yours, not ours.** 5etools has no API and its JSON is verbatim WotC-copyrighted
content, so Kleio bundles and commits **none** of it. Two ways to have one, and the sheet works
without either: point `FIVETOOLS_DATA_DIR` at your own copy (the repo root or its `data/` dir — both
are accepted; in Docker, mount it read-only), or press **Download reference data** on the campaigns
page. With neither, the whole feature is invisible: `GET /api/reference/status` answers
`available: false`, the data routes return 503, and herald hides every Browse button. Tests run
against a miniature stand-in dataset in `oracle/tests/fixtures/fivetools` (three spells, six base
items, three magic items, two variants, two feats, two optional features).

**The download** (`fetch.py`, `POST /api/reference/fetch`, mirrored by
`scripts/fetch_fivetools.py` for a headless box) walks `spells/index.json` → the per-source spell
files, plus the item/feat files, from `FIVETOOLS_SOURCE_URL` (default `https://5e.tools/data`) into
`FIVETOOLS_DOWNLOAD_DIR` (`oracle/var/fivetools`, gitignored; a `fivetools` volume in compose so it
survives redeploys). It is a **background job, deliberately not part of startup**: it depends on a
third party over undocumented paths, so it should fail loudly once where you can see it rather than
re-downloading — and silently failing — on every boot. Each file is validated as JSON before being
saved (a site that 200s an HTML shell for unknown paths would otherwise poison the dataset) and
written via a `.part` temp file; optional files absent from older datasets are skipped, a missing
*required* one fails the job. Finishing invalidates the load-once index so the new data is picked up
without a restart. `POST` is refused with a 409 while one is running, and when `FIVETOOLS_DATA_DIR`
is set — downloading then would write files the index would never read. The dest is server-side
config only; the client never names a path.

**Herald's setup card** (`features/reference/reference-data-card`, on the campaigns page) shows what's
loaded ("936 spells · 9,524 items · 489 feats & features"), offers the download, polls the job every
1.5s with a progress bar, and refreshes the app's reference status when it lands. A download already
running when the page loads is picked back up. When `FIVETOOLS_DATA_DIR` is set it explains that
instead of offering a button.

**Loaded once, not per request.** `services/fivetools/index.py` parses `spells/index.json` →
`spells-<src>.json` (+ the newer `spells/sources.json` for the spell→class mapping), `items.json` +
`items-base.json` + `magicvariants.json`, `feats.json` and `optionalfeatures.json` into one in-memory
index, cached for the process (`lru_cache` on the resolved directory, behind a lock). `main.lifespan`
warms it in a daemon thread, so startup stays instant and the first Browse doesn't pay the parse.
Entries are stored **raw** alongside cheap facets (level/school/classes, category/rarity/value/weight,
kind…); the expensive part — rendering `entries` into Markdown — happens per record when one is
opened or imported.

**Two pure transform modules**, split from the loader exactly the way `character_calc` is split from
its routers, and unit-tested against JSON fixtures:
- `render.py` resolves `{@tag}` markup (`{@damage 1d10}` → `1d10`, `{@spell fireball|phb|a fireball}`
  → `a fireball`, `{@dc 15}` → `DC 15`, `{@i x}` → `*x*`, nested tags innermost-first, unknown tags
  degrade to their first argument) and renders nested `entries` arrays — named entries, lists,
  tables, quotes/insets — as Markdown.
- `normalize.py` maps a 5etools object onto our own schemas: spells (school codes, casting time,
  range incl. shaped areas, components, duration, "At Higher Levels" unwrapped from its heading),
  items (bucketed into the sheet's preset categories, description = italic type/rarity header +
  bulleted stat line + prose), feats/optional features (with a readable *Prerequisite:* line), and a
  ready-to-add **Attack** row for weapons (finesse/ranged ⇒ DEX, damage dice/type, `+N` from a magic
  variant). It also does the two assembly jobs 5etools leaves to the client: `_copy` inheritance, and
  crossing `magicvariants.json` with matching base items (`requires`/`excludes`, name prefixes, and
  `{=field}` templating) so "+1 Longsword" is a thing you can search for.

**API** (`api/routers/reference.py`, auto-registered, DB-free, auth-protected): `GET /status` (always
200 — "unavailable" is an answer, not an error), `GET /facets?type=` (the filter values the loaded
dataset actually holds, plus its valid sorts), `GET /search?type=&q=&sort=&direction=&limit=&offset=`
plus per-type filters (`level` repeatable, `school`, `class`, `ritual`, `concentration`, `category`,
`rarity`, `attunement`, `weapons_only`, `kind`), and `GET /{type}/{id}` for the full normalized
record. Default sort is **relevance** — prefix matches, then word-start matches, then the rest,
alphabetical within each — because "fire" should find *Fire Bolt* before *Wall of Fire*.

**One modal for every section.** `characters/reference-modal` is opened as `open(type, options)` by
whichever section wants it: equipment (`item`), spells (`spell`), features (`feature`), and attacks
(`item` + `weaponsOnly`, titled "Browse weapons"). It renders the search box, the filters that make
sense for that type, a sort select + direction toggle, and rows of *name · subtitle · source*;
clicking a row expands the full record underneath (fetched once, then cached, and shown through
`app-markdown-view`), and **Add** imports it and stays open so several picks can be made in one
visit. The host maps the emitted record into its own list — `record.spell` / `.item` / `.feature` /
`.attack` — after which it's an ordinary, editable entry with no link back to the reference data.

Two wiring notes: the browser is a **sibling** of each section's `<app-modal>`, not nested inside it
(two native `<dialog>`s stack in the top layer on their own, and Esc closes the top one); and
`ReferenceService.ensureStatus()` is called from each section modal's `open()` rather than the
service constructor, so a sheet that's only *viewed* costs no reference request.

Coverage: 100 oracle unit tests (renderer tags/entries, normalizers, variant assembly, index
loading/search/sort/facets, and the downloader against a fake site — no test touches the network) +
22 integration tests for the endpoints; a 7-case herald spec driving
the modal (query building, weapons-only, detail caching, add/emit, paging); and `e2e/reference.spec.ts`
running the real flow against the fixture dataset — Playwright starts the oracle with
`FIVETOOLS_DATA_DIR=tests/fixtures/fivetools` — the campaigns-page card reporting what's loaded, then
browsing, filtering, expanding and importing a spell into the spell list, and a weapon into the
attacks panel with its to-hit derived on the sheet.

**Checked against a real dataset.** A live download (24 files, 4.5 MB) indexes in 0.26s to **936
spells, 9,524 items** (magic-variant assembly doing most of that) **and 489 feats/optional features**;
normalizing every one of those records produced no errors, no unresolved `{@tag}`/`{=field}` markup,
and only 5 items with an empty description. It did surface one bug, now fixed: 5etools puts inline
markup in *scalar* fields too (a Luck Blade's `"charges": "{@dice 1d4 - 1}"`), which the item stat
line printed raw — scalars now go through `normalize.scalar()`.

Two deliberate simplifications remain: `_copy` inheritance ignores 5etools' `_mod` patch language,
and Phase 13 indexes feats + optional features but not race/background traits (those arrive with the
class parsing in Phase 14). Note also that a specific magic variant inherits its base item's `value`
(a Flame Tongue Longsword reads "15 gp"), which is what 5etools itself shows.
