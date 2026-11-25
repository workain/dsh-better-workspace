window.__ModuleLoader__.load({
  id: 'dsh-better-workspace',
  chunk: 'client.group-create.js',
  factory: function () {
    /** Explicit group choice is a user title, not a display-only membership.
     * Pinning it before navigation prevents automatic naming from dropping '/'. */
    function create({ sessions, workspaces, uiWorkspace, sourceOf, leafForGroup, groupLeaf, newTitle }) {
      const owned = new Map()
      const pending = new Map()
      const starting = new Map()
      const titleOf = row => typeof row.title === 'string' ? row.title : ''
      function member(id, workspaceId) {
        const snapshot = workspaces.list.getSnapshot()
        const workspace = snapshot.items.find(row => row.workspaceId === workspaceId)
        const row = sessions.list.getSnapshot().byId[id]
        if (!workspace || !workspace.sessionIds.includes(id) || !row || row.blank !== true
          || row.origin === 'subagent' || snapshot.archivedSessionIds.includes(id)) throw Error('group-create/ineligible')
        return row
      }
      async function rename(id, title) {
        const result = await sessions.using(id, { source: 'workspaceOperation' }, reference => reference.binding.session.rename(title))
        if (!result.ok) throw Error(result.error.message)
      }
      function enqueue(id, action) {
        const previous = pending.get(id) || Promise.resolve()
        const next = previous.catch(() => {}).then(action)
        pending.set(id, next)
        next.finally(() => { if (pending.get(id) === next) pending.delete(id) }).catch(() => {})
        return next
      }
      function assign(id, workspaceId, path, expectedTitle) {
        return enqueue(id, async () => {
          // Refresh the durable title before checking ownership: list caches may
          // lag our previous write or a rename from another browser.
          await sessions.refreshProjections(id)
          const row = member(id, workspaceId)
          const previous = owned.get(id)
          // A visible snapshot can explicitly authorize regrouping after reload.
          // Refresh + exact title comparison protects a rename in another tab.
          if (expectedTitle !== undefined ? titleOf(row) !== expectedTitle
            : previous ? titleOf(row) !== previous.title : sourceOf(row) === 'user') throw Error('group-create/title-changed')
          const sameOwnedTitle = previous && titleOf(row) === previous.title
          if (!path && !previous && sourceOf(row) !== 'user') return id
          const text = titleOf(row) || newTitle()
          const leaf = sameOwnedTitle ? previous.leaf : sourceOf(row) === 'user' && groupLeaf
            ? groupLeaf(text) : leafForGroup(text, sourceOf(row) !== 'user')
          const title = path ? path + '/' + leaf : leaf
          await rename(id, title)
          owned.set(id, { title, leaf, path })
          return id
        })
      }
      function start(workspaceId, path) {
        if (starting.has(workspaceId)) return starting.get(workspaceId)
        const next = startFresh(workspaceId, path)
        starting.set(workspaceId, next)
        next.finally(() => { if (starting.get(workspaceId) === next) starting.delete(workspaceId) }).catch(() => {})
        return next
      }
      async function startFresh(workspaceId, path) {
        const workspace = workspaces.list.getSnapshot().items.find(row => row.workspaceId === workspaceId)
        if (!workspace) throw Error('group-create/workspace-missing')
        // No sessionId: the Host creates a fresh session and awaits attachment.
        // openWorkspace would reuse (and rename) somebody else's unsent blank.
        const id = await sessions.create({ workspaceId })
        const leaf = leafForGroup(newTitle(), false)
        const title = path ? path + '/' + leaf : leaf
        try {
          await rename(id, title)
          owned.set(id, { title, leaf, path })
        } catch (error) {
          // Creation already succeeded: reveal the blank so it is not stranded.
          uiWorkspace.openSession(id)
          throw error
        }
        uiWorkspace.openSession(id)
        return id
      }
      return { assign, start, pathOf: (id, currentTitle) => {
        const entry = owned.get(id)
        return entry && (currentTitle === undefined || entry.title === currentTitle) ? entry.path : undefined
      } }
    }
    return { create }
  },
})
