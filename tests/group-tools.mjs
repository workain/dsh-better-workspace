import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createGroupingService, registerGroupTools } from '../src/group-tools.js'
import { splitTitleSegs } from '../src/group-grammar.js'
import { groupPath, moveTitle } from '../src/group-plans.js'
const initial = () => [
  { id: 's1', title: 'g/One', sourceKind: 'user', eventSeq: 1 },
  { id: 's2', title: 'g/n/Two', sourceKind: 'user', eventSeq: 1 },
  { id: 's3', title: 'automatic/a/b', sourceKind: 'provider', eventSeq: 1 },
  { id: 'blank', title: 'Blank', sourceKind: 'user', eventSeq: 1, blank: true },
  { id: 'child', title: 'Child', sourceKind: 'user', eventSeq: 1, origin: 'subagent' },
  { id: 'foreign', title: 'g/Foreign', sourceKind: 'user', eventSeq: 1 },
]
function fixture() {
  const rows = new Map(initial().map(x => [x.id, x])), defs = new Map()
  const workspaces = new Map([['A', { id: 'A', title: 'A', createdAt: 'one', sessionIds: ['s1', 's2', 's3', 'blank', 'child'] }], ['B', { id: 'B', title: 'B', createdAt: 'two', sessionIds: ['foreign'] }]])
  const calls = [], stats = { observed: 0, disposed: 0 }; let beforeObserve, beforeRename, denied = false
  const ctx = {
    tools: { register(d) { defs.set(d.name, d); return () => defs.delete(d.name) } },
    remoteAccess: { allows: () => !denied },
    workspaceRegistry: { get: id => workspaces.get(id), list: () => [...workspaces.values()], archivedSessionIds: ['s2'] },
    sessionQuery: {
      async observeSession(id) { if (beforeObserve) await beforeObserve(id); const row = rows.get(id); stats.observed++; return { header: { origin: row.origin }, projections: { values: { sessionListMetadata: { blank: !!row.blank } } }, [Symbol.dispose]() { stats.disposed++ } } },
      async readTitleSnapshot(id) { const row = rows.get(id); return { session: {}, title: { title: row.title, source: { kind: row.sourceKind }, eventSeq: row.eventSeq } } },
    },
    sessionController: { async rename({ sessionId, title }) { calls.push([sessionId, title]); if (beforeRename) await beforeRename(sessionId); Object.assign(rows.get(sessionId), { title, sourceKind: 'user', eventSeq: rows.get(sessionId).eventSeq + 1 }); return { title, seq: rows.get(sessionId).eventSeq } } },
  }
  const service = createGroupingService(ctx)
  const exec = (callId = 'call') => ({ agent: { id: 'caller', session: { id: 'caller' } }, signal: new AbortController().signal, callId })
  return { ctx, service, exec, rows, workspaces, calls, stats, defs, setObserve: fn => { beforeObserve = fn }, setRename: fn => { beforeRename = fn }, deny: () => { denied = true } }
}
const move = (id, sessionIds = ['s1'], targetGroup = ['target'], workspaceId = 'A') => ({ workspaceId, sessionIds, targetGroup, operationId: id })

