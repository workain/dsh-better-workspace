import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { chunk, entryHelpers } from './chunks.mjs'
const plain = value => JSON.parse(JSON.stringify(value))
const creation = chunk('group-create')
const Menu = props => React.createElement('div', { 'data-menu-selected': props.selectedId }, props.anchor,
  props.open ? props.items.map(item => React.createElement('button', { key: item.id, 'data-menu-choice': item.id, onClick: () => props.onSelect(item.id) }, item.label)) : null)
const picker = chunk('group-picker', { react: React, '@deepseek-ai/dsh-client-ui-primitives': { Menu } })
const helpers = entryHelpers(chunk('operations'))
function fixture() {
  let next = 0
  const calls = [], rows = { blank: { id: 'blank', blank: true, retainedBy: { mainView: 1 } } }
  const snapshot = { items: [{ workspaceId: 'w', sessionIds: ['blank'] }], archivedSessionIds: [] }
  let renameFailure = false
  const sessions = {
    list: { getSnapshot: () => ({ byId: rows }) },
    refreshProjections: async () => {},
    create: async request => { calls.push(['create', plain(request)]); const id = 'new' + ++next; rows[id] = { id, blank: true }; snapshot.items[0].sessionIds.push(id); return id },
    using: async (id, options, callback) => {
      assert.equal(options.source, 'workspaceOperation')
      if (renameFailure) return { ok: false, error: { message: 'refused' } }
      await callback({ binding: { session: { rename: async title => { calls.push(['rename', id, title]); rows[id].title = title; rows[id].source = 'user' } } } })
      return { ok: true }
    },
  }
  const feature = creation.create({ sessions, workspaces: { list: { getSnapshot: () => snapshot } },
    uiWorkspace: { openSession: id => calls.push(['open', id]) }, sourceOf: row => row.source,
    leafForGroup: (title, opaque) => opaque && title.includes('/') ? '“' + title + '”' : title,
    groupLeaf: title => helpers.splitTitleSegs(title).slice(-1)[0],
    newTitle: () => 'New session',
  })
  return { feature, calls, rows, snapshot, failRename: () => { renameFailure = true } }
}
test('new group session is fresh, attached by workspaceId, user-renamed before reveal; never reuses another blank', async () => {
  const f = fixture(), id = await f.feature.start('w', 'parent/child')
  assert.deepEqual(f.calls, [['create', { workspaceId: 'w' }], ['rename', id, 'parent/child/New session'], ['open', id]])
  assert.equal(f.rows.blank.title, undefined)
  assert.equal(f.rows[id].source, 'user')
  assert.equal(f.feature.pathOf(id), 'parent/child')
  // The host's auto-title policy sees an explicitly user-owned title.
  assert.equal(helpers.groupsAllowedFor({ projectionValues: { 'betterWorkspace/titleSource': f.rows[id].source } }), true)
})
test('hero group changes preserve the original leaf; no-group strips only this helper’s assignment', async () => {
  const f = fixture()
  await f.feature.assign('blank', 'w', '')
  assert.deepEqual(f.calls, [])
  await f.feature.assign('blank', 'w', 'a/b')
  await f.feature.assign('blank', 'w', 'c')
  assert.equal(f.rows.blank.title, 'c/New session')
  await f.feature.assign('blank', 'w', '')
  assert.equal(f.rows.blank.title, 'New session')
  assert.equal(f.feature.pathOf('blank'), '')
})
test('opaque automatic slash title stays a single quoted leaf under the chosen group', async () => {
  const f = fixture(); f.rows.blank.title = 'Read /tmp/example/file'; f.rows.blank.source = 'provider'
  await f.feature.assign('blank', 'w', 'work')
  assert.equal(f.rows.blank.title, 'work/“Read /tmp/example/file”')
})
test('assignment rejects nonblank, foreign, archived, subagent and external manual titles without renaming', async () => {
  for (const mode of ['nonblank', 'foreign', 'archived', 'subagent', 'manual']) {
    const f = fixture()
    if (mode === 'nonblank') f.rows.blank.blank = false
    if (mode === 'foreign') f.snapshot.items[0].sessionIds = []
    if (mode === 'archived') f.snapshot.archivedSessionIds.push('blank')
    if (mode === 'subagent') f.rows.blank.origin = 'subagent'
    if (mode === 'manual') { f.rows.blank.title = 'Do not touch'; f.rows.blank.source = 'user' }
    await assert.rejects(f.feature.assign('blank', 'w', 'group'))
    assert.deepEqual(f.calls, [], mode)
  }
  const f = fixture(); await f.feature.assign('blank', 'w', 'one')
  f.rows.blank.title = 'Renamed in another browser'
  await assert.rejects(f.feature.assign('blank', 'w', ''), /title-changed/)
  assert.equal(f.rows.blank.title, 'Renamed in another browser')
})
test('reload regrouping uses the visible expected title and rejects external rename races', async () => {
  const f = fixture()
  f.rows.blank.title = 'old/nested/My draft'; f.rows.blank.source = 'user'
  await f.feature.assign('blank', 'w', 'new', 'old/nested/My draft')
  assert.equal(f.rows.blank.title, 'new/My draft')
  assert.equal(f.feature.pathOf('blank', 'different title'), undefined)
  await assert.rejects(f.feature.assign('blank', 'w', '', 'old/nested/My draft'), /title-changed/)
  await f.feature.assign('blank', 'w', '', 'new/My draft')
  assert.equal(f.rows.blank.title, 'My draft')
})
test('concurrent creation clicks share one fresh creation until it settles', async () => {
  const f = fixture()
  const one = f.feature.start('w', 'a'), two = f.feature.start('w', 'a')
  assert.equal(one, two)
  await Promise.all([one, two])
  assert.equal(f.calls.filter(row => row[0] === 'create').length, 1)
  await f.feature.start('w', 'a')
  assert.equal(f.calls.filter(row => row[0] === 'create').length, 2)
})
test('creation failure has no reveal; rename failure reveals the already-created member and rejects', async () => {
  const f = fixture(); await assert.rejects(f.feature.start('missing', 'g'), /workspace-missing/); assert.deepEqual(f.calls, [])
  f.failRename(); await assert.rejects(f.feature.start('w', 'g'), /refused/)
  assert.deepEqual(f.calls, [['create', { workspaceId: 'w' }], ['open', 'new1']])
})
test('candidate groups include nested and explicit empty paths, scoped to selected workspace and user titles only', () => {
  const workspace = { workspaceId: 'w', sessionIds: ['manual', 'auto', 'child', 'cached'] }
  const list = { byId: {
    manual: { id: 'manual', title: 'parent/child/Task', projectionValues: { 'betterWorkspace/titleSource': 'user' } },
    auto: { id: 'auto', title: 'not/a/group', projectionValues: { 'betterWorkspace/titleSource': 'provider' } },
    child: { id: 'child', origin: 'subagent', title: 'hidden/task' }, cached: { id: 'cached' },
    foreign: { id: 'foreign', title: 'foreign/Task' },
  } }
  const state = { folders: { sess: { w: ['empty/nested'], other: ['foreign/empty'] } } }
  const options = picker.options(list, workspace, state, { ...helpers, cache: { cached: { title: 'remembered/Task' } } })
  assert.deepEqual(plain(options), [{ path: 'empty', depth: 0 }, { path: 'empty/nested', depth: 1 }, { path: 'parent', depth: 0 }, { path: 'parent/child', depth: 1 }, { path: 'remembered', depth: 0 }])
  assert.deepEqual(plain(picker.options(list, undefined, {}, { ...helpers, cache: {} })), [])
})

