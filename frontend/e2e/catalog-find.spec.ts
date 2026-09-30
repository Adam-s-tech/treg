import { expect, test, type Page } from '@playwright/test'

// The Catalog box (state/find.js): a typing pause asks the finder only when the name filter shows
// nothing and the query is more than one short word; its answer sits above the shelves, and an
// empty one is a single line. Enter asks for the full answer, as before. The browser-test server has
// no judge key, so /catalog/find is answered here and every request to it is counted.

const row = (id: string, p: number) => ({
  id, name: id, provider: id.split('.')[0], provider_display: id.split('.')[0], platform: 'people',
  platform_label: 'People & contact data', capability: 'people.email.find',
  capability_description: 'Find a work email', cost: null, p, fit_from: 'job' })

async function answer(page: Page, judged: object) {
  const asked: string[] = []
  await page.route('**/catalog/find?**', route => {
    asked.push(new URL(route.request().url()).searchParams.get('q') || '')
    return route.fulfill({ status: 200, contentType: 'application/x-ndjson',
      body: JSON.stringify({ event: 'candidates', candidates: [] }) + '\n'
          + JSON.stringify({ event: 'judged', named: '', read: 3, high: 0.7, rows: [], ...judged }) + '\n' })
  })
  await page.goto('/catalog')
  await expect(page.locator('.pl-sec').first()).toBeVisible()
  return asked
}

const box = (page: Page) => page.locator('.cat-find input')

test('a typing pause answers above the shelves and leaves them in place', async ({ page }) => {
  const asked = await answer(page, { verdict: 'strong', rows: [row('hunter.people.email.find', 0.9)] })
  const shelves = await page.locator('.pl-sec').count()
  await box(page).pressSequentially('find the work email of a dentist', { delay: 5 })
  await expect(page.locator('.fa .ui-tbody .ui-tr')).toHaveCount(1)
  expect(asked).toEqual(['find the work email of a dentist'])
  await expect(page.locator('.pl-sec')).toHaveCount(shelves)                 // the shelves stay
  await expect(page.locator('.cat-card.find-dim')).toHaveCount(0)            // and are not re-lit
  await expect(page.locator('.cat-find-suggest')).toBeVisible()              // Enter still offers the full answer
})

test('an empty auto answer is one line, never a page', async ({ page }) => {
  await answer(page, { verdict: 'none', reason: 'gap' })
  await box(page).pressSequentially('book a table for two tonight', { delay: 5 })
  const line = page.locator('.fa .fa-line')
  await expect(line).toContainText('treg does not have this kind of data or action yet')
  await expect(page.locator('.fa .fa-note, .fa .ui-table')).toHaveCount(0)
  expect((await line.boundingBox())!.height).toBeLessThan(40)
  await expect(page.locator('.pl-sec').first()).toBeVisible()
})

test('no auto-find while a platform name matches, or for one short word; Enter still asks', async ({ page }) => {
  const asked = await answer(page, { verdict: 'name', named: 'platform', rows: [] })
  await box(page).pressSequentially('tiktok', { delay: 5 })
  await expect(page.locator('.cat-card').first()).toBeVisible()
  await page.waitForTimeout(1200)
  await box(page).fill('')
  await box(page).pressSequentially('zqx', { delay: 5 })
  await page.waitForTimeout(1200)
  expect(asked).toEqual([])
  await box(page).fill('tiktok')
  await box(page).press('Enter')
  await expect.poll(() => asked).toEqual(['tiktok'])
})
