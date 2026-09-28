import { expect, test, type Page } from '@playwright/test'
import { signIn, stubPostHog } from './helpers'

const ph = (page: Page) => page.evaluate(() => (window as any).__ph)
const actions = async (page: Page) => (await ph(page)).events.filter(([n]: [string]) => n === 'catalog_action').map(([, p]: [string, any]) => p)

test('the control arm gets the ledger, whatever the address, and counts the same actions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await stubPostHog(page, 'control')
  await page.goto('/catalog/google')
  await expect(page.locator('table.ledger')).toBeVisible()
  await expect(page.locator('.pl-hero')).toHaveCount(0)
  expect(await ph(page)).toMatchObject({ reads: ['catalog-v2'], registered: { catalog_arm: 'control' } })

  await page.locator('tr.lrow.merged').first().click()
  await page.locator('button.lsub').first().click()
  await page.locator('.lcall button').first().click()
  expect(await actions(page)).toEqual([expect.objectContaining({ action: 'copy', surface: 'ledger', arm: 'control', platform: 'google' })])
  const names = (await ph(page)).events.map(([n]: [string]) => n)
  expect(names).toEqual(['catalog_platform_viewed', 'catalog_job_viewed', 'catalog_tool_opened', 'catalog_action'])

  // A job's address, reached after the arm is dealt, is its shelf: the ledger has no job pages.
  await page.evaluate(() => {
    history.pushState({ platform: 'google' }, '', '/catalog/google/x')
    dispatchEvent(new PopStateEvent('popstate', { state: { platform: 'google' } }))
  })
  await expect(page.locator('table.ledger')).toBeVisible()
  expect(errors).toEqual([])
})

test('the test arm gets the shelf and the same events', async ({ page }) => {
  await stubPostHog(page, 'test')
  await page.goto('/catalog/google')
  await expect(page.locator('.pl-hero')).toBeVisible()
  await page.locator('.pl-job').first().click()
  await page.getByRole('table').getByRole('row').nth(1).click()
  await page.getByRole('complementary', { name: 'Tool details' }).getByRole('button', { name: 'Copy' }).click()
  expect(await actions(page)).toEqual([expect.objectContaining({ action: 'copy', surface: 'job', arm: 'test', platform: 'google' })])
  const names = (await ph(page)).events.map(([n]: [string]) => n)
  expect(names).toEqual(['catalog_platform_viewed', 'catalog_job_viewed', 'catalog_tool_opened', 'catalog_action'])
})

test('a visitor who lands on a job page, or has no flag, is outside the experiment and gets the shelf', async ({ page, context }) => {
  await stubPostHog(page, null)
  await page.goto('/catalog/google')
  await expect(page.locator('.pl-hero')).toBeVisible()
  expect(await ph(page)).toMatchObject({ reads: ['catalog-v2'], registered: { catalog_arm: 'off' } })
  const job = await page.locator('.pl-job').first().getAttribute('href')

  // Job pages exist only in v2, so landing on one is not an exposure: no flag read, the shelf's job.
  const direct = await context.newPage()
  await stubPostHog(direct, 'control')
  await direct.goto(job!)
  await expect(direct.getByRole('table').getByRole('row').nth(1)).toBeVisible()
  expect(await ph(direct)).toMatchObject({ reads: [], registered: { catalog_arm: 'direct' } })
})

test('signed in, the control arm keeps the provider page it had', async ({ page }) => {
  await stubPostHog(page, 'control')
  await signIn(page)
  await page.goto('/app#platform/google')
  await expect(page.locator('table.ledger')).toBeVisible()
  await page.locator('.plat-provs .btn').first().click()
  await expect(page.getByText('Covered in the catalog')).toBeVisible()
  await expect(page.locator('.pv-shelf')).toHaveCount(0)
})
