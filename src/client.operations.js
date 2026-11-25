/** Workain fork: exact plans and public rc.1 session operations. MIT, see LICENSE. */
window.__ModuleLoader__.load({
  id: 'dsh-better-workspace', chunk: 'client.operations.js',
  factory: () => {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    // Never walk disk subtrees when changing a NAME group: those workspaces
    // belong to another physical container even when their labels match.
    const folderMembers = (node) => {
      const out = []
      const seen = new Set()
      const walk = (n) => {
        if (!n || seen.has(n)) return
        seen.add(n)
        if (n.kind === 'ws') { out.push(n.workspace.workspaceId); return }
        for (const w of n.workspaces || []) out.push(w.workspaceId)
        for (const f of n.folders || []) walk(f)
      }
      walk(node)
      return [...new Set(out)]
    }
    const findFolder = (root, identity) => {
      const queue = [root], seen = new Set()
      for (let at = 0; at < queue.length; at++) {
        const n = queue[at]
        if (!n || seen.has(n)) continue
        seen.add(n)
        if ((n.idPath || n.path) === identity) return n
        queue.push(...(n.folders || []))
        for (const w of n.workspaces || []) if (w.sub) queue.push(w.sub)
      }
      return null
    }
    // Identity comes from the raw tree, not delimiters inside quoted names.
    // Physical roots and name folders share the same persisted container keys.
    const folderIdentities = (root, split) => {
      const index = new Map(), seen = new Set(), queue = [[root, '', '', null]]
      for (let at = 0; at < queue.length; at++) {
        const [node, key, scope, ownerId] = queue[at]
        if (!node || seen.has(node)) continue
        seen.add(node)
        const path = node.path || '', parts = split(path), parentPath = parts.slice(0, -1).join('/')
        index.set(key, { node, path, scope, ownerId, leaf: node.name || '', parentPath,
          parentKey: parentPath ? (scope ? scope + '//' : '') + parentPath : scope })
        for (const f of node.folders || []) queue.push([f, f.idPath, f.scope || '', ownerId])
        for (const w of node.workspaces || []) if (w.sub) queue.push([w.sub, w.subPrefix, w.subPrefix, w.workspaceId])
      }
      return index
    }
    // Work on parsed segments, never string.slice(prefix.length): quotes,
    // URLs and path leaves have grammar that a raw prefix cannot represent.
    const retitle = (title, from, to, split, allowGroups = true) => {
      const parts = split(title, allowGroups), prefix = split(from), target = split(to)
      if (parts.length <= prefix.length || !prefix.every((s, i) => parts[i] === s)) throw new Error('stale-group')
      return [...target, ...parts.slice(prefix.length)].join('/')
    }
    const createRunner = ({ timeoutMs = 15000 } = {}) => {
      let busy = false, uncertain = false
      return {
        get busy() { return busy || uncertain },
        async run(plan, { snapshot, read, write, validate = () => true }) {
          if (busy || uncertain) throw new Error('operation-busy')
          busy = true
          const report = plan.changes.map(c => ({ ...c, outcome: 'not-attempted' }))
          try {
            if (!same(plan.snapshot, await snapshot())) throw new Error('stale-plan')
            for (const row of report) {
              try {
                if (!await validate(report.filter(r => r.outcome === 'success')) || !same(await read(row.id), row.expected)) { row.outcome = 'stale'; break }
              } catch {
                // A passive read failure after earlier successes must retain
                // the partial report. No write was attempted for this member.
                row.outcome = 'failure'; row.reason = 'verification-unavailable'; break
              }
              let timer
              const pending = Promise.resolve().then(() => write(row.id, row.after))
              // No retry after transport uncertainty. Keep the runner fenced
              // until the original operation settles, even after UI timeout.
              const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('operation-timeout')), timeoutMs)
              })
              try {
                await Promise.race([pending, timeout])
                row.outcome = 'success'
              } catch (error) {
                row.outcome = error && error.definite === true ? 'failure' : 'unknown'
                row.reason = error && error.message || String(error)
                if (row.outcome === 'unknown') {
                  uncertain = true
                  pending.then(() => { uncertain = false }, () => { uncertain = false })
                }
                break
              } finally { clearTimeout(timer) }
            }
            return report
          } finally { busy = false }
        },
      }
    }
    const orderPlan = ({ ids, anchor, state, write, runner, afterSuccess, describe }) => {
      const capture = () => state().map(w => [w.workspaceId, w.title, w.path])
      const initial = capture()
      let expectedOrder = initial.map(row => row[0])
      const records = new Map(initial.map(row => [row[0], row]))
      if (ids.some(id => !records.has(id)) || (anchor && !records.has(anchor)) || ids.includes(anchor)) throw new Error('stale-order')
      const changes = ids.map(id => ({ id, before: records.get(id)[1], after: describe(records.get(id)[1], anchor), expected: records.get(id) }))
      const plan = { changes, snapshot: initial }
      const snapshot = capture
      return { plan, async run() {
        const report = await runner.run(plan, { snapshot,
          read: id => capture().find(row => row[0] === id),
          validate: () => {
            const fresh = capture()
            return same(fresh.map(row => row[0]), expectedOrder) && fresh.every(row => same(row, records.get(row[0])))
          },
          write: async id => {
            const next = expectedOrder.filter(other => other !== id)
            const at = anchor ? next.indexOf(anchor) : next.length
            next.splice(at, 0, id)
            await write(id, anchor)
            expectedOrder = next
          },
        })
        if (report.every(row => row.outcome === 'success')) afterSuccess()
        return report
      } }
    }
    const renameSession = async (sessions, id, title) => {
      // using() retains through asynchronous settlement and always releases;
      // borrowing binding() across an await would not own its lifetime.
      const result = await sessions.using(id, { source: 'workspaceOperation' },
        reference => reference.binding.session.rename(title))
      if (!result || !result.ok) {
        const error = new Error(result && result.error && result.error.message || 'session rename refused')
        error.definite = !!result && result.ok === false && ['session/title-invalid', 'session/not-found', 'remote-access/denied'].includes(result.error && result.error.code)
        throw error
      }
    }
    // Linear functional-graph aggregation, including corrupt lineage cycles.
    // A cycle member sees every OTHER running member, never itself.
    const subagentCounts = (byId, statusMap, metrics = {}) => {
      const ids = Object.keys(byId || {}), done = new Map(), totals = new Map(), own = new Map(), parent = new Map()
      metrics.nodes = ids.length; metrics.edges = 0
      for (const id of ids) {
        const s = byId[id], live = statusMap && statusMap.get(id)
        own.set(id, (live && live.running !== undefined ? live.running : s.running) === true ? 1 : 0)
        totals.set(id, 0)
        if (s.origin === 'subagent' && byId[s.parentId]) { parent.set(id, s.parentId); metrics.edges++ }
      }
      // Peel leaves; remaining nodes are disjoint cycles. Each edge visited once.
      const degree = new Map(ids.map(id => [id, 0]))
      for (const p of parent.values()) degree.set(p, degree.get(p) + 1)
      const queue = ids.filter(id => degree.get(id) === 0)
      for (let at = 0; at < queue.length; at++) {
        const id = queue[at], p = parent.get(id)
        done.set(id, totals.get(id))
        if (p) {
          totals.set(p, totals.get(p) + totals.get(id) + own.get(id))
          degree.set(p, degree.get(p) - 1)
          if (degree.get(p) === 0) queue.push(p)
        }
      }
      for (const id of ids) {
        if (done.has(id)) continue
        const cycle = [], seen = new Set()
        let cursor = id, total = 0
        while (!seen.has(cursor)) {
          seen.add(cursor); cycle.push(cursor)
          total += totals.get(cursor) + own.get(cursor)
          cursor = parent.get(cursor)
        }
        for (const member of cycle) done.set(member, total - own.get(member))
      }
      return done
    }
    return { folderMembers, findFolder, folderIdentities, retitle, createRunner, orderPlan, renameSession, subagentCounts }
  },
})