test('shared host grammar is exact canonical client extraction and executable parity', () => {
  const ui = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), host = readFileSync(new URL('../src/group-grammar.js', import.meta.url), 'utf8')
  const block = ui.slice(ui.indexOf('    const splitPlainSegs ='), ui.indexOf('    const normPath ='))
  assert.ok(host.includes(block))
  const browser = new Function(block + '\nreturn splitTitleSegs')()
  for (const s of ['a/b', 'web/“read /etc/a/b”', 'unmatched“/a', 'https://x/y', '~/a/b', '“a/b”', 'a/"b/c"']) for (const allowed of [true, false]) assert.deepEqual(splitTitleSegs(s, allowed), browser(s, allowed))
})
test('opaque slash/path leaves roundtrip or explicitly refuse without shredding', () => {
  for (const title of ['a/b', 'read /a/b', 'https://x/y', 'a/“b”/c']) {
    const row = { title, sourceKind: 'provider' }; const after = moveTitle(row, ['G'])
    assert.equal(splitTitleSegs(after).length, 2); assert.equal(splitTitleSegs(after)[0], 'G')
    assert.ok(after.includes(title))
  }
  assert.throws(() => groupPath(['bad/slash']), /unrepresentable/)
  assert.throws(() => groupPath(['https://x']), /unrepresentable/)
})
test('passive list covers complete A including archived and reports exclusions without writes', async () => {
  const f = fixture(), result = await f.service.execute('list', { workspaceId: 'A' }, f.exec())
  assert.equal(result.sessions.length, 5); assert.equal(result.sessions.find(r => r.id === 's2').archived, true)
  assert.equal(result.sessions.find(r => r.id === 'blank').error, 'blank'); assert.equal(result.sessions.find(r => r.id === 'child').error, 'subagent')
  assert.deepEqual(result.groups[0].sessionIds, ['s1', 's2']); assert.equal(f.calls.length, 0); assert.equal(f.stats.observed, f.stats.disposed)
})
test('dryRun and actual move work outside caller workspace, B remains untouched', async () => {
  const f = fixture(), args = move('m', ['s1', 's2', 's3', 'blank', 'child', 'foreign'])
  const preview = await f.service.execute('move', { ...args, dryRun: true }, f.exec())
  assert.equal(f.calls.length, 0); assert.equal(preview.report.filter(r => r.outcome === 'excluded').length, 3)
  const result = await f.service.execute('move', args, f.exec())
  assert.equal(result.report.filter(r => r.outcome === 'success').length, 3)
  assert.equal(f.rows.get('foreign').title, 'g/Foreign'); assert.equal(f.ctx.workspaceRegistry.archivedSessionIds.includes('s2'), true)
  assert.equal(f.stats.observed, f.stats.disposed)
})
test('exact nested group rename includes archived but not similarly named foreign workspace', async () => {
  const f = fixture(); const r = await f.service.execute('rename', { workspaceId: 'A', sourceGroup: ['g'], targetGroup: ['new'], operationId: 'r' }, f.exec())
  assert.deepEqual(r.report.map(x => x.after), ['new/One', 'new/n/Two']); assert.equal(f.rows.get('foreign').title, 'g/Foreign')
})
test('move to root, unchanged group and replays do not write twice', async () => {
  const f = fixture(), args = move('root', ['s1'], [])
  const a = await f.service.execute('move', args, f.exec()); assert.equal(a.report[0].after, 'One')
  assert.deepEqual(await f.service.execute('move', args, f.exec('another')), a); assert.equal(f.calls.length, 1)
  await assert.rejects(f.service.execute('move', move('root', ['s2']), f.exec()), /operation-id-reused/)
})
test('operation identity reserved synchronously across concurrent different workspaces', async () => {
  const f = fixture(); let release; const wait = new Promise(r => { release = r }); f.setObserve(() => wait)
  const first = f.service.execute('move', move('same'), f.exec())
  await assert.rejects(f.service.execute('move', move('same', ['foreign'], ['other'], 'B'), f.exec()), /operation-id-reused/)
  await assert.rejects(f.service.execute('move', move('same'), f.exec()), /operation-in-progress/)
  release(); await first; assert.equal(f.calls.length, 1)
})
test('dryRun cannot release another mutating workspace lock', async () => {
  const f = fixture(); let release; const wait = new Promise(r => { release = r }); f.setObserve(() => wait)
  const first = f.service.execute('move', move('first'), f.exec()); const dry = f.service.execute('move', { ...move('dry'), dryRun: true }, f.exec())
  release(); await dry; await first
  assert.equal(f.calls.length, 1)
})
test('partial unknown stops subsequent writes, replay returns report and workspace stays fenced', async () => {
  const f = fixture(); f.setRename(id => { if (id === 's2') throw Error('transport unknown') })
  const args = move('partial', ['s1', 's2', 's3']), r = await f.service.execute('move', args, f.exec())
  assert.deepEqual(r.report.map(r => r.outcome), ['success', 'unknown', 'not-attempted'])
  assert.deepEqual(await f.service.execute('move', args, f.exec()), r)
  await assert.rejects(f.service.execute('move', move('new'), f.exec()), /workspace-busy-or-uncertain/)
  assert.equal(f.calls.length, 2)
})
test('authoritative readback clears unknown fence and allows a deliberate recovery move', async () => {
  const f = fixture(); let failOnce = true
  f.setRename(id => {
    if (id === 's2' && failOnce) {
      failOnce = false
      Object.assign(f.rows.get(id), { title: 'target/Two', sourceKind: 'user', eventSeq: 2 })
      throw Error('transport-after-apply')
    }
  })
  const first = await f.service.execute('move', move('unknown-recovered', ['s1', 's2', 's3']), f.exec())
  assert.deepEqual(first.report.map(row => row.outcome), ['success', 'unknown', 'not-attempted'])
  assert.equal((await f.service.execute('list', { workspaceId: 'A' }, f.exec())).uncertain, false)
  const recovered = await f.service.execute('move', move('lift-after-readback', ['s2'], []), f.exec())
  assert.equal(recovered.report[0].outcome, 'success')
  assert.equal(f.rows.get('s2').title, 'Two')
})

