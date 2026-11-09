// Disposable integration fixture only. Not included in the npm artifact.
import { mkdir, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
export const name = 'bw-tree-fixture'
export const inject = ['sessions','workspaceRegistry','sessionProjections','sessionPersistence']
export async function apply(ctx, config) {
  ctx.plugin(FixtureObservation)
  // Fail closed unless the runner provides its fresh, isolated fixture root.
  const root=resolve(config.root)
  if(await realpath(root)!==root || !root.endsWith('/synthetic-catalog')) throw Error('unsafe fixture root')
  const rows=[['a','Container A'],['b','Container B'],['a/one','same/One'],['a/two','same/Two'],['b/other','same/Other']]
  for(const [relative,title] of rows) {
    const path=join(root,relative);await mkdir(path,{recursive:true})
    const workspace=await ctx.workspaceRegistry.create(path,title)
    if(relative==='a') {
      for(const title of ['g/Managing','g/Archived','g/Other']) {
        const session=ctx.sessions.prepare(randomUUID(),{meta:{cwd:path}})
        const detach=ctx.sessions.enter(session)
        ctx.sessions.announce(session)
        const events=[]
        // A synthetic closed turn has NO user/model messages and invokes no agent.
        events.push(session.append('session/title',{title,messageSeqs:[],source:{kind:'user'}}))
        events.push(session.append('turn/start',{turn:1}))
        events.push(session.append('turn/end',{turn:1,reason:{kind:'interrupted'}}))
        const handle=await ctx.sessionPersistence.create(session.header)
        try { await handle.append(events);await handle.flush() } finally { await handle.close() }
        detach()
        await workspace.attachSession(session.id)
        if(title==='g/Archived') await ctx.workspaceRegistry.archiveSession(session.id)
      }
    }
  }
}

// Test-only observation endpoint: passive evidence, never events/messages.
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
const initializers=[]
class FixtureObservation extends TypertRemoteService {
  static inject=['typert','agents','sessionQuery','workspaceRegistry']
  constructor(ctx) {
    super(ctx,'bwFixture')
    initializers.forEach(fn=>fn.call(this))
    const codec={mode:'strict',typeSymbol:'FixtureObservation',create:()=>({parse:value=>value})}
    ctx.effect(()=>ctx.typert.remotes.register({package:'bw-tree-fixture',descriptors:[{
      id:'bw-tree-fixture/bwFixture/observe',service:'bwFixture',namespace:'bwFixture',method:'observe',invocation:{kind:'direct'},
      parameters:[],result:codec,
    }]}))
  }
  async observe() {
    const workspaces=this.ctx.workspaceRegistry.list(), sessions=[]
    for(const workspace of workspaces) for(const id of workspace.sessionIds) {
      const log=await this.ctx.sessionQuery.readSession(id)
      sessions.push({id,live:!!this.ctx.agents.get(id),eventCount:log.events.length,
        prompts:log.events.filter(e=>e.type==='user/message').length})
    }
    return {sessions,archived:[...this.ctx.workspaceRegistry.archivedSessionIds]}
  }
}
Remote(FixtureObservation.prototype.observe,{kind:'method',name:'observe',static:false,private:false,addInitializer:fn=>initializers.push(fn)})
