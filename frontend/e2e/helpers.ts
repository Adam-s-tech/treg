import { expect, type Page, type Route } from '@playwright/test'
import tool from './fixtures/hub-tool.json' with { type: 'json' }
import health from './fixtures/hub-health.json' with { type: 'json' }
import run from './fixtures/hub-run.json' with { type: 'json' }

export const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** A fresh verified user with one team, landed on the dashboard. */
export async function signIn(page: Page, who = 'browser', team = 'Browser test team') {
  await page.goto('/app?ref=frontend-test')
  await page.getByPlaceholder('you@work.com').fill(`${who}-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click()
  const code = await page.getByText(/dev code \d{6}/).innerText()
  await page.getByPlaceholder('6-digit code').fill(code.match(/\d{6}/)![0])
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByPlaceholder('Team name, e.g. Superdesign').fill(team)
  await page.getByRole('button', { name: 'Create team →', exact: true }).click()
  await expect(page.getByText('Which agent are you using?', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Skip', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
}

/** The browser-test server runs with the hub off; this answers its routes with shapes captured live. */
export async function hubOn(page: Page) {
  await page.route('**/meta', async route => route.fulfill(json({ ...(await (await route.fetch()).json()), hub: true })))
  await page.route('**/hub/tools/mine', route => route.fulfill(json([tool])))
  await page.route('**/hub/tools/*/earnings*', route => route.fulfill(json(
    { tool_id: tool.tool_id, days: 90, earned_micro: 0, runs: 0, avg_price_micro: 0, by_day: [] })))
  await page.route('**/hub/tools/*/health', route => route.fulfill(json(health)))
  await page.route('**/hub/runs/*', route => route.fulfill(json(run)))
}

/** The browser-test server sells no balance; this makes its real /billing answer say it does. */
export async function billingOn(page: Page) {
  await page.route('**/billing', async (route: Route) =>
    route.fulfill(json({ ...(await (await route.fetch()).json()), configured: true })))
}

export async function openTopUp(page: Page) {
  await page.goto('/app#orgs')
  await page.getByRole('button', { name: 'Billing', exact: true }).click()
  await page.getByRole('button', { name: 'Top up', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

export const hubTool = tool
export const hubRun = run
