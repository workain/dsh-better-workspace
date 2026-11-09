/** Explicit managing-session binding, persisted only through native ConfigForm. MIT. */
window.__ModuleLoader__.load({
  id: 'dsh-better-workspace', chunk: 'client.service.js',
  factory: (require) => {
    const React = require('react'), E = React.createElement
    const ui = require('@deepseek-ai/dsh-client-ui-primitives')
    const EMPTY = Object.freeze({ status: 'unavailable', writable: false })
    const resolve = (workspace, id, byId, archived) => {
      if (!id) return { reason: 'unassigned' }
      const s = byId && byId[id]
      if (!s) return { reason: 'missing' }
      if (!workspace || !(workspace.sessionIds || []).includes(id) || s.origin === 'subagent') return { reason: 'foreign' }
      if (archived.has(id)) return { reason: 'archived' }
      return { id, summary: s }
    }
    const createBindingStore = (validate = async () => true) => {
      let form = null, off = null, state = EMPTY
      const listeners = new Set()
      const publish = () => { state = form ? form.getSnapshot() : EMPTY; for (const fn of listeners) fn() }
      return {
        getSnapshot: () => state,
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
        attach(next) { if (off) off(); form = next; off = next ? next.subscribe(publish) : null; publish() },
        async save(workspaceId, sessionId, expectedRevision) {
          if (!form || state.status !== 'ready' || !state.writable) throw new Error('settings-unavailable')
          if (sessionId && !await validate(workspaceId, sessionId)) throw new Error('session-unavailable')
          // Path operation + explicit namespace revision prevents one browser
          // overwriting another browser's binding using a stale map snapshot.
          const accepted = await form.mutate([{ op: sessionId ? 'set' : 'unset',
            path: ['serviceSessions', workspaceId], ...(sessionId ? { value: sessionId } : {}) }], expectedRevision)
          if (!accepted) throw new Error('settings-refused')
        },
      }
    }
    function Picker({ store, workspace, initialSessionId, byId, archived, titleOf, MenuPicker, t, onClose }) {
      const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
      const bindings = snapshot.value && snapshot.value.serviceSessions || {}
      const [selected, setSelected] = React.useState(resolve(workspace, initialSessionId, byId, archived).id || bindings[workspace.workspaceId] || '')
      const [revision] = React.useState(snapshot.revision)
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
      const candidates = (workspace.sessionIds || []).filter(id => resolve(workspace, id, byId, archived).id)
      const current = resolve(workspace, bindings[workspace.workspaceId], byId, archived)
      const save = async () => {
        if (busy) return
        if (selected && !resolve(workspace, selected, byId, archived).id) { setError(t('service.missing')); return }
        setBusy(true); setError('')
        try { await store.save(workspace.workspaceId, selected, revision); onClose() }
        catch { setError(t('service.writeError')); setBusy(false) }
      }
      return E(ui.Modal, { open: true, title: t('service.choose'), closeLabel: t('close'), onClose: busy ? () => {} : onClose },
        E('div', { className: 'bw-modal-body' },
        E('p', null, t('service.' + (current.reason || 'assigned'))),
        E(MenuPicker, { title: t('service.choose'), value: selected, t,
          options: [{ value: '', label: t('service.clear') }, ...candidates.map(id => ({ value: id, label: titleOf(id, byId[id]) }))],
          onPick: value => { if (!busy) setSelected(value) }, placeholder: t('service.choose'),
        }),
        error ? E('p', { role: 'alert' }, error) : null,
        E('div', { className: 'bw-dialog-actions' },
          E('button', { type: 'button', disabled: busy, onClick: onClose }, t('cancel')),
          E('button', { type: 'button', disabled: busy || revision === undefined || snapshot.status !== 'ready' || !snapshot.writable, onClick: save }, t('confirm')))))
    }
    return { resolve, createBindingStore, Picker }
  },
})
