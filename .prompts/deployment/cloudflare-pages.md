# Cloudflare Pages Deployment — smartFlow

## Project Info
- Repo: https://github.com/aryanbarak/smartflow
- Live: https://smartaryn.com (task 24 transition from https://barakzai.cloud, which stays active in parallel until retirement is authorized)
- Hosting: Cloudflare Pages
- CI/CD: GitHub Actions → .github/workflows/deploy-cloudflare-pages.yml
- Build command: `npm run build`
- Output dir: `dist`

## Deploy Methods

### Method 1 — Auto (push to main)
```bash
git push origin main
# GitHub Actions triggers automatically
```

### Method 2 — Manual trigger
```bash
gh workflow run deploy-cloudflare-pages.yml --ref main
```

### Method 3 — Watch deployment
```bash
gh run list --limit 5
gh run watch <run-id>
```

## GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Wrangler deploy auth |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | Project name |
| `VITE_AI_AGENT_URL` | https://api.barakzai.cloud/analyze |
| `VITE_APP_ENV` | production |

## ⚠️ Do NOT add these as secrets (hardcoded by design)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

These are public credentials (anon key + RLS). Adding them as secrets caused truncation/auth failures in the past. They are hardcoded in `src/integrations/supabase/client.ts`.

## Build Troubleshooting
- TypeScript error → fix locally first: `npm run build`
- Missing env var → check GitHub Secrets
- Wrong Supabase URL → check client.ts hardcoded values

## Pre-Deploy Checklist
- [ ] `npm run build` passes locally with no errors
- [ ] No console.error in production code
- [ ] New Supabase tables have RLS + GRANT (run migration)
- [ ] New env vars added to GitHub Secrets
- [ ] CLAUDE_CONTEXT.md updated

## Task:
[DESCRIBE DEPLOYMENT TASK OR ISSUE HERE]
