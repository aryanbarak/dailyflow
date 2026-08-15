# smartFlow Project Context

## Project
Personal productivity React SPA for one user (barakzahi@web.de).
Live at: https://smartaryn.com (task 24 transition from https://barakzai.cloud, which stays active in parallel until retirement is authorized)
Repo: https://github.com/aryanbarak/smartflow

## Tech Stack
- React 18.3.1 + TypeScript 5.8.3
- Vite 7 + SWC
- Tailwind CSS 3.4 + Radix UI
- Framer Motion (animations)
- TanStack React Query v5 (server state)
- Zustand v5 with persist middleware (global state)
- React Router DOM v6
- Supabase (PostgreSQL + Auth + Storage)
- Sonner (toasts)
- next-themes (dark/light/system)
- Recharts (charts)
- Cloudflare Pages (hosting)
- Cloudflare Worker + Gemini 2.5 Flash (AI)

## Database Tables (all with RLS, user_id FK to auth.users)
- tasks (id, user_id, title, notes, due_date, completed, recurrence_rule, recurrence_end_date)
- finance_transactions (id, user_id, type, amount, category, date, notes)
- family_children (id, user_id, name, age, color, initials, role, schedule, notes, events)
- documents (id, user_id, storage_path, file_name, mime_type, size_bytes, title)
- learn_ai_messages (id, user_id, mode, language, role, content)
- calendar_events (id, user_id, title, date, start_time, end_time, location, color, recurrence_rule)
- journal_entries (id, user_id, date DATE, mood SMALLINT 1-5, content) — UNIQUE(user_id, date)
- links (id, user_id, url, title, description, tags TEXT[], is_favorite, favicon_url)
- mood_logs (id, user_id, date DATE, mood SMALLINT 1-5, note) — UNIQUE(user_id, date)
- flashcard_decks (id, user_id, name, description)
- flashcards (id, deck_id, user_id, front, back, ease_factor, interval_days, next_review, review_count, last_rating)
- shopping_items (id, user_id, name, category, quantity, unit, checked)

## Key Patterns
- All tables: RLS enforced, user_id FK to auth.users
- Supabase client: src/integrations/supabase/client.ts (credentials hardcoded, no env vars)
- Services: src/features/<feature>/<feature>Service.ts
- Hooks: src/features/<feature>/use<Feature>.ts
- Pages: src/pages/<Feature>Page.tsx
- i18n: src/i18n/index.ts — use useT() hook, never hardcode UI strings
- Global state: Zustand stores in src/features/settings/ (appearanceStore, notificationSettings)

## Rules
- Always call getUser() before any DB operation
- Use .maybeSingle() (not .single()) when a row might not exist
- Use TanStack Query v5 syntax (isPending not isLoading for mutations)
- Toasts: import { toast } from 'sonner'
- Animations: use Framer Motion, respect reducedMotion from useAppearance()
- i18n: use useT() hook from src/i18n/index.ts — never hardcode UI strings
- No any types — use unknown and narrow, or define proper interfaces
