window.__ModuleLoader__.load({
  id: 'dsh-better-workspace',
  chunk: 'client.group-picker.js',
  factory: function (require) {
    const React = require('react')
    const E = React.createElement
    function options(list, workspace, state, helpers) {
      if (!workspace) return []
      const rows = workspace.sessionIds.map(id => list.byId[id]).filter(row => row && row.origin !== 'subagent')
        .map(row => ({ title: row.title || (helpers.cache[row.id] && helpers.cache[row.id].title) || row.displayTitle || '', allowGroups: helpers.groupsAllowedFor(row) }))
      const tree = helpers.buildSessionTree(rows, true, (state.folders && state.folders.sess) || {}, workspace.workspaceId)
      const out = []
      const walk = (node, depth) => {
        for (const group of node.groups) { out.push({ path: group.path, depth }); walk(group, depth + 1) }
      }
      walk(tree, 0)
      return out
    }
    /** The official Menu owns keyboard navigation, portal, and themed surfaces.
     * Every depth is an explicit target, including declared empty groups. */
    function GroupPicker(props) {
      const { Menu, workspaceId, useSessions, useStore, useWorkspaces, groupOptions, currentSessionId, groupPath, assignSessionGroup, t } = props
      const list = useSessions(state => state)
      const workspaces = useWorkspaces(state => state)
      const state = useStore(value => value)
      const id = currentSessionId(list)
      const row = id && list.byId[id]
      const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
      const ready = row && row.blank === true && workspace && workspace.sessionIds.includes(id)
      const paths = React.useMemo(() => groupOptions(list, workspace, state), [list, workspace, state, groupOptions])
      const [choice, setChoice] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(false)
      const [open, setOpen] = React.useState(false)
      const identity = String(workspaceId) + ':' + String(id)
      const identityRef = React.useRef(identity)
      identityRef.current = identity
      React.useEffect(() => { setChoice(null); setBusy(false); setError(false); setOpen(false) }, [identity])
      const value = choice && choice.identity === identity && (row && row.title || '') === choice.before
        ? choice.path : (ready ? groupPath(row) : '')
      const allPaths = value && !paths.some(option => option.path === value) ? [{ path: value, depth: 0 }, ...paths] : paths
      const change = path => {
        if (!ready || busy) return
        const target = identity
        setOpen(false); setBusy(true); setError(false)
        const expectedTitle = typeof row.title === 'string' ? row.title : ''
        Promise.resolve().then(() => assignSessionGroup(id, workspaceId, path, expectedTitle)).then(() => {
          if (identityRef.current === target) setChoice({ identity: target, path, before: expectedTitle })
        }, () => { if (identityRef.current === target) setError(true) }).finally(() => {
          if (identityRef.current === target) setBusy(false)
        })
      }
      if (state.sessionTitleSlash === false) return null
      const noneId = 'none'
      const items = [{ id: noneId, label: t('heroGroup.none') }, ...allPaths.map(option => ({
        id: 'group:' + option.path, label: E('span', { style: { paddingInlineStart: option.depth * 12 } }, option.path),
      }))]
      return E('span', { className: 'bw-hero-group', style: { display: 'inline-flex', flexDirection: 'column', gap: 3, maxWidth: 260 } },
        E(Menu, { open: open && !!ready && !busy, portal: true, dense: true, items,
          selectedId: value ? 'group:' + value : noneId, onClose: () => setOpen(false),
          onSelect: target => change(target === noneId ? '' : target.slice(6)),
          anchor: E('button', { type: 'button', className: 'bw-select', disabled: !ready || busy,
            'aria-label': t('heroGroup.label'), 'aria-haspopup': 'menu', 'aria-expanded': open && !!ready && !busy,
            title: t('heroGroup.hint'), onClick: () => setOpen(current => !current) },
            E('span', { className: 'bw-select-label' }, t('heroGroup.label') + ': ' + (value || t('heroGroup.none'))),
            E('span', { 'aria-hidden': true }, '\u25be'),
          ),
        }),
        E('small', { style: { color: 'var(--dsw-alias-text-tertiary)', fontSize: 10, lineHeight: 1.3 } }, t('heroGroup.hint')),
        error ? E('span', { role: 'alert', style: { color: 'var(--dsw-alias-text-error)' } }, t('heroGroup.error')) : null,
      )
    }
    return { GroupPicker, options }
  },
})
