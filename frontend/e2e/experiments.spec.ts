import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers'

// Stands in for posthog-js: `answer` is the variant its flags resolve to, or undefined to never answer.
// Every flag read is recorded, because a read is what PostHog counts as an exposure.
async function stubPostHog(page: Page, answer?: string) {
  await page.addInitScript(variant => {
    const w = window as any
    w.__phInit = true
    w.__flagReads = []
    w.posthog = {
      identify() {}, group() {}, capture() {},
      onFeatureFlags(callback: Function) { if (variant !== undefined) setTimeout(() => callback([], {}, { errorsLoading: false }), 50) },
      getFeatureFlag(key: string) { w.__flagReads.push(key); return variant },
    }
  }, answer)
}

const grid = (page: Page) => page.locator('.rd-try .try-grid')

test('the banner arm shows a banner on every prompt card', async ({ page }) => {
  await stubPostHog(page, 'test')
  await signIn(page, 'art-test')
  await expect(grid(page)).toHaveAttribute('data-art', 'test')
  await expect(grid(page).locator('.rd-try-banner')).toHaveCount(await grid(page).locator('.try-card').count())
  expect(await page.evaluate(() => (window as any).__flagReads)).toEqual(['getting-started-example-art'])
})

test('the control arm shows text-only prompt cards', async ({ page }) => {
  await stubPostHog(page, 'control')
  await signIn(page, 'art-control')
  await expect(grid(page)).toHaveAttribute('data-art', 'control')
  await expect(grid(page).locator('.rd-try-banner')).toHaveCount(0)
})

test('without an answer from PostHog the cards fall back to control and record no exposure', async ({ page }) => {
  await stubPostHog(page)
  await signIn(page, 'art-silent')
  await expect(grid(page)).toHaveAttribute('data-art', 'control')
  await expect(grid(page).locator('.rd-try-banner')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__flagReads)).toEqual([])
})
