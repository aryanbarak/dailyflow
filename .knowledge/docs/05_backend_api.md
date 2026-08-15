# smartFlow — Backend & API

## Cloudflare Worker
- Name: smartflow-ai-worker
- URL: https://api.barakzai.cloud/analyze
- Runtime: Cloudflare Workers Edge
- Primary AI: Gemini 2.5 Flash
- Rate limit: 20 requests/minute per IP
- CORS: hardcoded to https://barakzai.cloud only
- Deploy: `npx wrangler deploy` (manual — no CI/CD yet)
- Source: smartflow-ai-worker/ (not version controlled)

## Worker Secrets
- GEMINI_API_KEY: `npx wrangler secret put GEMINI_API_KEY`

## Supabase Auth
- Method: email + password
- User: barakzahi@web.de
- Site URL: https://smartaryn.com (task 24 transition; https://barakzai.cloud was the prior value and stays active in parallel during the migration)
- Redirect: https://smartaryn.com/** (and https://barakzai.cloud/** during the transition)
- Credentials: hardcoded in src/integrations/supabase/client.ts
- Anon key is public (RLS enforces data isolation) — safe to commit

## GitHub Secrets (CI/CD)

Required:
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_PAGES_PROJECT_NAME
- VITE_AI_AGENT_URL
- VITE_APP_ENV
- VITE_TUTOR_API_URL
- VITE_TUTOR_API_TOKEN

DO NOT ADD (hardcoded by design — adding broke auth in the past):
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

## Local AI (Ollama)
- Server: http://localhost:11434
- GPU: Intel Arc 140V iGPU via Vulkan (14.5 t/s)
- Required env var: OLLAMA_VULKAN=1
- Models dir: E:\ollamaModels
- Startup: ollama-gpu.ps1 in Windows Startup folder
- Models: qwen2.5-coder:7b, qwen2.5-coder:14b, llama3.1:8b, nomic-embed-text

## Continue.dev Config
- Config file: user-local `.continue/config.yaml` outside the repository
- Schema: v1 (new format — not legacy config.json)
- Default model: qwen2.5-coder:7b for autocomplete, 14b for chat
- Prompt library: .prompts/ (24 files, 7 categories)
