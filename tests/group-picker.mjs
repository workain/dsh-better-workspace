import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { chunk, entryHelpers } from './chunks.mjs'
const plain = value => JSON.parse(JSON.stringify(value))
const creation = chunk('group-create')
const Menu = props => React.createElement('div', { 'data-menu-selected': props.selectedId }, props.anchor,
  props.open ? [...props.items, ...(props.footer || [])].map(item => React.createElement('button', { key: item.id, 'data-menu-choice': item.id, onClick: () => props.onSelect(item.id) }, item.label)) : null)
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
  const workspaces = { items: [{ workspaceId: 'one', sessionIds: ['first'] }, { workspaceId: 'two', sessionIds: ['second'] }, { workspaceId: 'empty', sessionIds: [] }] }
  let current = 'first', workspaceId = 'one', reject = false, gate, calls = []
  const props = { Menu, useSessions: selector => selector(list), useWorkspaces: selector => selector(workspaces), useStore: selector => selector({}),
    currentSessionId: () => current, groupPath: () => '', t: key => key,
    groupOptions: (_, workspace) => workspace.workspaceId === 'one' ? [{ path: 'p', depth: 0 }, { path: 'p/empty', depth: 1 }] : workspace.workspaceId === 'two' ? [{ path: 'other', depth: 0 }] : [],
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
    await act(render)
    assert.equal(trigger().className, 'bw-hero-group-chip')
    assert.equal(trigger().textContent, 'heroGroup.none▾', 'only the selected value and chevron, no field-name prefix')
    assert.equal(document.querySelector('small'), null, 'no caption below the dropdown')
    assert.equal(document.querySelector('.bw-select'), null, 'does not inherit the boxed settings select style')
    await open()
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
    workspaceId = 'empty'; await act(render)
    assert.equal(trigger(), null, 'no dropdown when selected workspace has no groups')
    assert.equal(document.querySelector('.bw-hero-group'), null, 'no empty layout wrapper either')
    workspaceId = 'two'; await act(render)
    assert.ok(trigger(), 'dropdown returns when selecting a workspace with groups')
    assert.equal(trigger().getAttribute('aria-expanded'), 'false', 'old open menu state does not leak across workspaces')
  } finally { await act(() => root.unmount()); dom.window.close() }
})

// Modal owns the real focus/Escape layer in production; this double exposes its
// close command so busy guarding and accessible contents can be verified in DOM.
const Modal = props => props.open ? React.createElement('div', { role: 'dialog', 'aria-label': props.title },
  React.createElement('button', { 'aria-label': props.closeLabel, onClick: props.onClose }, '×'), props.children, props.footer) : null
const Button = ({ variant, ...props }) => React.createElement('button', props)