test('membership incarnation and external title changes stop before a stale target is overwritten', async () => {
  const f = fixture(); f.setRename(id => { if (id === 's1') f.rows.get('s2').title = 'edited elsewhere' })
  const r = await f.service.execute('move', move('stale', ['s1', 's2']), f.exec())
  assert.deepEqual(r.report.map(r => r.outcome), ['success', 'stale']); assert.equal(f.calls.length, 1)
})
test('native output definition, registration disposal, strict schema and access denial', async () => {
  const f = fixture(), stop = registerGroupTools(f.ctx); assert.equal(f.defs.size, 4)
  for (const d of f.defs.values()) { assert.equal(d.parameters.additionalProperties, false); assert.ok(d.output.schema); assert.equal(typeof d.output.render, 'function') }
  await assert.rejects(f.service.execute('move', { ...move('bad'), unexpected: true }, f.exec()), /invalid-arguments/)
  await assert.rejects(f.service.execute('move', { ...move('bad'), sessionIds: [] }, f.exec()), /invalid-session/)
  f.deny(); await assert.rejects(f.service.execute('list', { workspaceId: 'A' }, f.exec()), /access-denied/)
  stop(); assert.equal(f.defs.size, 0)
})
test('cancelled passive read drains every acquired observation before settling', async () => {
  const f = fixture(), abort = new AbortController(); let release, started
  const waiting = new Promise(r => { release = r }), acquired = new Promise(r => { started = r })
  f.setObserve(async id => { if (id === 's2') { started(); await waiting } })
  let settled = false
  const pending = f.service.execute('list', { workspaceId: 'A' }, { ...f.exec(), signal: abort.signal }).finally(() => { settled = true })
  await acquired; abort.abort(); await Promise.resolve(); await Promise.resolve()
  assert.equal(settled, false)
  release(); await assert.rejects(pending, /abort/i)
  assert.equal(f.stats.observed, f.stats.disposed)
})

test('a worker disposal failure fails closed after draining instead of omitting group members', async () => {
  const f = fixture(), observe = f.ctx.sessionQuery.observeSession
  f.ctx.sessionQuery.observeSession = async id => {
    const lease = await observe(id), dispose = lease[Symbol.dispose]
    if (id === 's1') lease[Symbol.dispose] = () => { dispose(); throw Error('release failed') }
    return lease
  }
  await assert.rejects(f.service.execute('rename', { workspaceId: 'A', sourceGroup: ['g'], targetGroup: ['other'], operationId: 'release' }, f.exec()), /read-incomplete/)
  assert.equal(f.calls.length, 0); assert.equal(f.stats.observed, f.stats.disposed)
})

test('bounded per-write observations are initial N plus 2 per target, not quadratic full reads', async () => {
  const f = fixture(); await f.service.execute('move', move('count', ['s1', 's2', 's3']), f.exec())
  assert.equal(f.stats.observed, 5 + 2 * 3)
})
