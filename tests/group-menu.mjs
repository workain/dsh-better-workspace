import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { source, chunk, entryHelpers } from './chunks.mjs'
const plain = value => JSON.parse(JSON.stringify(value))
function fixture() {
  const h = entryHelpers(chunk('operations'))
  const text = source('src/client.js')
  const helpers = text.slice(text.indexOf('      const managerScope = '), text.indexOf('      const boardActions = '))
  const menus = text.slice(text.indexOf('      const menuEntries = '), text.indexOf('\n\n      // The official contribution runs outside this component'))
  const calls = [], dialogs = [], errors = [], expansions = []
  const workspace = { workspaceId: 'w', sessionIds: ['m', 'nested', 'outside'] }
  const byId = {
    m: { title: 'a/Manager', origin: 'user' },
    nested: { title: 'a/b/Nested', origin: 'user' },
    outside: { title: 'ab/Other', origin: 'user' },
  }
  let bindings = { 'group:w:a': 'm' }
  const box = {
    ...h, items: [workspace], mutationState: { current: { items: [workspace], list: { byId }, archivedSessionIds: [] } },
    list: { byId }, sessFolders: {}, archivedSet: new Set(),
    bindingStore: { getSnapshot: () => ({ value: { serviceSessions: bindings } }) },
    serviceFeature: chunk('service'), rowTitleOf: (_id, summary) => summary.title,
    readTitles: async (_workspaceId, ids) => ids.map(id => ({ id, title: byId[id].title, sourceKind: 'user', eligible: true })),
    open: id => calls.push(['open', id]), setErrorText: error => errors.push(error),
    setDialog: dialog => dialogs.push(dialog), t: key => key, icon: () => null,
    startSessionInGroup: async (...args) => calls.push(['new', ...args]),
    actions: { setSessionsExpanded: (...args) => expansions.push(args), setSessionGroupExpanded: (...args) => expansions.push(args) },
    setCtx: () => {}, workspaceSlash: false, sessionSlash: true, boardActions: () => [], archiveFilterEntries: () => [],
    ot: null, presetFace: null, fail: error => errors.push(error), ctx: null,
  }
  vm.runInNewContext(helpers + menus + '\nthis.menu=menuEntries;this.pick=handleCtxPick;this.manager=openManager;this.start=startInGroup;', box)
  return { box, calls, dialogs, errors, expansions, bindings, byId, setBindings: value => { bindings = value } }
}
const target = { kind: 'sgroup', payload: { workspaceId: 'w', path: 'a', name: 'a', sessionIds: ['m'], empty: false } }
test('group menu contains requested actions and keeps deletion exclusive to empty groups', () => {
  const { box } = fixture(); box.ctx = target
  const ids = Array.from(box.menu(), item => item.id)
  for (const id of ['open-manager', 'service-binding', 'new-group-session', 'new-subgroup', 'rename-sgroup', 'move-group', 'customize']) assert.ok(ids.includes(id), id)
  assert.ok(!ids.includes('delete-sgroup'))
  box.ctx = { ...target, payload: { ...target.payload, empty: true } }
  assert.ok(Array.from(box.menu(), item => item.id).includes('delete-sgroup'))
})
test('assign group manager dispatches to exact recursive group rather than unreachable session branch', () => {
  const { box, dialogs } = fixture(); box.ctx = target; box.pick('service-binding')
  assert.equal(dialogs[0].bindingKey, 'group:w:a')
  assert.deepEqual(plain(dialogs[0].workspace.sessionIds), ['m', 'nested'])
})
test('manager opens only current eligible exact-scope assignment, independent of visible IDs', async () => {
  const { box, calls, bindings } = fixture()
  await box.manager('w', 'a'); assert.deepEqual(calls, [['open', 'm']])
  calls.length = 0; bindings['group:w:a'] = 'outside'
  await box.manager('w', 'a'); assert.deepEqual(calls, [])
  bindings['group:w:a'] = 'nested'
  await box.manager('w', 'a'); assert.deepEqual(calls, [['open', 'nested']])
})
test('manager assignment race, archive, foreign member, and unavailable title refuse navigation', async () => {
  for (const scenario of ['binding', 'archive', 'foreign', 'title']) {
    const f = fixture(), { box, calls, errors, bindings } = f
    const read = box.readTitles
    box.readTitles = async (...args) => {
      const rows = await read(...args)
      if (scenario === 'binding') bindings['group:w:a'] = 'nested'
      if (scenario === 'archive') box.mutationState.current.archivedSessionIds = ['m']
      if (scenario === 'foreign') box.mutationState.current.items[0].sessionIds = ['nested', 'outside']
      if (scenario === 'title') rows[0].eligible = false
      return rows
    }
    await box.manager('w', 'a'); assert.deepEqual(calls, [], scenario); assert.equal(errors.length, 1, scenario)
  }
})
test('unassigned manager offers exact group picker; new session uses captured workspace and expands ancestors', async () => {
  const { box, dialogs, calls, expansions, setBindings } = fixture(); setBindings({})
  await box.manager('w', 'a'); assert.equal(dialogs[0].bindingKey, 'group:w:a')
  await box.start('w', 'a/b')
  assert.deepEqual(calls, [['new', 'w', 'a/b']])
  assert.deepEqual(expansions, [['w', true], ['w|a', true], ['w|a/b', true]])
  box.ctx = target; box.pick('new-subgroup'); assert.equal(dialogs.at(-1).kind, 'subgroup-new')
})
test('group row provides a discoverable menu button without toggling the group', () => {
  const calls = []
  const React = { Component: class {}, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }
  const h = entryHelpers(chunk('operations'), { react: React })
  const tree = h.SessionGroupRow({ name: 'a', depth: 0, count: 2, expanded: true, onToggle: () => calls.push('toggle'), onContextMenu: () => calls.push('menu'), t: key => key })
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(walk)]
  const button = walk(tree).find(node => node.type === 'button' && node.props['aria-label'] === 'group.actions')
  assert.ok(button)
  button.props.onClick({ stopPropagation: () => calls.push('stop') })
  assert.deepEqual(calls, ['stop', 'menu'])
})
test('binding save revalidates exact group path and provenance before accepting assignment', async () => {
  const text = source('src/client.js'), h = entryHelpers(chunk('operations'))
  const start = text.indexOf('      bindingStore = serviceFeature.createBindingStore(')
  const end = text.indexOf('\n      const restoration = ', start)
  let row = { id: 'm', eligible: true, sourceKind: 'user', title: 'a/b/Manager' }
  const box = { ...h, serviceFeature: { createBindingStore: validate => validate }, readTitles: async () => [row] }
  vm.runInNewContext(text.slice(start, end), box)
  assert.equal(await box.bindingStore('w', 'm', 'group:w:a'), true)
  assert.equal(await box.bindingStore('w', 'm', 'group:w:a/b'), true)
  assert.equal(await box.bindingStore('w', 'm', 'group:w:ab'), false)
  assert.equal(await box.bindingStore('w', 'm', 'group:other:a'), false)
  row = { ...row, sourceKind: 'provider' }
  assert.equal(await box.bindingStore('w', 'm', 'group:w:a'), false)
  assert.equal(await box.bindingStore('w', 'm', 'w'), true)
})
test('local menu uses installed Menu anchorPoint and focus contract, not obsolete getAnchorRect', () => {
  const text = source('src/client.js')
  const start = text.indexOf('(ctx !== null && typeof ui.Menu')
  const end = text.indexOf(' : (ctx !== null ?', start)
  const expression = text.slice(start, end) + ' : null'
  const trigger = {}, box = { ctx: { x: 17, y: 23, trigger }, ui: { Menu() {} }, E: (_component, props) => props,
    setCtx() {}, menuEntries: () => [], handleCtxPick() {} }
  const props = vm.runInNewContext(expression, box)
  assert.deepEqual(plain(props.anchorPoint), { x: 17, y: 23 })
  assert.equal(props.contextual, true); assert.equal(props.autoFocus, true)
  assert.equal(props.returnFocus(), trigger); assert.equal(props.getAnchorRect, undefined)
})