test('DOM hero selector: nested/empty targets, none, workspace reset, failed write and no leaked async result', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const list = { byId: { first: { id: 'first', blank: true }, second: { id: 'second', blank: true } } }
  const workspaces = { items: [{ workspaceId: 'one', sessionIds: ['first'] }, { workspaceId: 'two', sessionIds: ['second'] }] }
  let current = 'first', workspaceId = 'one', reject = false, gate, calls = []
  const props = { Menu, useSessions: selector => selector(list), useWorkspaces: selector => selector(workspaces), useStore: selector => selector({}),
    currentSessionId: () => current, groupPath: () => '', t: key => key,
    groupOptions: (_, workspace) => workspace.workspaceId === 'one' ? [{ path: 'p', depth: 0 }, { path: 'p/empty', depth: 1 }] : [{ path: 'other', depth: 0 }],
    assignSessionGroup: async (...args) => { calls.push(args); if (gate) await gate; if (reject) throw Error('write failed') },
  }
  const render = () => root.render(React.createElement(picker.GroupPicker, { ...props, workspaceId }))
  const trigger = () => document.querySelector('[aria-label="heroGroup.label"]')
  const selected = () => document.querySelector('[data-menu-selected]').getAttribute('data-menu-selected')
  const open = async () => { await act(() => trigger().click()) }
  const choose = async value => {
    if (trigger().getAttribute('aria-expanded') !== 'true') await open()
    await act(() => document.querySelector('[data-menu-choice="' + (value ? 'group:' + value : 'none') + '"]').click())
  }
  try {
    await act(render); await open()
    assert.deepEqual([...document.querySelectorAll('[data-menu-choice]')].map(row => row.getAttribute('data-menu-choice')), ['none', 'group:p', 'group:p/empty'])
    await choose('p/empty'); assert.equal(selected(), 'group:p/empty')
    await choose(''); assert.equal(selected(), 'none')
    assert.deepEqual(calls, [['first', 'one', 'p/empty', ''], ['first', 'one', '', '']])
    reject = true; await choose('p'); assert.equal(document.querySelector('[role=alert]').textContent, 'heroGroup.error')
    reject = false
    let release; gate = new Promise(resolve => { release = resolve })
    await choose('p')
    assert.equal(trigger().disabled, true)
    workspaceId = 'two'; current = 'second'; await act(render)
    assert.equal(selected(), 'none')
    assert.equal(document.querySelector('[role=alert]'), null)
    await act(async () => { release(); await gate })
    assert.equal(selected(), 'none')
    await open()
    assert.deepEqual([...document.querySelectorAll('[data-menu-choice]')].map(row => row.getAttribute('data-menu-choice')), ['none', 'group:other'])
  } finally { await act(() => root.unmount()); dom.window.close() }
})
