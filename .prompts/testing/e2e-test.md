# E2E Test — dailyFlow

Write a Playwright end-to-end test for the following user flow.

## Setup
```bash
npm install -D @playwright/test
npx playwright install
```

## Config: `playwright.config.ts`

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  baseURL: 'http://localhost:8080',
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
```

## Auth Helper (reuse across tests)

```typescript
// e2e/helpers/auth.ts
import { Page } from '@playwright/test'

export async function signIn(page: Page) {
  await page.goto('/auth')
  await page.fill('[placeholder="Email"]', 'barakzahi@web.de')
  await page.fill('[placeholder="Password"]', process.env.TEST_PASSWORD!)
  await page.click('button[type="submit"]')
  await page.waitForURL('/')
}
```

## Test Pattern

```typescript
import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('user can create an item', async ({ page }) => {
    await page.goto('/tasks')
    await page.click('text=Add Task')
    await page.fill('[placeholder="Task title"]', 'Test Task')
    await page.click('text=Save')
    await expect(page.locator('text=Test Task')).toBeVisible()
  })

  test('user can delete an item', async ({ page }) => {
    await page.goto('/tasks')
    await page.hover('text=Test Task')
    await page.click('[aria-label="Delete"]')
    await expect(page.locator('text=Test Task')).not.toBeVisible()
  })
})
```

## ⚠️ Notes for dailyFlow
- Always sign in first (Supabase auth required)
- Use test data — clean up after tests to avoid polluting the DB
- Don't test against production (smartaryn.com, or barakzai.cloud during the task 24 transition) — only localhost
- Run against local dev server: `npm run dev` (port 8080)
- RTL mode (Farsi): set language to 'fa' in settings before testing RTL flows

## User Flow to Test:
[DESCRIBE THE E2E SCENARIO]
