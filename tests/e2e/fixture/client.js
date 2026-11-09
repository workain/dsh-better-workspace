// No visible testing controls. Only mounted by the disposable integration runner.
window.__ModuleLoader__.load({ id: 'bw-tree-fixture', factory: () => ({
  name: 'bw-tree-fixture', inject: ['sessions','workspaces','uiWorkspace','configForms','slots','remote'],
  async apply(ctx) {
    const codec={mode:'strict',typeSymbol:'FixtureObservation',create:()=>({parse:value=>value})}
    const dispose=await ctx.remote.$mount({package:'bw-tree-fixture',descriptors:[{
      id:'bw-tree-fixture/bwFixture/observe',service:'bwFixture',namespace:'bwFixture',method:'observe',invocation:{kind:'direct'},parameters:[],result:codec,
    }]})
    ctx.effect(()=>dispose)
    const form = ctx.configForms.get('better-workspace')
    window.__bwFixture = {
      observe: () => ctx.get('remote.bwFixture').observe(),
      readTitles: request => ctx.get('remote.betterWorkspaceTitles').read(request),
      snapshots: () => ({ workspaces: ctx.workspaces.list.getSnapshot(), sessions: ctx.sessions.list.getSnapshot(), config: form.getSnapshot() }),
      createWorkspace: input => ctx.workspaces.create(input),
      createSession: workspaceId => ctx.sessions.create({workspaceId}),
      renameSession: (id,title) => ctx.sessions.using(id,{source:'workspaceOperation'},ref => ref.binding.session.rename(title)),
      openSession: id => ctx.uiWorkspace.openSession(id),
      archiveSession: id => ctx.uiWorkspace.archiveSession(id),
      unarchiveSession: id => ctx.uiWorkspace.unarchiveSession(id),
      pinSession: id => ctx.uiWorkspace.pinSession(id),
      refresh: () => ctx.sessions.refresh(),
      // Test schema invalid/stale bindings through the same native settings API.
      setBindings: value => form.set('serviceSessions',value),
      retainInfo: id => ctx.sessions.retainInfo(id).getSnapshot(),
      slots: key => ctx.slots.entries(key).map(e=>({name:e.component.name,priority:e.priority})),
    }
    ctx.effect(() => () => { delete window.__bwFixture })
  },
}) })
