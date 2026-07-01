# Kleio

A personal web app to chronicle Dungeons & Dragons campaigns — session notes and
5E character sheets, organized under campaigns. Named after **Kleio** (Clio), the
muse of history.

## What it does

- **Campaigns** group everything.
- **Sessions** hold your notes (Markdown). Everything you write is kept; later, Gemini
  can summarize raw notes into a clean readable summary.
- **Characters** are 5E-style sheets attached to a campaign — you enter the manual
  fields (ability scores, HP, proficiencies…) and the app calculates the rest
  (modifiers, saving throws, skills, passive perception…).
- **Side-by-side workspace** (desktop): notes and a character sheet on one screen, each
  pane collapsible to full width.
- **Responsive**: works on phone and desktop (split view is desktop-only; mobile stacks).
- **Global search** across notes; later, AI Q&A over your notes.

## Tech stack

| Layer | Choice |
|---|---|
| **Herald** (frontend) | Angular (standalone components, Material + CDK) |
| **Oracle** (backend) | FastAPI (Python) |
| Database | PostgreSQL (+ `pgvector` for later AI Q&A) |
| Auth | Single-user JWT |
| Tests | Pytest (unit + integration), Playwright (e2e) |
| CI/CD | GitHub Actions |
| Deploy | Docker Compose on Amazon EC2 |
| AI (later) | Google Gemini — summarization, then RAG Q&A |

## Repository layout

```
herald/              Angular SPA — the frontend ("announces & presents")
oracle/              FastAPI app, Alembic migrations, tests — the backend ("holds the answers")
infra/               docker-compose (dev + prod), nginx config
.github/workflows/   ci.yml, deploy.yml
docs/                architecture.md, roadmap.md
```

## Documentation

- **[docs/architecture.md](docs/architecture.md)** — system design, data model, API, components.
- **[docs/roadmap.md](docs/roadmap.md)** — phased delivery plan and verification.

## Status

Planning complete. Implementation starts at **Phase 0** (see the roadmap).
