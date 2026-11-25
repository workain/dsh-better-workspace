import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { source, entryHelpers, chunk } from './chunks.mjs'
const text = source('src/client.js')
const helpers = entryHelpers(chunk('operations'))
const normalizer = text.slice(text.indexOf('    const normalizeHeroGroupPath = '), text.indexOf('    /** Stable empty array', text.indexOf('    const normalizeHeroGroupPath = ')))
function normalize() {
  const box = { splitTitleSegs: helpers.splitTitleSegs }
  vm.runInNewContext(normalizer + '\nthis.normalize = normalizeHeroGroupPath;', box)
  return box.normalize
}
test('new hero group path validates canonical nested and quoted paths, rejecting empty/control/path-like names', () => {
  const norm = normalize()
  assert.equal(norm('  parent / child  '), 'parent/child')
  assert.equal(norm('parent/“quoted/slash”'), 'parent/“quoted/slash”')
  for (const value of ['', ' / ', '\n', 'bad\u0000name', 'a\nb', 'a'.repeat(1025), '/tmp/example/file', 'https://example.test/path']) assert.throws(() => norm(value), undefined, value)
})
test('create callback assigns before declaration/expansion, with no group persisted on refused title', async () => {
  const start = text.indexOf('          createSessionGroup: async ')
  const end = text.indexOf('          groupPath:', start)
  const calls = []
  const box = { normalizeHeroGroupPath: normalize(), splitTitleSegs: helpers.splitTitleSegs,
    groupCreation: { assign: async (...args) => calls.push(['assign', ...args]) },
    viewInstance: { actions: {
      addFolder: (...args) => calls.push(['folder', ...args]),
      setSessionsExpanded: (...args) => calls.push(['workspace', ...args]),
      setSessionGroupExpanded: (...args) => calls.push(['expand', ...args]),
    } },
  }
  const api = vm.runInNewContext('({' + text.slice(start, end) + '})', box)
  await api.createSessionGroup('s', 'w', 'parent/child', 'Draft')
  assert.deepEqual(calls, [['assign', 's', 'w', 'parent/child', 'Draft'], ['folder', 'session', 'w', 'parent/child'], ['workspace', 'w', true], ['expand', 'w|parent', true], ['expand', 'w|parent/child', true]])
  calls.length = 0
  box.groupCreation.assign = async () => { throw Error('title changed') }
  await assert.rejects(api.createSessionGroup('s', 'w', 'other', 'Draft'), /title changed/)
  assert.deepEqual(calls, [])
})
test('workspace menu exposes creation for first group only for selected workspace owning eligible blank', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>')
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  let groupProps, closed = 0
  const Menu = props => React.createElement('div', null, props.children, ...(props.open ? props.footer || [] : []).map(item => React.createElement('button', { key: item.id, 'data-footer': item.id, onClick: () => props.onSelect(item.id) }, item.label)))
  const h = entryHelpers(chunk('operations'), { react: React, '@deepseek-ai/dsh-client-ui-primitives': { Menu } })
  const list = { byId: { s: { id: 's', blank: true, retainedBy: { mainView: 1 } } } }
  const snapshot = { items: [{ workspaceId: 'w', title: 'Work', sessionIds: ['s'] }, { workspaceId: 'foreign', title: 'Other', sessionIds: [] }], archivedSessionIds: [] }
  let selectedId = 'w', grouping = true
  const props = {
    open: true, useSessions: selector => selector(list), useWorkspaces: selector => selector(snapshot),
    useStore: selector => selector({ sessionTitleSlash: grouping }), useDirectoryFlow: selector => selector(0),
    createSessionGroup: async () => {}, groupPickerComponent: p => { groupProps = p; return null },
    onClose: () => closed++, t: key => key,
  }
  const render = () => root.render(React.createElement(h.HeroWorkspacePicker, { ...props, selectedId }))
  const create = () => document.querySelector('[data-footer="::bw-hero-create-group"]')
  try {
    await act(render); assert.ok(create(), 'no directory-flow capability or existing groups required')
    await act(() => create().click()); assert.equal(groupProps.createOpen, true); assert.equal(closed, 1)
    selectedId = 'foreign'; await act(render); assert.equal(create(), null); assert.equal(groupProps.createOpen, false)
    selectedId = 'w'; grouping = false; await act(render); assert.equal(create(), null)
    grouping = true; list.byId.s.blank = false; await act(render); assert.equal(create(), null)
    list.byId.s.blank = true; snapshot.archivedSessionIds.push('s'); await act(render); assert.equal(create(), null)
  } finally { await act(() => root.unmount()); dom.window.close() }
})
