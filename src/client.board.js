/** Optional board-owned navigation; no board data, persistence or fallback UI. MIT. */
window.__ModuleLoader__.load({
  id: 'dsh-better-workspace', chunk: 'client.board.js',
  factory: () => {
    const faceOf = get => {
      try {
        const face = get()
        return face && typeof face.open === 'function' && typeof face.configure === 'function' ? face : null
      } catch { return null }
    }
    const actions = (get, workspaceId, label, failed) => {
      if (typeof workspaceId !== 'string' || !workspaceId || !faceOf(get)) return []
      return [['bw-board-open', 'board.open', 'open'], ['bw-board-configure', 'board.configure', 'configure']].map(([id, key, method]) => ({
        id, label: label(key), run: () => {
          // Menus can outlive a provider or connection. Reacquire on every click;
          // true acknowledges only that the board accepted the navigation intent.
          try {
            const face = faceOf(get)
            if (face && face[method](workspaceId) === true) return true
          } catch { /* board is optional; show the existing browser error surface */ }
          failed(label('board.failed'))
          return false
        },
      }))
    }
    return { actions }
  },
})
