import { expect, test } from 'vitest'
import find, { findNoneText, isJobQuery } from '../src/state/find.js'
import findComputed from '../src/state/findComputed.js'

test('a name filters, a sentence or a question asks', () => {
  expect(isJobQuery('tiktok')).toBe(false)
  expect(isJobQuery('google search console')).toBe(false)
  expect(isJobQuery('why is my blog losing traffic')).toBe(true)
  expect(isJobQuery('who links to me?')).toBe(true)
})

const row = (id: string, capability: string, p: number | null, platform = 'meta-ads') =>
  ({ id, capability, capability_description: capability + ' job', name: id, platform, platform_label: platform, p })

test('rows group by capability, best fit first, providers kept in server order', () => {
  const vm = { find: { verdict: 'strong', rows: [
    row('a.x', 'ads.search', 0.62), row('b.x', 'ads.search', 0.91), row('c.x', 'ads.page', 0.75, 'facebook'),
  ] } }
  const groups = findComputed.findGroups.call(vm)
  expect(groups.map(g => [g.label, g.p])).toEqual([['ads.search job', 0.91], ['ads.page job', 0.75]])
  expect(groups[0].rows.map(r => r.id)).toEqual(['a.x', 'b.x'])
  const strong = findComputed.findStrong.call({ findGroups: groups, find: { high: 0.7 } })
  expect(strong).toHaveLength(2)
})

test.each(['keyword', 'name'])('unjudged %s rows keep their order and carry no fit', verdict => {
  const vm = { find: { verdict, rows: [row('z', 'b', null), row('y', 'a', null)] } }
  const groups = findComputed.findGroups.call(vm)
  expect(groups.map(g => g.label)).toEqual(['b job', 'a job'])
  expect(findComputed.findStrong.call({ findGroups: groups, find: { high: 0.7 } })).toEqual([])
})

test('a group knows where its fit came from and how many vendors were folded away', () => {
  const rows = [
    { ...row('a.x', 'people.email.find', 0.55, 'people'), fit_from: 'job', children_hidden: 18 },
    { ...row('b.x', 'people.email.find', 0.55, 'people'), fit_from: 'job' },
    { ...row('c.x', 'people.email.find', 0.8, 'people'), fit_from: 'endpoint' },
  ]
  const [g] = findComputed.findGroups.call({ find: { rows } })
  expect([g.p, g.fitFrom, g.hidden]).toEqual([0.8, 'endpoint', 18])
  const vm = { findProviders: find.findProviders }
  expect(find.findProvidersText.call(vm, { rows: rows.map((r, i) => ({ ...r, provider: 'v' + i })), hidden: 18 }))
    .toBe('3 of 21 providers')
  expect(find.findFitTitle.call({}, g)).toBe("Fit of one provider's own tool: 80%")
  expect(find.findFitTitle.call({}, { p: 0.55, fitFrom: 'job' })).toBe('Fit for this job: 55%')
})

test('an empty answer says whether treg lacks it or the text is not a job', () => {
  expect(findNoneText('gap')).toMatch(/does not have this kind of data or action yet/)
  expect(findNoneText('not_task')).toMatch(/does not read as a job/)
  expect(findNoneText('')).toMatch(/does not read as a job/)
})
