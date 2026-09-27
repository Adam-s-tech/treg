import { expect, test, type Page } from '@playwright/test'
import { billingOn, hubOn, hubTool, openTopUp, signIn } from './helpers'

// At phone width the page itself never scrolls sideways: wide tables and code scroll inside
// themselves, and everything else wraps.
test.use({ viewport: { width: 390, height: 844 } })

const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)

test('the top-up dialog shows every amount on a phone', async ({ page }) => {
  await billingOn(page)
  await signIn(page, 'phone-topup')
  await openTopUp(page)
  const dialog = page.getByRole('dialog')
  for (const name of ['$10', '$50', '$100', '$200', 'Other']) {
    // A preset's name carries its bonus ("$50 +$2.50 bonus"); match on the amount it starts with.
    const amount = new RegExp('^' + name.replace('$', '\\$') + '(\\s|$)')
    const box = (await dialog.getByRole('button', { name: amount }).boundingBox())!
    expect(box.x, name).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, name).toBeLessThanOrEqual(390)
  }
  expect(await fitsWidth(page)).toBe(true)
})

test('a hub tool page does not scroll sideways on a phone', async ({ page }) => {
  await hubOn(page)
  await signIn(page, 'phone-hub')
  await page.goto('/app#hub')
  await page.getByText(hubTool.tool_id, { exact: true }).click()
  await expect(page.getByText(hubTool.uses[0]!, { exact: true })).toBeVisible()
  expect(await fitsWidth(page)).toBe(true)
})

test('a platform ledger keeps provider prices clear of each other on a phone', async ({ page }) => {
  await page.goto('/catalog/people')
  await expect(page.getByRole('table').first()).toBeVisible()
  await expect(page.getByText(/^from \$/).first()).toBeVisible()
  expect(await fitsWidth(page)).toBe(true)
  // No two pieces of text in one ledger row paint over each other. Text an ancestor clips (a route
  // cut short with an ellipsis) counts only where it is painted.
  const overlaps = await page.evaluate(() => {
    const painted = (el: HTMLElement, row: Element) => {
      const r = el.getBoundingClientRect()
      let { left, right, top, bottom } = r
      for (let p = el.parentElement; p && p !== row; p = p.parentElement) {
        if (getComputedStyle(p).overflowX === 'visible') continue
        const c = p.getBoundingClientRect()
        left = Math.max(left, c.left); right = Math.min(right, c.right); top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom)
      }
      return { left, right, top, bottom }
    }
    const found: string[] = []
    for (const row of document.querySelectorAll('tr')) {
      const texts = [...row.querySelectorAll<HTMLElement>('*')].filter(el =>
        [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) && el.getClientRects().length)
      const boxes = texts.map(el => ({ el, r: painted(el, row) })).filter(b => b.r.right > b.r.left && b.r.bottom > b.r.top)
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        if (a.r.right - 1 > b.r.left && b.r.right - 1 > a.r.left && a.r.bottom - 1 > b.r.top && b.r.bottom - 1 > a.r.top)
          found.push(`${a.el.textContent!.trim()} / ${b.el.textContent!.trim()}`)
      }
    }
    return found
  })
  expect(overlaps).toEqual([])
})
