import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chunk } from './chunks.mjs'

const operations = chunk('operations')
const key = 'sidebar.session.row.trailing'

test('late badge registration and removal notify without a session update', () => {
  let revision = 0
  const listeners = new Set()
  const slots = {
    getVersion(name) { assert.equal(name, key); return revision },
    subscribe(name, listener) { assert.equal(name, key); listeners.add(listener); return () => listeners.delete(listener) },
  }
  const source = operations.slotRevisionSource(slots, key)
  assert.equal(source.getSnapshot(), source.getSnapshot(), 'snapshot remains stable while idle')
  let changes = 0
  const off = source.subscribe(() => { changes++ })
  revision++ // Lazy Telegram chunk registers after the sidebar has mounted.
  for (const listener of listeners) listener()
  assert.equal(changes, 1)
  assert.equal(source.getSnapshot(), 1)
  revision++ // Plugin unload/replacement removes the occupant.
  for (const listener of listeners) listener()
  assert.equal(changes, 2)
  assert.equal(source.getSnapshot(), 2)
  off()
  assert.equal(listeners.size, 0)
})

test('status indicators remain visible for hover and menu-open rows', () => {
  const styles = chunk('styles').CSS_TEXT
  assert.match(styles, /\.bw-row-trailing\{[^}]*display:inline-flex/)
  assert.doesNotMatch(styles, /\.bw-row:hover\s+\.bw-row-trailing|\.bw-row\.menu-open\s+\.bw-row-trailing/)
  assert.match(styles, /\.bw-row:hover \.bw-row-actions[^}]*display:flex/)
})

test('badge belongs to its row id immediately after the title, independent of quick actions', () => {
  const code = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const badge = code.slice(code.indexOf('const trailingNode ='), code.indexOf('// Official mirror surface'))
  assert.match(badge, /ownerProps: \{ sessionId: node\.id \}/)
  assert.doesNotMatch(badge, /sessionActions\.quick|currentId|currentSession/)
  const row = code.slice(code.indexOf("E('span', { className: 'bw-row-label', ref: marquee.titleRef }, title)"))
  assert.ok(row.indexOf('trailingNode,') < row.indexOf("className: 'bw-row-time'"))
})

test('sidebar subscribes to the shared ledger source before rendering its row seats', () => {
  const code = fs.readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.match(code, /const trailingSeatSource = operations\.slotRevisionSource\(slots, 'sidebar\.session\.row\.trailing'\)/)
  assert.match(code, /const browserInjected = \(\) => \(\{\s*trailingSeatSource,/)
  assert.ok(code.indexOf('useObservableSnapshot(trailingSeatSource)') < code.indexOf("const trailingSeat = seatEntriesOf"))
})
