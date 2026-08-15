# CLAUDE_CONTEXT.md — smartFlow

*Last updated: 2026-05-28 (evening). Read this file at the start of every new session.*

---

## 1. Project Overview

**smartFlow** is a personal productivity web app (React SPA) for one user (`barakzahi@web.de`). It provides a unified workspace for tasks, calendar, finances, family scheduling, documents, music, AI-powered learning, habits, journaling, flashcards, and more — all behind a Supabase authentication layer.

| | |
|---|---|
| **Live app** | `https://smartaryn.com` (production; transitioning from `https://barakzai.cloud`, which stays active during the migration) |
| **AI Worker** | `https://api.barakzai.cloud/analyze` |
| **Repo** | `https://github.com/aryanbarak/smartflow` |
| **Supabase project** | `taqxwnlwllbywaklwyno` (aryanbarak's Project, FREE tier) |
| **Supabase owner** | `barakzahi@web.de` |
| **Hosting** | Cloudflare Pages (auto-deploy from `main` via GitHub Actions) |

---

## 2. Tech Stack

### Frontend
| Layer | Technology |
|-------|-----------|
| Framework | React 18.3.1 + TypeScript 5.8.3 |
| Build | Vite 7.3.1 + SWC |
| UI Primitives | Radix UI |
| Styling | Tailwind CSS 3.4.17 |
| Animation | Framer Motion |
| Forms | React Hook Form + Zod |
| Server state | TanStack React Query 5 |
| Global state | Zustand 5 |
| Routing | React Router DOM 6 |
| Toasts | Sonner |
| PDF | react-pdf + pdfjs-dist + pdf-lib |
| Charts | Recharts |
| Icons | Lucide React |
| Fonts | Sora, Inter, Vazirmatn (RTL/Farsi) |

### Backend / Cloud
| Service | Role |
|---------|------|
| Supabase (PostgreSQL) | Primary database (13 tables) + Auth + Storage |
| Cloudflare Pages | Static frontend hosting |
| Cloudflare Worker (`smartflow-ai-worker`) | AI proxy → Google Gemini 2.5 Flash |

### CI/CD
- **GitHub Actions** → `.github/workflows/deploy-cloudflare-pages.yml`
- Triggers on push to `main` or manual `workflow_dispatch`
- Build command: `npm run build`

### GitHub Secrets (as of 2026-05-28)
| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Wrangler deploy auth |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler deploy target |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | Wrangler deploy target |
| `VITE_AI_AGENT_URL` | URL of the AI worker |
| `VITE_APP_ENV` | App environment flag |
| `VITE_TUTOR_API_URL` | Tutor API base URL |
| `VITE_TUTOR_API_TOKEN` | Tutor API auth token |
| `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY_B64` | Legacy SSH deploy (unused) |

> ⚠️ `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are **intentionally NOT in GitHub secrets** — see section 7.

---

## 3. Features & Status

| Feature | Route | Status | Notes |
|---------|-------|--------|-------|
| Authentication | `/auth` | ✅ Working | Supabase Auth, email+password |
| Dashboard | `/` | ✅ Working | Aggregated overview, today's events, greeting, Mood widget |
| Tasks | `/tasks` | ✅ Working | CRUD, due dates, overdue filter, recurrence rule, Supabase-backed |
| Calendar | `/calendar` | ✅ Working | Supabase-backed with localStorage offline fallback, recurrence rule |
| Finance | `/finance` | ✅ Working | Income/expense CRUD, charts, PDF export, CSV import/export |
| Habits | `/habits` | ✅ Working | Daily habit tracking, streaks, progress bar |
| Journal | `/journal` | ✅ Working | Daily notes, mood picker, calendar heatmap, auto-save |
| Flashcards | `/flashcards` | ✅ Working | Decks, SM-2 spaced repetition, Again/Hard/Good/Easy ratings |
| Mood Tracker | Dashboard widget | ✅ Working | 5-level mood log, 14-day recharts chart |
| Family Hub | `/family` | ✅ Working | Members, schedule, notes, events, calendar sync, Shopping List tab |
| Shopping List | FamilyPage tab | ✅ Working | Grouped by category, check-off, clear done |
| Documents | `/documents` | ✅ Working | PDF upload, Supabase Storage, signed URLs |
| Learn with AI | `/learn-ai` | ✅ Working | Gemini 2.5 Flash, 4 modes, 3 languages (de/fa/en), chat history |
| Photos | `/photos` | ✅ Working | Masonry grid, lightbox, tags, search, AI tagging, R2 storage |
| Music | `/music` | ✅ Working | YouTube search + player, playlists, local files, Pomodoro + task link |
| Web Links | `/links` | ✅ Working | Supabase-backed, tags, favorites, favicon, grid/list toggle, search |
| Global Search | Header | ✅ Working | Ctrl+K, searches all major entities |
| PWA | all | ✅ Working | Installable, service worker, offline badge |
| Tutor (Algorithms) | `/tutor` | 🔧 Partial | Static exam bank works; Python adapter optional |
| Tutor (WISO) | `/tutor/wiso` | 🔧 Partial | Same as above |
| Settings | `/settings` | ✅ Working | 5 tabs: Profile, Security, Appearance, Notifications, Data |
| i18n | all | ✅ Working | English (default), German, Farsi — toggled in Settings → Appearance |
| Dark mode | all | ✅ Working | Default dark, `next-themes` |
| RTL/Farsi | all (when lang=fa) | ✅ Working | Vazirmatn font, `html[dir=rtl]`, set via language selector |
| Mobile nav | all | ✅ Working | Bottom nav, auto-closes on navigation |

**All UI text must be in English by default** — never hardcode Persian/Farsi strings in components. All translated text goes through `useT()` from `src/i18n/index.ts`.

---

## 4. Database Schema (Supabase)

All tables use `user_id` FK → `auth.users` with RLS enforced.

### `tasks`
`id, user_id, title, notes, due_date (YYYY-MM-DD), completed, recurrence_rule TEXT, recurrence_end_date DATE, created_at, updated_at`

### `finance_transactions`
`id, user_id, type ('income'|'expense'), amount, category, date (YYYY-MM-DD), notes, created_at, updated_at`

### `family_children`
`id, user_id, name, age, color (hex), initials, role, schedule (jsonb), notes (jsonb), events (jsonb), created_at`

### `documents`
`id, user_id, storage_path, file_name, mime_type, size_bytes, title, description, created_at, updated_at`

### `learn_ai_messages`
`id, user_id, mode ('fiae_algorithms'|'general_it'|'wiso'|'planner'), language ('de'|'fa'|'en'), role ('user'|'assistant'), content, created_at`

### `calendar_events`
`id, user_id, title, date (YYYY-MM-DD), start_time (HH:MM|null), end_time (HH:MM|null), location, description, color, type, all_day, recurrence_rule TEXT, recurrence_end_date DATE, created_at, updated_at`

### `journal_entries`
`id, user_id, date DATE, mood SMALLINT (1–5), content TEXT, created_at, updated_at`
— `UNIQUE(user_id, date)` — uses `.maybeSingle()` on read

### `links`
`id, user_id, url TEXT, title TEXT, description TEXT, tags TEXT[], is_favorite BOOLEAN, favicon_url TEXT, created_at`
— GIN index on `tags` column

### `mood_logs`
`id, user_id, date DATE, mood SMALLINT (1–5), note TEXT, created_at`
— `UNIQUE(user_id, date)` — uses `.maybeSingle()` on read

### `flashcard_decks`
`id, user_id, name TEXT, description TEXT, created_at`

### `flashcards`

`id, deck_id, user_id, front TEXT, back TEXT, ease_factor REAL (default 2.5), interval_days INT (default 1), next_review DATE, review_count INT, last_rating SMALLINT, created_at`

### `shopping_items`

`id, user_id, name TEXT, category TEXT (default 'Other'), quantity NUMERIC, unit TEXT, checked BOOLEAN, created_at`

### Pending migrations (must be run manually in Supabase Dashboard → SQL Editor)

- `supabase/migrations/20260528000003_journal.sql`
- `supabase/migrations/20260528000004_recurring.sql`
- `supabase/migrations/20260528000005_links_enhanced.sql`
- `supabase/migrations/20260528000006_mood_tracker.sql`
- `supabase/migrations/20260528000007_flashcards.sql`
- `supabase/migrations/20260528000008_shopping_list.sql`

### Storage Buckets
- `documents` — user PDFs at `{userId}/{fileName}`

### localStorage Keys (fallback/offline only)
- `smartflow:v1:events` — calendar events offline cache
- `smartflow:v1:calendar-ui-state` — view state
- `smartflow:learn-ai:{userId}:{mode}` — AI message fallback

---

## 5. Key Files

| File | Purpose |
|------|---------|
| `src/integrations/supabase/client.ts` | Supabase client — hardcoded URL+key, no env vars |
| `src/integrations/supabase/types.ts` | Generated DB types |
| `src/i18n/index.ts` | Full translation dictionaries (en/de/fa, ~200 keys) + `useT()` hook |
| `src/components/LanguageProvider.tsx` | Sets `html[lang]`, `html[dir]`, Vazirmatn class on language change |
| `src/features/settings/appearanceStore.ts` | Zustand persist: `density`, `accentColor`, `reducedMotion`, `language` |
| `src/features/settings/notificationSettings.ts` | Zustand persist: task/habit/calendar/daily-summary reminder prefs |
| `src/features/settings/dataExportService.ts` | JSON export (8 tables), delete all data (10 tables + storage), localStorage stats |
| `src/features/calendar/calendarService.ts` | Calendar CRUD (Supabase + localStorage fallback) |
| `src/features/tasks/tasksService.ts` | Tasks CRUD |
| `src/features/finance/financeService.ts` | Finance CRUD |
| `src/features/finance/csvService.ts` | CSV export/import for finance transactions |
| `src/features/family/familyService.ts` | Family CRUD |
| `src/features/learn-ai/aiService.ts` | Fetch → api.barakzai.cloud/analyze |
| `src/features/journal/journalService.ts` | Journal CRUD (upsert by date, `.maybeSingle()`) |
| `src/features/mood/moodService.ts` | Mood log CRUD (upsert by date, `.maybeSingle()`) |
| `src/features/mood/MoodWidget.tsx` | Dashboard mood widget (picker + recharts chart) |
| `src/features/flashcards/spacedRepetition.ts` | SM-2 algorithm implementation |
| `src/features/flashcards/flashcardService.ts` | Deck + card CRUD, review scheduling |
| `src/features/shopping/shoppingService.ts` | Shopping list CRUD |
| `src/features/links/linksService.ts` | Links CRUD (Supabase-backed) |
| `src/features/search/GlobalSearch.tsx` | Ctrl+K global search overlay |
| `src/features/music/pomodoroStore.ts` | Zustand store for Pomodoro + linked task |
| `src/lib/recurrence.ts` | RecurrenceRule type + expandRecurrences() helper |
| `src/components/RecurrencePicker.tsx` | Recurrence selector for tasks + calendar |
| `src/hooks/useAuth.ts` | Session/user state |
| `src/lib/storage.ts` | Safe localStorage wrappers |
| `vite.config.ts` | Proxy, chunk splitting, PWA config |
| `.github/workflows/deploy-cloudflare-pages.yml` | CI/CD pipeline |

---

## 6. Recent Changes (since 2026-05-23)

| Commit | Change |
|--------|--------|
| `e9e6b96` | **feat(i18n):** full English/German/Farsi i18n — `useT()` hook, `LanguageProvider`, nav/pages/hooks translated |
| `373efce` | **feat:** full Settings page — 5 tabs (Profile, Security, Appearance, Notifications, Data), accent color store, notification prefs, data export/delete |
| `7fcfa04` | **feat:** add Mood Tracker (Dashboard widget), Flashcards (SM-2), Shopping List (FamilyPage tab) |
| `8a4399b` | **fix:** translate GlobalSearch placeholder/UI text to English |
| `ea5cb3f` | **fix:** replace all Persian UI text with English across Habits, Journal, Finance, HabitCard |
| `284b173` | **feat:** implement medium impact features — Journal, Recurring Tasks/Events, Finance CSV, Pomodoro+Task link, Links page (Supabase-backed with tags/favorites) |
| `6d06ea2` | **fix(supabase):** hardcode URL and key directly — remove all env var logic |
| `2c6ee79` | **ci:** remove deleted Supabase secrets from workflow env |
| `254c327` | **fix(supabase):** hardcoded URL/key is primary; env var only overrides if valid |
| `46d58d2` | **fix(pwa):** set `navigateFallback: null` to fix SW crash on page navigation |
| `7495a13` | **feat(family-hub):** add Family Hub page, components, hooks, routing |
| `d0fbdac` | **feat(photos):** masonry grid, lightbox, tags, search, timeline, AI tagging |
| `844f8f7` | **feat(music):** add Playlists tab |
| `b5c8ba2` | **feat(music):** full music page (YouTube player, local files, Pomodoro timer) |
| `fdfa91f` | **feat(calendar):** migrate from localStorage to Supabase with offline fallback |

---

## 7. Critical Operational Notes

### Supabase Credentials — HARDCODED BY DESIGN
```
URL:  https://taqxwnlwllbywaklwyno.supabase.co
KEY:  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...TmhuyWcwEUwnSvxXJiZ2HueY6Jr0sudmyJWlpM-X7_Y
```

- These are **public credentials** (anon key with RLS) — safe to commit
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` GitHub secrets were **intentionally deleted** on 2026-05-28 after repeated incidents where wrong secret values broke auth
- Credentials are hardcoded directly in `client.ts` — no env var fallback
- **Do not re-add these as GitHub secrets**

### When Auth Breaks ("Failed to fetch" / "NetworkError")
1. Check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in GitHub secrets — if they exist with wrong values, delete them
2. Open browser DevTools → Network → look at the Request URL in the failed Supabase call — wrong URL = wrong/truncated secret
3. Supabase Auth → URL Configuration must have Site URL = `https://smartaryn.com` and redirect `https://smartaryn.com/**` (transition: `https://barakzai.cloud` / `https://barakzai.cloud/**` were the prior values and may still be present as an additional allowed redirect during the migration)
4. After any fix: manually trigger workflow via `gh workflow run deploy-cloudflare-pages.yml --ref main`

### Supabase FREE Tier
- Projects **pause after 7 days of inactivity**
- If paused: go to Supabase dashboard → restart project
- Maintenance windows can cause temporary auth failures (check the banner in the dashboard)

### Supabase Table Pattern

- Always use `.maybeSingle()` (not `.single()`) when querying for an optionally-present row (e.g., today's mood, today's journal entry). `.single()` throws if no row is found.

### AI Worker
- Source lives in `smartflow-ai-worker/` (NOT in this repo's git history — no version control)
- `GEMINI_API_KEY` must be set manually via `npx wrangler secret put GEMINI_API_KEY` inside `smartflow-ai-worker/`
- CORS is hardcoded to `https://barakzai.cloud` only — localhost requests are blocked in production (this section describes the legacy `smartflow-ai-worker/` API host, a separate repo/service from this repo's own `agent/worker` Cloudflare Worker; task 24 added `https://smartaryn.com` to `agent/worker`'s own CORS allow-list — see `agent/worker/index.ts`. Whether `smartflow-ai-worker`'s CORS also needs `smartaryn.com` is out of this task's scope; see the task 24 report)

### Deployment
```bash
# Push to main triggers auto-deploy
git push origin main

# Force a redeploy without code changes
gh workflow run deploy-cloudflare-pages.yml --ref main

# Watch deployment
gh run watch <run-id>
```

---

## 8. i18n Architecture

Lightweight custom i18n — **no i18next library**.

### How it works

- `src/i18n/index.ts` exports `translations` (en/de/fa dictionaries, ~200 keys) and `useT()` hook
- `useT()` reads `language` from `useAppearance()` Zustand store; returns `{ t, lang, isRTL }`
- `t('key', { count: 5 })` replaces `{{count}}` in the string
- `LanguageProvider` (rendered inside `App.tsx`) syncs `html[lang]`, `html[dir]` (RTL for fa), and font class
- Language persisted to `localStorage` via `smartflow:appearance` Zustand key

### Usage in components

```tsx
import { useT } from '@/i18n';
const { t } = useT();
// ...
<h1>{t('habits_title')}</h1>
<p>{t('habits_days', { count: streak })}</p>
```

### Usage in custom hooks (for toast messages)

```tsx
import { useT } from '@/i18n';
export function useCreateHabit() {
  const qc = useQueryClient();
  const { t } = useT();  // valid — called at top level of a custom hook
  return useMutation({
    onSuccess: () => { qc.invalidateQueries(...); toast.success(t('habits_habit_added')); },
  });
}
```

### Supported languages

| Code | Language | RTL | Status |
|------|----------|-----|--------|
| `en` | English | No | Default, all keys present |
| `de` | German | No | All keys present |
| `fa` | Farsi | **Yes** | All keys present |

### Coverage (as of 2026-05-28)

Translated: Navigation, common actions, Habits, Journal, Flashcards, Mood, Shopping, Settings (all tabs), auth, errors/toasts.
**Not yet translated:** Dashboard, Tasks, Calendar, Finance, Documents, Music, Photos, Links, Learn AI pages.

---

## 9. Known Bugs & Limitations

| # | Issue | Severity |
|---|-------|---------|
| 1 | `learn_ai_messages` grows unbounded — no pruning | Low |
| 2 | Family `events`/`schedule`/`notes` JSONB arrays grow unbounded | Low |
| 3 | No optimistic rollback on Supabase write failure (UI desyncs until reload) | Medium |
| 4 | Single Gemini model — no fallback if rate-limited | Medium |
| 5 | No rate limiting on `/analyze` endpoint | Medium |
| 6 | Signed URL lifetime for documents is short (~20s in some configs) | Low |
| 7 | No error tracking (Sentry / CF Analytics) | Low |
| 8 | `smartflow-ai-worker` has no CI/CD and no git repo | Low |
| 9 | Supabase generated types (`types.ts`) not updated for new tables — new services use `as any` casts | Low |

---

## 9. Next Planned Features

| Priority | Feature |
|----------|---------|
| High | Rate-limit AI Worker (Cloudflare Rate Limiting or KV counter) |
| Medium | Regenerate Supabase types (`supabase gen types`) to remove `as any` casts in new services |
| Medium | Mobile-optimize Finance and Family pages |
| Medium | Prune `learn_ai_messages` (DB trigger or scheduled function) |
| Medium | Flashcard AI card generation (auto-generate front/back from a topic) |
| Medium | Extend i18n to remaining pages (Dashboard, Tasks, Calendar, Finance, Documents, Music, Photos, Links, Learn AI) |
| Low | Sentry / error tracking |
| Low | Expand Vitest test coverage for service layer |
| Low | Git-initialize `smartflow-ai-worker` and add deploy workflow |

---

## 10. Local Development

```bash
cd smartflow
npm install
npm run dev          # starts on http://localhost:8080
```

Vite proxies `/__ai/*` → `VITE_AI_AGENT_URL` (default: `http://localhost:8000`) for the optional local Python tutor adapter.

The AI features in dev point to `https://api.barakzai.cloud/analyze` (production Worker) — CORS will block requests from localhost unless you run `wrangler dev` locally.
