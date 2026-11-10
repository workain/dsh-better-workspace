// Disposable native Tools pipeline test; this module never ships in tarball.
import { randomUUID, createHash } from 'node:crypto'
export const name = 'bw-groups-fixture'
export const inject = ['connection', 'agents', 'sessionQuery', 'tools', 'workspaceRegistry', 'sessions', 'sessionPersistence']
export async function apply(ctx) {
  let flight
  const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
  async function run() {
    const a = ctx.workspaceRegistry.list().find(w => w.title === 'Container A')
    const b = ctx.workspaceRegistry.list().find(w => w.title === 'Container B')
    if (!a || a.sessionIds.length !== 3 || !b) throw Error('fixture not ready')
    // Populate B before the observation interval; caller deliberately belongs to A.
    const s = ctx.sessions.prepare(randomUUID(), { meta: { cwd: b.path } })
    const detach = ctx.sessions.enter(s); ctx.sessions.announce(s)
    const events = [s.append('session/title', { title: 'g/Foreign', messageSeqs: [], source: { kind: 'user' } }), s.append('turn/start', { turn: 1 }), s.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })]
    const handle = await ctx.sessionPersistence.create(s.header)
    try { await handle.append(events); await handle.flush() } finally { await handle.close() }
    detach(); await b.attachSession(s.id)
    const actorId = a.sessionIds[0], actorHandle = await ctx.agents.resume({ resumeSessionId: actorId })
    const actor = actorHandle.agent
    try {
      const call = async (name, args) => {
        const batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: randomUUID(), name, arguments: JSON.stringify(args) }], agent: actor, signal: new AbortController().signal })
        const r = batch.results[0].result
        if (r.isError || !r.value?.json) throw Error('native tool failed ' + JSON.stringify(r))
        return JSON.parse(r.value.json)
      }
      const observe = async () => {
        const rows = []
        for (const w of [a, b]) for (const id of w.sessionIds) {
          const log = await ctx.sessionQuery.readSession(id)
          rows.push({ id, header: hash(log.session), events: hash(log.events), live: !!ctx.agents.get(id), prompts: log.events.filter(e => e.type === 'user/message').length })
        }
        return { rows, archived: [...ctx.workspaceRegistry.archivedSessionIds] }
      }
      const before = await observe()
      const inventory = await call('workspace_grouping_list_workspaces', {})
      const list = await call('workspace_session_groups', { workspaceId: a.id })
      if (list.sessions.length !== 3 || inventory.workspaces.length < 2) throw Error('incomplete native list')
      const preview = await call('workspace_move_sessions_to_group', { workspaceId: a.id, sessionIds: [...a.sessionIds], targetGroup: ['AgentTools'], dryRun: true })
      if (preview.report.some(r => r.after !== 'AgentTools/' + r.before.split('/').at(-1))) throw Error('native preview wrong')
      if (JSON.stringify(before) !== JSON.stringify(await observe())) throw Error('passive tools changed sessions/Agents')
      // Caller in A is allowed to explicitly choose B; no hidden own-workspace gate.
      const foreign = await call('workspace_move_sessions_to_group', { workspaceId: b.id, sessionIds: [s.id], targetGroup: ['ChosenB'], operationId: 'native-other-workspace' })
      if (foreign.report[0].outcome !== 'success') throw Error('chosen other workspace denied')
      const bAfter = (await observe()).rows.find(r => r.id === s.id)
      const moved = await call('workspace_move_sessions_to_group', { workspaceId: a.id, sessionIds: [...a.sessionIds], targetGroup: ['AgentTools'], operationId: 'native-move-a' })
      if (moved.report.some(r => r.outcome !== 'success')) throw Error('native move failed')
      const renamed = await call('workspace_rename_session_group', { workspaceId: a.id, sourceGroup: ['AgentTools'], targetGroup: ['RenamedTools'], operationId: 'native-rename-a' })
      if (renamed.report.some(r => r.outcome !== 'success')) throw Error('native rename failed')
      const replay = await call('workspace_rename_session_group', { workspaceId: a.id, sourceGroup: ['AgentTools'], targetGroup: ['RenamedTools'], operationId: 'native-rename-a' })
      if (JSON.stringify(replay) !== JSON.stringify(renamed)) throw Error('replay mismatch')
      const after = await observe()
      if (after.rows.some(r => r.prompts) || JSON.stringify(after.archived) !== JSON.stringify(before.archived)) throw Error('prompt or archive changed')
      if (JSON.stringify(after.rows.find(r => r.id === s.id)) !== JSON.stringify(bAfter)) throw Error('A operation touched B')
      return { registeredTools: 4, passiveNoAgentEvents: true, nativePipeline: true, ownAndOtherSessions: true, explicitOtherWorkspace: true, archivedPreserved: true, prompts: 0, replayNoDuplicate: true, finalGroup: 'RenamedTools' }
    } finally { await actorHandle.dispose() }
  }
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/bw-grouping-fixture', methods: ['POST'], requestBody: 'buffered', async fetch() {
    try { if (!flight) flight = run(); return new Response(JSON.stringify(await flight), { headers: { 'content-type': 'application/json' } }) }
    catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } }) }
  } }))
}
