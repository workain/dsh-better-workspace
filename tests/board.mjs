import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { chunk, source } from './chunks.mjs'

const { actions } = chunk('board')
const label = key => key
const ids = values => Array.from(values, x => x.id)
function fixture() {
  let service
  const failures = [], calls = []
  const make = tag => ({
    open(id) { calls.push([tag, 'open', id]); return true },
    configure(id) { calls.push([tag, 'configure', id]); return true },
  })
  const boardActions = id => actions(() => service, id, label, text => failures.push(text))
  return { boardActions, failures, calls, make, set: value => { service = value } }
}
// Execute the real production resolvers in a VM with only their outer inputs.
// These source cuts are test-only, not browser debug exports or duplicate logic.
function menus(f) {
  const text = source('src/client.js')
  const shared = text.slice(text.indexOf('        const workspaceExtras = {'), text.indexOf('\n        try {\n          ctx.effect(() => {\n            const disposers = []'))
  const local = text.slice(text.indexOf('      const menuEntries = () => {'), text.indexOf('\n\n      // The official contribution runs outside this component'))
  const box = { boardActions: f.boardActions, menuBridge: { label, boardActions: f.boardActions },
    withMenuSeparator: x => x, t: label, icon: () => null, workspaceSlash: false, sessionSlash: false,
    archiveFilterEntries: () => [], ui: {}, presetFace: null, ot: null, ctx: null,
    setCtx: () => {}, fail: text => f.failures.push(text), Object,
  }
  vm.runInNewContext(shared + '\n' + local + '\nthis.shared = workspaceExtras; this.local = menuEntries; this.pick = handleCtxPick;', box)
  return box
}

test('board optional shape: absent, throwing getter, incomplete and late availability', () => {
  const f = fixture(), m = menus(f)
  m.ctx = { kind: 'workspace', payload: { workspaceId: 'A' } }
  assert.deepEqual(ids(m.shared.resolve({ workspaceId: 'A' })).filter(id => id.startsWith('bw-board')), [])
  assert.deepEqual(ids(m.local()).filter(id => id.startsWith('bw-board')), [])
  f.set({ open() {} }); assert.equal(f.boardActions('A').length, 0)
  assert.equal(actions(() => { throw Error('not injected') }, 'A', label, () => {}).length, 0)
  f.set(f.make('late'))
  assert.deepEqual(ids(m.shared.resolve({ workspaceId: 'A' })).filter(id => id.startsWith('bw-board')), ['bw-board-open', 'bw-board-configure'])
  assert.deepEqual(ids(m.local()).filter(id => id.startsWith('bw-board')), ['bw-board-open', 'bw-board-configure'])
})

test('actual shared menu captures exact A/B workspace, not globally selected workspace', () => {
  const f = fixture(), m = menus(f); f.set(f.make('first'))
  const a = m.shared.resolve({ workspaceId: 'A' }).find(x => x.id === 'bw-board-open')
  const b = m.shared.resolve({ workspaceId: 'B' }).find(x => x.id === 'bw-board-configure')
  m.ctx = { kind: 'workspace', payload: { workspaceId: 'C' } }
  assert.equal(a.run(), true); assert.equal(b.run(), true)
  assert.deepEqual(f.calls, [['first', 'open', 'A'], ['first', 'configure', 'B']])
})

test('actual fallback dispatcher opens/configures the clicked workspace only', () => {
  const f = fixture(), m = menus(f); f.set(f.make('local'))
  m.ctx = { kind: 'workspace', payload: { workspaceId: 'B' } }; m.pick('bw-board-open')
  m.ctx = { kind: 'workspace', payload: { workspaceId: 'A' } }; m.pick('bw-board-configure')
  assert.deepEqual(f.calls, [['local', 'open', 'B'], ['local', 'configure', 'A']])
})

test('cached shared menu reacquires replacement provider; disposed provider reports failure', () => {
  const f = fixture(), m = menus(f); f.set(f.make('old'))
  const a = m.shared.resolve({ workspaceId: 'A' }).find(x => x.id === 'bw-board-open')
  f.set(f.make('new')); assert.equal(a.run(), true)
  f.set(null); assert.equal(a.run(), false)
  assert.deepEqual(f.calls, [['new', 'open', 'A']]); assert.deepEqual(f.failures, ['board.failed'])
})

test('fallback click after disposal reports localized failure and does not invent navigation', () => {
  const f = fixture(), m = menus(f); f.set(f.make('before'))
  m.ctx = { kind: 'workspace', payload: { workspaceId: 'A' } }; m.local()
  f.set(null); m.pick('bw-board-open')
  assert.deepEqual(f.calls, []); assert.deepEqual(f.failures, ['board.failed'])
})

test('false, malformed acceptance and provider exception report failure, never success', () => {
  const f = fixture()
  for (const value of [false, undefined, 'true']) {
    f.set({ open: () => value, configure: () => value })
    assert.equal(f.boardActions('A')[0].run(), false)
  }
  f.set({ open: () => { throw Error('disposed') }, configure() { return false } })
  assert.equal(f.boardActions('A')[0].run(), false)
  assert.deepEqual(f.failures, ['board.failed', 'board.failed', 'board.failed', 'board.failed'])
})

test('invalid workspace never offers actions or falls back to current workspace', () => {
  const f = fixture(); f.set(f.make('only'))
  for (const id of ['', null, undefined, 12]) assert.equal(f.boardActions(id).length, 0)
  assert.deepEqual(f.calls, [])
})

test('session fallback menu receives no board actions', () => {
  const f = fixture(), m = menus(f); f.set(f.make('present'))
  m.sessionMenuEntriesFor = () => [{ id: 'session-only' }]
  m.ctx = { kind: 'session', payload: { id: 'session-A' } }
  assert.deepEqual(ids(m.local()), ['session-only'])
})
