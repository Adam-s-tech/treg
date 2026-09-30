import { expect, test, type Page } from '@playwright/test'
import { json, signIn } from './helpers'

async function switchTo(page: Page, team: string) {
  await page.getByRole('button', { name: 'Teams' }).click()
  const switchButton = page.getByRole('button', { name: 'Switch', exact: true })
  // The innermost block holding both the team's name and a Switch button is that team's row.
  await page.locator('div').filter({ has: page.getByText(team, { exact: true }) }).filter({ has: switchButton })
    .last().getByRole('button', { name: 'Switch', exact: true }).click()
}

test('a slow answer for the team you left never replaces the team you switched to', async ({ page }) => {
  await signIn(page, 'teams', 'First team')
  await page.evaluate(() => fetch('/orgs', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Second team' }),
  }).then(r => r.json()))
  const first = (await page.evaluate(() => fetch('/orgs', { credentials: 'include' }).then(r => r.json())))
    .find((o: { name: string }) => o.name === 'First team')
  await page.reload()
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Your own tools', exact: true }).click()
  await switchTo(page, 'Second team')
  await expect(page.getByRole('button', { name: 'Teams' })).toContainText('Second team')

  // The first team's tool list answers late, and names a tool only that team has.
  let released = false
  await page.route('**/tools', async route => {
    if (route.request().headers()['x-treg-org'] !== first.slug) return route.fallback()
    await new Promise(resolve => setTimeout(resolve, 1500))
    released = true
    await route.fulfill(json([{ id: 990001, name: 'first-team-only', base_url: 'https://first.example', bindings: [], bundle_id: null, cli: null }]))
  })
  await switchTo(page, 'First team')
  await switchTo(page, 'Second team')
  await expect.poll(() => released, { timeout: 5000 }).toBe(true)
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: 'Teams' })).toContainText('Second team')
  await expect(page.getByText('first-team-only')).toHaveCount(0)
})

test('a member with no daily cap reads as no limit, and a cap can be set and cleared', async ({ page }) => {
  await signIn(page, 'team-cap')
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Team', exact: true }).click()
  const cap = page.getByRole('spinbutton', { name: /^Daily cap for / })
  await expect(cap).toHaveValue('')
  await expect(cap).toHaveAttribute('placeholder', 'No limit')
  await page.getByRole('button', { name: '＋ Add agent' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Daily call cap' })).toHaveValue('')
  for (const value of ['25', '']) {
    await cap.fill(value)
    await cap.press('Tab')
    await page.waitForLoadState('networkidle')
    await page.reload()
    await expect(cap).toHaveValue(value)
  }
})
