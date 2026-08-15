---
title: SmartFlow Knowledge Base Index
version: 1.0.0
status: Active
owner: SmartFlow
last_updated: 2026-07-10
source_of_truth: .knowledge/docs
---

# SmartFlow Knowledge Base

## Purpose

This directory is the primary knowledge source for SmartFlow.

It gives human contributors and AI coding assistants a consistent understanding of the product, architecture, data model, frontend patterns, backend interfaces, deployment process, roadmap, and lessons learned.

Before making a significant change, consult the relevant documents listed below.

## Project Identity

**Product name:** SmartFlow  
**Repository:** `aryanbarak/smartflow`  
**Application:** `https://smartaryn.com` (production; task 24 transition from `https://barakzai.cloud`, kept active in parallel until retirement is authorized)  
**Primary documentation directory:** `.knowledge/docs/`  
**Vector collection:** `dailyflow` — legacy technical name; do not create a second collection until a controlled migration is completed.

> The product name is SmartFlow. Existing internal references to `DailyFlow`, `dailyflow`, or `smartFlow` are legacy naming inconsistencies and should be normalized gradually, without breaking scripts or stored data.

## Source-of-Truth Order

When information conflicts, use this priority:

1. Current production implementation and verified runtime behavior
2. Architecture and database documentation
3. Project overview and frontend/backend guides
4. Roadmap
5. Lessons learned and historical notes

A conflict must be resolved by updating either the implementation or the relevant document. Do not leave two active contradictory instructions.

## Current Documents

### [01 — Project Overview](01_project_overview.md)

Defines the product purpose, current phase, live services, technology stack, and key architectural decisions.

Read this first when starting a new SmartFlow session.

### [02 — Architecture](02_architecture.md)

Describes system boundaries, major modules, data flow, application layers, and architectural constraints.

Read before introducing a new subsystem, service, state layer, or cross-cutting abstraction.

### [03 — Database Schema](03_database_schema.md)

Documents Supabase tables, relationships, ownership rules, RLS expectations, and persistence decisions.

Read before changing SQL, migrations, authentication-linked data, or storage behavior.

### [04 — Frontend Patterns](04_frontend_patterns.md)

Defines React, TypeScript, state-management, component, routing, styling, accessibility, and UI implementation conventions.

Read before building or refactoring frontend features.

### [05 — Backend API](05_backend_api.md)

Documents backend services, Cloudflare Worker interfaces, Supabase interactions, request/response patterns, and integration boundaries.

Read before changing API contracts or introducing server-side behavior.

### [06 — Deployment Guide](06_deployment_guide.md)

Defines deployment targets, environment requirements, Cloudflare/GitHub workflows, production checks, and recovery considerations.

Read before modifying hosting, environment variables, CI/CD, or release configuration.

### [07 — Roadmap](07_roadmap.md)

Tracks planned phases, product direction, priorities, and deferred capabilities.

Use it for planning; do not treat unimplemented roadmap items as current architecture.

### [08 — Lessons Learned](08_lessons_learned.md)

Records verified failures, root causes, constraints, and decisions that should not be rediscovered through repeated mistakes.

Read before touching authentication, service workers, deployment secrets, AI integrations, or previously unstable areas.

## Knowledge-Base Tooling

The `.knowledge` directory also contains local retrieval tooling:

- `build_kb.py` — rebuilds the Chroma vector database
- `query_kb.py` — queries the local knowledge base
- `load_context.py` — prepares relevant project context
- `auto_update.py` and `daily_update.py` — maintenance helpers
- `chroma_db/` — generated persistent vector data
- `context_output.md` — generated context output; not a source-of-truth document

## Important Current Limitation

The current `build_kb.py` loads only Markdown files directly inside `.knowledge/docs/` by using:

```python
DOCS_DIR.glob("*.md")
```

Therefore, nested directories such as `docs/frontend/` or `docs/backend/` are **not indexed yet**.

Until the builder is changed to recursive loading, keep active knowledge documents directly inside `.knowledge/docs/`.

The intended future implementation is:

```python
DOCS_DIR.rglob("*.md")
```

Any recursive migration must also generate collision-safe document IDs from relative paths.

## Rules for Human and AI Contributors

- Read existing implementation before changing it.
- Use these documents as guidance, not as a substitute for inspecting code.
- Do not create duplicate modules, services, stores, hooks, or documentation.
- Do not rewrite stable code without a verified reason.
- Keep changes focused and reversible.
- Preserve backward compatibility unless a breaking change is explicitly approved.
- Document significant architectural, schema, deployment, or security changes.
- Verify builds, TypeScript checks, imports, and affected flows before declaring work complete.
- State uncertainty clearly; do not invent project facts.
- Never expose secrets or copy `.env`, `.env.local`, or production credentials into documentation.

## Documentation Rules

Each maintained document should include:

- Purpose
- Current state
- Stable decisions
- Constraints
- Implementation guidance
- Known risks
- Related documents
- Last-updated date

Write current facts in present tense. Put proposals in clearly labeled **Proposed** or **Roadmap** sections.

## Update Triggers

Update documentation when any of these change:

- Product scope or phase
- Architecture or module ownership
- Database schema, RLS, or storage
- API contracts
- Frontend conventions
- Deployment, hosting, or environment handling
- AI provider, model, retrieval, or memory architecture
- A significant incident produces a reusable lesson

## Rebuild Procedure

From the repository root:

```powershell
python .knowledge/build_kb.py
```

Prerequisites:

- The local Python environment has the required packages.
- Ollama is running at `http://localhost:11434`.
- The `nomic-embed-text` model is available.

After rebuilding, run a small set of verification queries with `query_kb.py` to confirm that new or changed documents are retrievable.

## Next Documentation Work

The next foundation tasks are:

1. Normalize project naming without breaking the existing `dailyflow` Chroma collection.
2. Update `build_kb.py` to support recursive documents safely.
3. Audit the eight current documents for contradictions, stale facts, and duplicated rules.
4. Add focused standards only after the audit shows a real documentation gap.
