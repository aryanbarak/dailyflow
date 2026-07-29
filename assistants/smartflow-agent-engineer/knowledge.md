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

- `docs/reference/README.md`

Future sources, not currently listed as upload-ready: dedicated Agent Pipeline docs, execution architecture docs, tool contract docs and implementation test strategy docs as they are added.

## Excluded Knowledge

- `.knowledge/`
- `.prompts/`
- `.env`
- generated output such as `dist/`, `coverage/` and `.knowledge/context_output.md`
- dependency folders such as `node_modules/`
- lockfiles
- general visual design documents unless they define an execution contract
- source code unless a specific implementation review explicitly requires it

## Upload Notes

Upload only the listed canonical files. Do not copy project documentation or source code into `assistants/`. Re-upload Knowledge manually after material changes to agent contracts, execution policy, tool registry, approval, audit or project status.

## Last Verified

2026-07-14
