/** Client assembly for the plugin-owned passive title Remote. MIT. */
window.__ModuleLoader__.load({
  id: 'dsh-better-workspace', chunk: 'client.titles.js',
  factory: () => {
    // The TypertSchema boundary requires parse(), not a non-baseline require.
    const codec = parse => ({ mode: 'strict', typeSymbol: 'BetterWorkspaceTitleRead', create: () => ({ parse }) })
    const request = codec(value => {
      if (!value || typeof value.workspaceId !== 'string' || !Array.isArray(value.sessionIds) || !value.sessionIds.length || value.sessionIds.length > 256 || value.sessionIds.some(id => typeof id !== 'string' || !id)) throw new Error('invalid-title-request')
      return { workspaceId: value.workspaceId, sessionIds: value.sessionIds }
    })
    const contribution = { package: 'dsh-better-workspace', descriptors: [{
      id: 'dsh-better-workspace/betterWorkspaceTitles/read', service: 'betterWorkspaceTitles', namespace: 'betterWorkspaceTitles', method: 'read',
      invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: request }],
      cancellation: { parameter: 'signal' }, result: codec(value => { if (!Array.isArray(value)) throw new Error('invalid-title-response'); return value }),
    }] }
    const mount = async ctx => {
      const dispose = await ctx.remote.$mount(contribution)
      ctx.effect(() => dispose)
      const remote = ctx.get('remote.betterWorkspaceTitles')
      if (!remote) throw new Error('title-remote-unavailable')
      return async (workspaceId, ids, signal) => {
        const rows = []
        for (let offset = 0; offset < ids.length; offset += 256) {
          const result = await remote.read({ workspaceId, sessionIds: ids.slice(offset, offset + 256) }, signal)
          if (!result.ok) throw new Error('title-read-unavailable')
          rows.push(...result.value)
        }
        return rows
      }
    }
    return { mount }
  },
})
