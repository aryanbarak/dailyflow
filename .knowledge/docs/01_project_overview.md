# SmartFlow - Project Overview

## What is SmartFlow?

SmartFlow is a personal productivity web app for one user (`barakzahi@web.de`).
It provides a unified workspace for tasks, calendar, finances, family scheduling,
documents, music, photos, and AI-powered learning.

## Current Phase

SmartFlow has moved beyond a static productivity dashboard. It is now becoming
an AI Personal Operating System with a deterministic agent architecture.

The completed Living Workspace and agent foundation now allow SmartFlow to:

- collect existing frontend activity data,
- derive workspace signals,
- preserve bounded client-side memory,
- apply interaction feedback and personalization,
- apply deterministic decision intelligence,
- choose priorities and goals,
- plan safe daily steps,
- resolve safe read-only and explicitly approved write tools for planned steps,
- enforce explicit human approval, execution policy, and audit boundaries,
- execute explicitly supported read-only tools and the first approved write
  vertical slice: `tasks.complete`.

Current engineering focus: response quality and safety validation before any
broader autonomous capability. The system remains bounded, frontend-controlled,
and privacy-safe while future semantic memory, vector memory, RAG, and
conversation memory layers are designed.

The latest milestones add LLM Reasoning V1, multilingual reasoning-domain
correction, Write Runtime Boundary V1, Reflection, Context Synthesis, and
Response Composer V1. SmartFlow can interpret supported requests, validate them
deterministically, require explicit user approval where needed, execute only
supported handlers, reflect on verified outcomes, and produce concise natural
responses without exposing internal metadata.

Approval does not execute tools, substitute tools, escalate scope, or bypass
execution policy. The LLM proposes only; deterministic validation, approval,
runtime policy, execution audit, reflection, and response composition remain
separate boundaries.

## Live URLs

- App: https://smartaryn.com (production; task 24 transition from https://barakzai.cloud, kept active in parallel until retirement is authorized)
- AI Worker: https://api.barakzai.cloud/analyze
- Repo: https://github.com/aryanbarak/smartflow
- Supabase: taqxwnlwllbywaklwyno (FREE tier)

## Tech Stack

- Frontend: React 18.3.1 + TypeScript 5.8.3 + Vite 7 + SWC
- UI: Tailwind CSS 3.4 + Radix UI + Framer Motion
- State: TanStack React Query v5 + Zustand v5
- Router: React Router DOM v6
- Backend: Supabase (PostgreSQL + Auth + Storage)
- Hosting: Cloudflare Pages (auto-deploy from main via GitHub Actions)
- AI Cloud: Cloudflare Worker + Gemini 2.5 Flash
- AI Local: Ollama (qwen2.5-coder:7b, qwen2.5-coder:14b, llama3.1:8b)
- Toasts: Sonner
- Icons: Lucide React
- Fonts: Sora, Inter, Vazirmatn (RTL/Farsi)

## Key Architectural Decisions

- Supabase credentials are hardcoded in `client.ts` intentionally.
- `VITE_SUPABASE_URL` must not be added to GitHub secrets.
- `OLLAMA_VULKAN=1` is required for Intel Arc 140V GPU.
- Models are stored in `E:\ollamaModels`.
- All tables use RLS with `user_id` FK to `auth.users`.
- PWA uses `navigateFallback=null` to prevent service worker navigation crashes.
- Calendar uses Supabase primary storage plus localStorage offline fallback.
- i18n uses a lightweight custom `useT()` hook, with English, German, and Farsi.
- Workspace intelligence is deterministic before any LLM autonomy is introduced.
- AI response language is separate from interface language. Fixed response
  language wins; `auto` follows the latest user message; RTL/LTR is applied only
  to AI response content.
