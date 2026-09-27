import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('a new agent that checks in while you are away shows as connected when you come back', async ({ page }) => {
  await signIn(page, 'agent-poll')
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
  await navigation.getByRole('button', { name: 'Team', exact: true }).click()
  await page.getByRole('button', { name: '＋ Add agent' }).click()
  await page.getByPlaceholder('ci-bot').fill('poll-bot')
  await page.getByText('All tools', { exact: true }).first().click()
  const created = page.waitForResponse(r => /\/orgs\/\d+\/agents$/.test(r.url()) && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const agent = await (await created).json()
  await expect(page.getByText('Token for poll-bot', { exact: false })).toBeVisible()

  await navigation.getByRole('button', { name: 'Catalog', exact: true }).click()
  await navigation.getByRole('button', { name: 'Team', exact: true }).click()
  // Let the page's own roster load on return finish first, so only the poll can see the check-in.
  await page.waitForLoadState('networkidle')
  await page.route(/\/orgs\/\d+\/agents$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const rows = await (await route.fetch()).json()
    await route.fulfill({ json: rows.map((a: { user_id: number }) => a.user_id === agent.user_id ? { ...a, connected: true } : a) })
  })
  await expect(page.getByText(/connected .*poll-bot called in as itself/)).toBeVisible({ timeout: 8000 })
})
