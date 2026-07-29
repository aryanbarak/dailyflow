# Knowledge Manifest

`knowledge.md` is a manifest only. Do not upload this file to GPT Knowledge.

## Required Knowledge

- `README.md`
- `PROJECT_STATUS.md`
- `MASTER_CONTEXT.md`
- `CLAUDE_CONTEXT.md`
- `docs/README.md`
- `docs/architecture/README.md`
- `docs/architecture/01-architecture-baseline.md`
- `docs/ai/README.md`
- `docs/decisions/adr/README.md`
- `docs/decisions/adr/ADR-0001-architecture-decision-record-policy.md`
- `docs/decisions/adr/ADR-0002 — Flow AI Presence Architecture.md`
- `docs/standards/DOCUMENTATION_STANDARD_V1.0.md`
- `docs/standards/gpt-knowledge-mapping-v1.md`
- `docs/testing/README.md`

## Optional Knowledge

- `docs/roadmap/product-roadmap.md`
- `docs/reference/README.md`

Future sources, not currently listed as upload-ready: deeper architecture specs, execution architecture docs and role-specific ADRs as they are added.

## Excluded Knowledge

- `.knowledge/`
- `.prompts/`
- `.env`
- generated output such as `dist/`, `coverage/` and `.knowledge/context_output.md`
- dependency folders such as `node_modules/`
- lockfiles
- source code unless a specific implementation review explicitly requires it
- visual design artifacts unless they define system behavior

## Upload Notes

Upload only the listed canonical files. Do not copy document contents into the assistant directory. Re-upload Knowledge manually after material changes to architecture, ADRs, standards or project status.

## Last Verified

2026-07-14
