# smartFlow — MASTER CONTEXT
# Last updated: 2026-06-04
# Purpose: Single source of truth for AI assistants working on this codebase.

---

## What is smartFlow?

Personal LifeOS / productivity web app for one user (barakzahi@web.de / malekaryan@gmail.com).
Unified workspace: Tasks, Calendar, Finance, Family Hub, Documents, Music, Photos, Links,
AI Tutor, Habits, Journal, Flashcards, Global Search, Settings.

---

## Live URLs

| Resource | URL |
|----------|-----|
| App | https://smartaryn.com (production; task 24 transition from https://barakzai.cloud, which stays active in parallel until retirement is authorized) |
| AI Worker | https://api.barakzai.cloud |
| Frontend Repo | https://github.com/aryanbarak/smartflow |
| Worker Repo | https://github.com/aryanbarak/smartflow-ai-worker |
| Supabase Project | taqxwnlwllbywaklwyno (FREE tier) |

---

## Architecture

```
Browser (barakzai.cloud)
  └── Cloudflare Pages (static SPA — dist/ auto-deployed on push to main)
        └── fetch() → api.barakzai.cloud
                        └── Cloudflare Worker (smartflow-ai-worker/src/index.js)
                              ├── /analyze   → Gemini 2.5 Flash API
                              ├── /search    → YouTube InnerTube API
                              ├── /translate → DeepL API
                              ├── /ocr       → Gemini Vision API
                              ├── /tts       → ElevenLabs API
                              ├── /photos/*  → Cloudflare R2 (PHOTOS_BUCKET)
                              └── /health    → 200 OK

Supabase (taqxwnlwllbywaklwyno)
  ├── PostgreSQL + RLS (all tables)
  ├── Auth (email + password)
  └── Storage (documents bucket — HTML + PDF uploads)
```

**NOT** AWS EC2, **NOT** FastAPI, **NOT** Docker. Everything is serverless.

---

## Tech Stack

### Frontend (smartflow/)
| Layer | Library | Version |
|-------|---------|---------|
| Build | Vite + SWC | 7.x |
| Framework | React | 18.3.1 |
| Language | TypeScript | 5.8.3 |
| UI | Tailwind CSS | 3.4 |
| Components | Radix UI + shadcn/ui | latest |
| Animation | Framer Motion | 11.x |
| State | TanStack React Query v5 + Zustand v5 | latest |
| Forms | React Hook Form + Zod | latest |
| Charts | Recharts | 2.x |
| Rich Text | TipTap v3 (StarterKit + extensions) | 3.24.x |
| PDF | pdf-lib (client-side) | latest |
| PWA | vite-plugin-pwa | latest |
| i18n | Custom hook (en/de/fa, RTL for Farsi) | — |

### Backend (smartflow-ai-worker/)
| Layer | Detail |
|-------|--------|
| Runtime | Cloudflare Workers (JS ESM) |
| Deploy | `wrangler deploy` |
| KV | RATE_LIMIT_KV — per-user rate limiting (1h windows) |
| R2 | PHOTOS_BUCKET — photo upload/serve/delete |
| Secrets | GEMINI_API_KEY, ELEVENLABS_API_KEY, DEEPL_API_KEY |

---

## Key Patterns

### Data Layer
- All DB access via `supabase` client (typed — `Database` from `src/integrations/supabase/types.ts`)
- No `as any` casts — types regenerated via `supabase gen types`
- RLS on every table — user can only see their own rows
- TanStack Query v5: `isPending` (not `isLoading`) for mutations
- All persist keys prefixed `smartflow:` in Zustand

### Components
- Shadcn/ui components in `src/components/ui/`
- Feature components in `src/features/<feature>/components/`
- Service layer in `src/features/<feature>/<feature>Service.ts`
- Hooks in `src/features/<feature>/use<Feature>.ts`
- Never define components inside other components (causes React remount on every render)

### TipTap v3 (TextEditorTool)
- StarterKit v3 includes Underline and Link — must disable in configure:
  `StarterKit.configure({ link: false, underline: false })`
- TextEditorTool uses `forwardRef` + `useImperativeHandle` → exposes `loadFromLibrary(html, title)`
- DocumentsPage calls `editorRef.current?.loadFromLibrary(...)` directly (no prop-based timing)
- `ToolCard` component must be defined at module scope, NOT inside DocumentsPage