test('DOM create group: footer only, cancel, validation, nested path, busy guard, assignment and retry', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const rows = { first: { id: 'first', blank: true, title: 'Draft' }, second: { id: 'second', blank: true, title: 'Other' } }
  const list = { byId: rows }
  const workspaces = { items: [{ workspaceId: 'one', sessionIds: ['first'] }, { workspaceId: 'two', sessionIds: ['second'] }] }
  let current = 'first', workspaceId = 'one', createOpen = false, paths = [{ path: 'existing', depth: 0 }], calls = [], closed = 0, gate, fail = false
  const props = { Menu, Modal, Button, useSessions: select => select(list), useWorkspaces: select => select(workspaces), useStore: select => select({}),
    currentSessionId: () => current, groupPath: () => '', groupOptions: () => paths, t: key => key,
    assignSessionGroup: async () => { throw Error('unexpected separate assignment') },
    onCreateClose: () => { closed++; createOpen = false },
    normalizeGroupPath: raw => { const parts = raw.trim().split('/').map(part => part.trim()); if (parts.some(part => !part || part === '..')) throw Error('invalid'); return parts.join('/') },
    createSessionGroup: async (...args) => {
      calls.push(args); if (gate) await gate
      if (fail) throw Error('failed')
      if ((rows[args[0]].title || '') !== args[3]) throw Error('title-changed')
      paths = [...paths, { path: args[2], depth: 0 }]
    },
  }
  const render = () => root.render(React.createElement(picker.GroupPicker, { ...props, workspaceId, createOpen }))
  const trigger = () => document.querySelector('[aria-label="heroGroup.label"]')
  const dialog = () => document.querySelector('[role=dialog]')
  const button = label => [...dialog().querySelectorAll('button')].find(node => node.textContent === label)
  const footerOpen = async () => {
    await act(() => trigger().click())
    assert.deepEqual([...document.querySelectorAll('[data-menu-choice]')].map(node => node.dataset.menuChoice), ['none', ...paths.map(path => 'group:' + path.path), 'create-group'])
    await act(() => document.querySelector('[data-menu-choice="create-group"]').click())
  }
  const input = async value => {
    const node = dialog().querySelector('input')
    // React's test environment is loaded before JSDOM; invoke its registered
    // change handler to avoid depending on feature detection at module import.
    const reactProps = node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
    await act(() => reactProps.onChange({ target: { value } }))
  }
  const submit = async () => { await act(() => button('heroGroup.createConfirm').click()) }
  try {
    await act(render)
    assert.equal(document.querySelectorAll('button').length, 1, 'no second creation button beside chip')
    await footerOpen()
    assert.equal(dialog().querySelector('label').textContent, 'heroGroup.path')
    assert.equal(dialog().querySelector('input').hasAttribute('data-modal-autofocus'), true)
    await act(() => button('cancel').click())
    assert.equal(dialog(), null); assert.deepEqual(calls, [])
    await footerOpen(); await submit()
    assert.equal(dialog().querySelector('[role=alert]').textContent, 'heroGroup.invalidPath')
    assert.deepEqual(calls, [])
    await input('parent/../bad'); await submit(); assert.deepEqual(calls, [])
    await input(' parent / child ')
    let release; gate = new Promise(resolve => { release = resolve })
    await submit(); await submit()
    assert.deepEqual(calls, [['first', 'one', 'parent/child', 'Draft']])
    assert.equal(button('cancel').disabled, true); assert.equal(dialog().querySelector('input').disabled, true)
    await act(() => dialog().querySelector('[aria-label=close]').click())
    assert.ok(dialog(), 'native close command cannot dismiss a pending write')
    await act(async () => { release(); await gate }); gate = null
    assert.equal(dialog(), null)
    assert.equal(document.querySelector('[data-menu-selected]').dataset.menuSelected, 'group:parent/child')
    assert.equal(closed, 2)
    await footerOpen(); await input('retry'); fail = true; await submit()
    assert.equal(dialog().querySelector('[role=alert]').textContent, 'heroGroup.error')
    assert.equal(dialog().querySelector('input').value, 'retry')
    fail = false; await submit(); assert.equal(dialog(), null)
    assert.equal(document.querySelector('[data-menu-selected]').dataset.menuSelected, 'group:retry')

    // No existing groups still has no chip/wrapper; only an explicit external
    // request from the workspace picker opens the same creation dialog.
    paths = []; await act(render)
    assert.equal(trigger(), null); assert.equal(dialog(), null)
    createOpen = true; await act(render)
    assert.ok(dialog()); assert.equal(trigger(), null)
    await input('external/nested'); await submit(); await act(render)
    assert.equal(dialog(), null)
    assert.equal(document.querySelector('[data-menu-selected]').dataset.menuSelected, 'group:external/nested')

    await footerOpen(); await input('must-not-overwrite')
    rows.first.title = 'Fresh external rename'; await act(render); await submit()
    assert.equal(calls.at(-1)[3], 'Draft', 'expected title belongs to dialog-open snapshot, not submit render')
    assert.equal(rows.first.title, 'Fresh external rename')
    assert.equal(dialog().querySelector('[role=alert]').textContent, 'heroGroup.error')
    await act(() => button('cancel').click())

    await footerOpen(); await input('stale')
    gate = new Promise(resolve => { release = resolve }); await submit()
    const oldClosed = closed
    workspaceId = 'two'; current = 'second'; await act(render)
    assert.equal(dialog(), null)
    workspaceId = 'one'; current = 'first'; await act(render)
    await footerOpen(); await input('new dialog')
    await act(async () => { release(); await gate }); gate = null
    assert.equal(closed, oldClosed, 'stale success cannot dismiss a new dialog even after switching back')
    assert.equal(dialog().querySelector('input').value, 'new dialog')
    await act(() => button('cancel').click())
    createOpen = true; await act(render); assert.ok(dialog())
    current = 'second'; workspaceId = 'two'; await act(render)
    assert.equal(dialog(), null, 'external request does not reopen on identity change')
  } finally { await act(() => root.unmount()); dom.window.close() }
})
