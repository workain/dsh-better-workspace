/** Passive, workspace-scoped title reads. No Session/Agent activation. MIT. */
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

export const requestSchema = z.object({ workspaceId: z.string().min(1), sessionIds: z.array(z.string().min(1)).min(1).max(256) }).strict()
const codec = schema => ({ mode: 'strict', typeSymbol: 'BetterWorkspaceTitleRead', create: () => schema })
export const contribution = {
  package: 'dsh-better-workspace', descriptors: [{
    id: 'dsh-better-workspace/betterWorkspaceTitles/read', service: 'betterWorkspaceTitles',
    namespace: 'betterWorkspaceTitles', method: 'read', invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec(requestSchema) }],
    cancellation: { parameter: 'signal' }, result: codec(z.array(z.object({
      id: z.string(), error: z.string().optional(), title: z.string().optional(),
      sourceKind: z.string().optional(), eventSeq: z.number().optional(), eligible: z.boolean(),
    }))),
  }],
}

export class WorkspaceTitleReader extends TypertRemoteService {
  static inject = ['typert', 'sessionQuery', 'workspaceRegistry', 'remoteAccess']
  constructor(ctx) {
    super(ctx, 'betterWorkspaceTitles')
    for (const initialize of initializers) initialize.call(this)
    ctx.effect(() => ctx.typert.remotes.register(contribution))
  }
  async read(request, signal) {
    request = requestSchema.parse(request)
    const workspace = this.ctx.workspaceRegistry.get(request.workspaceId)
    if (!workspace) throw new RemoteError('gateway/bad-request', 'Workspace unavailable', {})
    const ids = [...new Set(request.sessionIds)], members = new Set(workspace.sessionIds)
    if (ids.some(id => !members.has(id))) throw new RemoteError('gateway/bad-request', 'Membership changed', {})
    // Gateway checks every declared session resource before dispatch; check
    // again when producing results so a revoked grant cannot expose a title.
    const observations = await this.ctx.sessionQuery.readTitleSnapshots(ids, signal)
    signal?.throwIfAborted()
    const current = new Set(this.ctx.workspaceRegistry.get(request.workspaceId)?.sessionIds || [])
    const archived = new Set(this.ctx.workspaceRegistry.archivedSessionIds)
    return observations.map(row => {
      const id = row.sessionId
      if (!current.has(id) || !this.ctx.remoteAccess.allows({ kind: 'session', id })) return { id, eligible: false, error: 'unavailable' }
      if (row.status !== 'fulfilled') return { id, eligible: false, error: 'read-failed' }
      const { session, title } = row.value
      if (session.origin === 'subagent') return { id, eligible: false, error: 'subagent' }
      if (!title) return { id, eligible: !archived.has(id), error: 'untitled' }
      return { id, title: title.title, sourceKind: title.source.kind, eventSeq: title.eventSeq, eligible: !archived.has(id) }
    })
  }
}
// Standard decorators are applied explicitly because this package is plain JS
// with no compiler. Use Remote's public initializer contract, no private marker.
const initializers = []
Remote({ resources: { session: request => request.sessionIds } })(WorkspaceTitleReader.prototype.read, {
  kind: 'method', name: 'read', static: false, private: false,
  addInitializer: fn => initializers.push(fn),
})