### Documents Feature
- Library stores HTML files (for editing) and PDFs in Supabase Storage
- Text Editor saves as HTML to Library; downloads as .docx (Ctrl+S)
- Edit button in Library: fetches HTML via signed URL, extracts `<body>` content, calls `loadFromLibrary`
- View button for HTML: fetches + renders in new window with styling
- Download: strips timestamp from filename, uses doc.title as base

### AI Worker Rate Limiting
- Identifier: `u:<user_id>` from JWT sub claim, fallback `ip:<CF-Connecting-IP>`
- Per endpoint per 1-hour window in RATE_LIMIT_KV
- Limits: analyze=20, search=60, translate=30, tts=10, ocr=10, photo-analyze=10

---

## Supabase Tables (key ones)

| Table | Purpose |
|-------|---------|
| tasks | Tasks with recurrence_rule, recurrence_end_date |
| calendar_events | Events with recurrence |
| finance_transactions | Budget + expense tracking |
| family_children | Family members (role: string\|null in DB) |
| documents | Document metadata (storage_path, mime_type, file_name) |
| learn_ai_messages | AI chat history (grows unbounded — known bug) |
| habits | Habit definitions + streaks |
| journal_entries | Daily journal with mood |
| flashcards | SM-2 spaced repetition cards |
| links | Bookmarks with tags + favicon |
| user_settings | Per-user app settings |
| photos | Photo metadata + R2 keys + AI tags |
| checklist_templates | Family Hub checklists |
| child_homework | Family Hub homework tracker |
| child_exams | Family Hub exam tracker |

Storage buckets: `documents` (HTML + PDF), PHOTOS_BUCKET via R2

---

## Cloudflare Worker Endpoints

| Method | Path | Auth | Rate Limit | Backend |
|--------|------|------|-----------|---------|
| POST | /analyze | none (origin check) | 20/hr | Gemini 2.5 Flash |
| GET | /search?q= | none | 60/hr | YouTube InnerTube |
| POST | /translate | none | 30/hr | DeepL |
| POST | /ocr | Bearer JWT | 10/hr | Gemini Vision |
| POST | /tts | none | 10/hr | ElevenLabs |
| POST | /photos/upload | Bearer JWT | — | R2 |
| GET | /photos/file?key= | none | — | R2 |
| DELETE | /photos/delete?key= | Bearer JWT | — | R2 |
| POST | /photos/analyze | Bearer JWT | 10/hr | Gemini Vision |
| GET | /health | none | — | static |

CORS: allows `https://barakzai.cloud` and `http://localhost:*`

---

## Deployment

### Frontend
```
git push origin main
→ Cloudflare Pages picks up automatically (~30s build)
→ Live at https://smartaryn.com (task 24: production moved here from https://barakzai.cloud, which stays active in parallel during the transition)
```

### AI Worker
```
cd smartflow-ai-worker
npx wrangler deploy
→ Live at api.barakzai.cloud
```

### Secrets (wrangler)
```
wrangler secret put GEMINI_API_KEY
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put DEEPL_API_KEY
# Verify: wrangler secret list
```

---

## Known Bugs (open)
| # | Bug | Severity |
|---|-----|----------|
| 1 | learn_ai_messages grows unbounded | Low |
| 2 | Family JSONB arrays grow unbounded | Low |
| 3 | No optimistic rollback on write failure | Medium |
| 4 | Single Gemini model — no fallback if rate-limited | Medium |
| 5 | Short signed URL lifetime for documents (~20s on free tier) | Low |
| 6 | No error tracking (Sentry) | Low |

---

## Critical Rules

1. **No `as any`** — Supabase types are generated. Use proper narrowing.
2. **VITE_AI_AGENT_URL** must be the full path: `https://api.barakzai.cloud/analyze`
3. **No SSH via Cloudflare proxied domain** — use direct IP.
4. **Supabase anon key is public** — never put it in GitHub secrets; hardcode in client.ts.
5. **Never define React components inside other components** — causes remount on every render.
6. **TipTap v3**: Always disable StarterKit's built-in link/underline when adding them separately.
7. **DeepL** (not Gemini) for de/en/fa translation — better quality.
8. **After worker secrets change**: verify with `wrangler secret list`.
9. **`npm run build` locally** before pushing — catches TS errors early.

---

## Development Workflow

```
1. Plan with Claude (this context file as reference)
2. Implement with Claude Code (VSCode extension or terminal)
3. npm run build — verify no TS errors
4. git push → Cloudflare Pages auto-deploys
5. For worker changes: wrangler deploy
6. Update PROJECT_STATUS.md + MASTER_CONTEXT.md after significant sessions
```
