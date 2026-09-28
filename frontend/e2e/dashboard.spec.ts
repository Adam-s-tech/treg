import { expect, test } from '@playwright/test'
import { json, signIn } from './helpers'

test('sign in, create team, switch pages, refresh and navigate back', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page)
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
  for (const name of ['Catalog', 'Your own tools', 'Activity', 'Team']) {
    await navigation.getByRole('button', { name, exact: true }).click()
    await expect(navigation.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
  }
  await page.reload()
  await expect(navigation.getByRole('button', { name: 'Team', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(navigation.getByRole('button', { name: 'Activity', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.goForward()
  await expect(navigation.getByRole('button', { name: 'Team', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.locator('.rd-account-menu summary').click()
  await page.locator('.rd-account-menu').getByRole('button', { name: 'Billing', exact: true }).click()
  await expect(page).toHaveURL(/#orgs$/)
  const referral = page.getByRole('link', { name: 'Refer a friend: Give $5, get $5', exact: true })
  await expect(referral).toHaveText('Give $5, get $5')
  await referral.click()
  await expect(page).toHaveURL(/#referrals$/)
  expect(errors).toEqual([])
})

test('public catalog and shared deep links remain available without a session', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/catalog')
  await expect(page.locator('.pubnav')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Start free', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible()
  await page.goto('/catalog/google')
  await expect(page.locator('.pl-hero')).toBeVisible()
  await page.reload()
  await expect(page.locator('.pl-hero')).toBeVisible()
  // A job is its own URL: it survives a reload, and the breadcrumb leads back to the shelf.
  await page.locator('.pl-job').first().click()
  await expect(page).toHaveURL(/\/catalog\/google\/[^/]+$/)
  await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('table').getByRole('row').nth(1)).toBeVisible()
  await page.getByRole('table').getByRole('row').nth(1).click()
  await expect(page.getByRole('complementary', { name: 'Tool details' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Tool details' })).toHaveCount(0)
  await page.locator('.pl-crumbs').getByRole('link', { name: /Google/ }).click()
  await expect(page).toHaveURL(/\/catalog\/google$/)
  await page.goto('/app/tools/shared-example')
  await expect(page.getByRole('heading', { name: /shared-example/ })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible()
  expect(errors).toEqual([])
})

test('the dashboard and catalog ask for nothing that is not there', async ({ page }) => {
  const missing: string[] = []
  page.on('response', response => { if (response.status() === 404) missing.push(new URL(response.url()).pathname) })
  await signIn(page, 'no-404')
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
  for (const name of ['Catalog', 'Your own tools', 'Activity', 'Team', 'Getting started']) {
    await navigation.getByRole('button', { name, exact: true }).click()
    await expect(navigation.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
  }
  // Every platform tile on the catalog asks for its logo.
  await page.goto('/catalog')
  await page.waitForLoadState('networkidle')
  expect(missing).toEqual([])
})

test('Help renders the shared tutorials, which no other view downloads', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname) })
  await signIn(page, 'help')
  await page.waitForLoadState('networkidle')
  expect(scripts).not.toContain('/tutorial.js')
  await page.goto('/app#help')
  await expect(page.getByText(/The whole registry from your terminal.* [1-9]\d* steps\./)).toBeVisible()
  await page.getByRole('heading', { name: '▤ CLI tutorial' }).click()
  await expect(page.locator('.explain').first()).not.toBeEmpty()
})

test('a dialog takes its first field and hands focus back, even when its code arrives late', async ({ page }) => {
  await signIn(page, 'late-dialog')
  // Hold the dialog's code so it mounts well after the click that opened it.
  await page.route(/RequestToolDialog-[^/]*\.js$/, async route => {
    await new Promise(resolve => setTimeout(resolve, 1500))
    await route.continue()
  })
  await page.goto('about:blank')
  await page.goto('/app#connections')
  const opener = page.getByRole('button', { name: 'Request a tool', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Request a tool' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('e.g. Ahrefs backlinks, flight prices, HN comments')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('a routed tool can be tried by hand, and says who serves it in one line', async ({ page }) => {
  await signIn(page, 'routed-try')
  // The browser-test server holds no platform keys; answer the access dry-run the way a deployment
  // with two providers keyed would.
  await page.route('**/catalog/endpoints/treg.companies.enrich/access', route => route.fulfill(json({
    tier: 'routed', detail: 'routed',
    plan: [{ endpoint_id: 'dropleads.companies.enrich', provider: 'dropleads', tier: 'platform' },
           { endpoint_id: 'hunter.companies.enrich', provider: 'hunter', tier: 'platform' }],
    dropped: [{ endpoint_id: 'apollo.companies.enrich', why: 'no apollo key on this deployment and no own key' }],
  })))
  await page.goto('/app#platform/companies/enrich')
  await page.locator('.pl-autocard').getByRole('button', { name: 'Try it', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: /treg\.companies\.enrich/ })
  await expect(drawer.getByText(/One call: 2 providers can serve it for this team now/)).toBeVisible()
  await drawer.getByRole('button', { name: 'Manual', exact: true }).click()
  await expect(drawer.getByRole('button', { name: /Run/ })).toBeVisible()
  await expect(drawer.getByText(/needs a key/)).toHaveCount(0)
})
