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
      if (state.sessionTitleSlash === false || paths.length === 0) return null
      const noneId = 'none'
      const items = [{ id: noneId, label: t('heroGroup.none') }, ...allPaths.map(option => ({
        id: 'group:' + option.path, label: E('span', { style: { paddingInlineStart: option.depth * 12 } }, option.path),
      }))]
      return E('span', { className: 'bw-hero-group', style: { display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: 'min(100%, 360px)' } },
        E('style', null, `
          .bw-hero-group-chip { display:inline-flex; align-items:center; gap:4px; max-width:min(100%, 360px); min-height:28px; padding:0 8px; border:none; border-radius:var(--dsw-radius-sm); background:transparent; color:var(--dsw-alias-label-primary); font-family:inherit; font-size:13px; line-height:20px; font-weight:500; cursor:pointer; }
          .bw-hero-group-chip[aria-expanded='true'] { background:var(--dsw-alias-interactive-bg-hover); }
          @media (hover:hover) { .bw-hero-group-chip:not(:disabled):hover { background:var(--dsw-alias-interactive-bg-hover); } }
          .bw-hero-group-chip:disabled { cursor:default; }
          .bw-hero-group-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .bw-hero-group-icon { display:inline-flex; flex:none; color:var(--dsw-alias-label-primary); }
          .bw-hero-group-chevron { display:inline-flex; flex:none; color:var(--dsw-alias-label-caption); }
        `),
        E(Menu, { open: open && !!ready && !busy, portal: true, dense: true, items,
          selectedId: value ? 'group:' + value : noneId, onClose: () => setOpen(false),
          onSelect: target => change(target === noneId ? '' : target.slice(6)),
          anchor: E('button', { type: 'button', className: 'bw-hero-group-chip', disabled: !ready || busy,
            'aria-label': t('heroGroup.label'), 'aria-haspopup': 'menu', 'aria-expanded': open && !!ready && !busy,
            title: t('heroGroup.hint'), onClick: () => setOpen(current => !current) },
            props.folderIcon ? E('span', { className: 'bw-hero-group-icon', 'aria-hidden': true }, props.folderIcon) : null,
            E('span', { className: 'bw-hero-group-label' }, value || t('heroGroup.none')),
            E('span', { className: 'bw-hero-group-chevron', 'aria-hidden': true }, props.chevronIcon || '\u25be'),
          ),
        }),
        error ? E('span', { role: 'alert', style: { color: 'var(--dsw-alias-text-error)' } }, t('heroGroup.error')) : null,
      )
    }
    return { GroupPicker, options }
  },
})
