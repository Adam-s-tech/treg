import { expect, test } from 'vitest'
import { reviewSummary } from '../src/state/catalog.js'

const r = (useful: number, partly: number, teams: number) =>
  ({ teams, share: { useful, partly, not_useful: Math.max(0, 1 - useful - partly) } })

test('the label follows the positive share, a partly useful verdict counting half', () => {
  expect(reviewSummary(r(0.8, 0, 5))).toMatchObject({ tone: 'pos', label: 'Positive', pct: 80 })
  expect(reviewSummary(r(0.6, 0.4, 5))).toMatchObject({ label: 'Positive', pct: 80 })
  expect(reviewSummary(r(0.7, 0, 5)).label).toBe('Mostly positive')
  expect(reviewSummary(r(0.4, 0, 5))).toMatchObject({ tone: 'mixed', label: 'Mixed' })
  expect(reviewSummary(r(0.2, 0, 5))).toMatchObject({ tone: 'neg', label: 'Mostly negative' })
  expect(reviewSummary(r(0.1, 0, 5)).label).toBe('Negative')
})

test('the stronger words wait for enough teams', () => {
  expect(reviewSummary(r(1, 0, 10)).label).toBe('Positive')
  expect(reviewSummary(r(1, 0, 25)).label).toBe('Very positive')
  expect(reviewSummary(r(0.94, 0, 50)).label).toBe('Very positive')
  expect(reviewSummary(r(0.96, 0, 50)).label).toBe('Overwhelmingly positive')
  expect(reviewSummary(r(0, 0, 25)).label).toBe('Very negative')
  expect(reviewSummary(r(0, 0, 50)).label).toBe('Overwhelmingly negative')
})

test('a label ranks above the one below it, whatever the share', () => {
  const very = reviewSummary(r(0.9, 0, 25)), plain = reviewSummary(r(0.97, 0, 10))
  expect([very.label, plain.label]).toEqual(['Very positive', 'Positive'])
  expect(very.rank).toBeGreaterThan(plain.rank)
})
