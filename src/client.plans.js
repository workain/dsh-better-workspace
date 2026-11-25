/** Exact group plans, independent of archive/search/age/limit presentation. MIT. */
window.__ModuleLoader__.load({
  id: 'dsh-better-workspace', chunk: 'client.plans.js',
  factory: () => {
    const sessionRows = (workspace, list, allowed) => (workspace.sessionIds || []).flatMap(id => {
      const s = list && list.byId && list.byId[id]
      return !s || s.origin === 'subagent' || s.blank ? [] : [{ id, title: s.title, allowGroups: allowed(s) }]
    })
    const createPlanner = ({ operations, state, tree, split, buildSessions, findSessions, collectSessions, allowed, declarations, renameWorkspace, renameSession, updateDeclarations, runner, readTitles }) => {
      let serial = 0
      let titles = null
      const loadTitles = async workspaceId => {
        const workspace = workspaceOf(workspaceId)
        if (!workspace) throw new Error('missing-workspace')
        const ids = workspace.sessionIds || []
        const rows = await readTitles(workspaceId, ids)
        if (rows.length !== ids.length || rows.some(row => row.error && !['untitled', 'subagent'].includes(row.error))) throw new Error('title-read-incomplete')
        return new Map(rows.map(row => [row.id, row]))
      }
      const rowsOf = workspace => {
        if (!titles) return sessionRows(workspace, state().list, allowed)
        return (workspace.sessionIds || []).flatMap(id => {
          const row = titles.get(id)
          if (!row) throw new Error('title-read-incomplete')
          return typeof row.title === 'string' ? [{ id, title: row.title, allowGroups: row.sourceKind === 'user' }] : []
        })
      }
      let indexedItems, workspaceIndex
      const workspaceOf = id => {
        const items = state().items || []
        if (items !== indexedItems) { indexedItems = items; workspaceIndex = new Map(items.map(w => [w.workspaceId, w])) }
        return workspaceIndex.get(id)
      }
      const workspaceRecord = id => {
        const w = workspaceOf(id)
        return w ? [w.title, w.path] : null
      }
      const sessionRecord = (workspaceId, id) => {
        const s = state(), w = workspaceOf(workspaceId), row = s.list && s.list.byId && s.list.byId[id]
        if (!w || !(w.sessionIds || []).includes(id)) return null
        const authoritative = titles && titles.get(id)
        if (authoritative) return [authoritative.title, authoritative.sourceKind === 'user', authoritative.error || null, authoritative.eventSeq]
        return row ? [row.title, allowed(row), row.origin, row.blank] : null
      }
      const prepare = (kind, target, nextPath, afterSuccess) => {
        const ws = kind === 'workspace', current = state()
        const workspace = !ws && workspaceOf(target.workspaceId)
        if (!ws && !workspace) throw new Error('missing-workspace')
        const scope = ws ? target.scope || '' : target.workspaceId
        const declared = () => declarations(kind, scope)
        const members = () => {
          if (ws) {
            const node = operations.findFolder(tree(), target.idPath)
            if (!node) throw new Error('missing-group')
            const set = new Set(operations.folderMembers(node))
            return (state().items || []).filter(w => set.has(w.workspaceId)).map(w => ({ id: w.workspaceId, title: w.title }))
          }
          const currentWorkspace = workspaceOf(target.workspaceId)
          if (!currentWorkspace) throw new Error('missing-workspace')
          const rows = rowsOf(currentWorkspace)
          // Unknown authoritative titles must be read before any group write;
          // remembered display text is never a write authority.
          if (rows.some(row => typeof row.title !== 'string')) throw new Error('unknown-title')
          const node = findSessions(buildSessions(rows, true), target.path)
          return node ? collectSessions(node) : []
        }
        const initial = members()
        const allRecords = () => ws ? (state().items || []).map(w => [w.workspaceId, workspaceRecord(w.workspaceId)])
          : (workspaceOf(target.workspaceId)?.sessionIds || []).map(id => [id, sessionRecord(target.workspaceId, id)])
        const baseline = allRecords()
        const declaredBefore = JSON.stringify(declared())
        const validate = async completed => {
          if (!ws && readTitles) titles = await loadTitles(target.workspaceId)
          const fresh = allRecords(), completedById = new Map(completed.map(row => [row.id, row]))
          if (fresh.length !== baseline.length || JSON.stringify(declared()) !== declaredBefore) return false
          return baseline.every(([id, record], i) => {
            if (fresh[i][0] !== id) return false
            if (JSON.stringify(fresh[i][1]) === JSON.stringify(record)) return true
            const changed = completedById.get(id)
            if (!changed || !record) return false
            const nextRecord = record.slice(); nextRecord[0] = changed.after
            if (!ws) { nextRecord[1] = true; if (titles) nextRecord[3] = fresh[i][1][3] }
            return JSON.stringify(fresh[i][1]) === JSON.stringify(nextRecord)
          })
        }
        const read = id => ws ? workspaceRecord(id) : sessionRecord(target.workspaceId, id)
        const snapshot = () => ({ catalog: ws ? (state().items || []).map(w => [w.workspaceId, w.title, w.path]) : (workspaceOf(target.workspaceId) || {}).sessionIds, members: members().map(row => [row.id, read(row.id)]), declared: declared() })
        const originalDeclarations = declared().slice()
        const changes = initial.map(row => ({ id: row.id, before: row.title,
          after: operations.retitle(row.title, target.path, nextPath, split, row.allowGroups), expected: read(row.id) }))
        const plan = { key: ++serial, changes, snapshot: snapshot() }
        return { plan, async run() {
          const report = await runner.run(plan, { snapshot, read, validate,
            write: (id, title) => ws ? renameWorkspace(id, title) : renameSession(id, title) })
          if (report.every(r => r.outcome === 'success')) {
            updateDeclarations(kind, scope, target.path, nextPath, originalDeclarations)
            if (afterSuccess) afterSuccess()
          }
          return report
        } }
      }
      return { prepare, async prepareWithTitles(kind, target, nextPath, afterSuccess) {
        if (kind === 'session' && readTitles) titles = await loadTitles(target.workspaceId)
        return prepare(kind, target, nextPath, afterSuccess)
      } }
    }
    return { createPlanner, sessionRows }
  },
})
