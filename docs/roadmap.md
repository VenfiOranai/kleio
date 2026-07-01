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

---

## Dependency notes
- Phases 0–1 are foundational and sequential.
- Phases 2 and 3 are independent of each other (can be done in either order after Phase 1).
- Phase 4 (summarization) should precede Phase 5 (Q&A): both need the Gemini client and the
  AI infra (`services/ai.py`, API key handling).
