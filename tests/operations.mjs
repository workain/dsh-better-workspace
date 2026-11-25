import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { chunk, entryHelpers } from './chunks.mjs'
const op = chunk('operations'), h = entryHelpers(op), plans = chunk('plans')
const plain = value => JSON.parse(JSON.stringify(value))
function fixture(mode = 'disk-slash') {
  const items = [
    { workspaceId: 'a', title: 'Container A', path: '/fixture/a', sessionIds: ['one', 'hidden', 'opaque', 'quoted'] },
    { workspaceId: 'b', title: 'Container B', path: '/fixture/b', sessionIds: [] },
    { workspaceId: 'a1', title: 'same/One', path: '/fixture/a/one', sessionIds: [] },
    { workspaceId: 'a2', title: 'same/deep/Two', path: '/fixture/a/two', sessionIds: [] },
    { workspaceId: 'b1', title: 'same/Other', path: '/fixture/b/one', sessionIds: [] },
    { workspaceId: 'physical', title: 'same/Physical child', path: '/fixture/a/one/child', sessionIds: [] },
  ]
  const byId = Object.fromEntries([
    ['one','g/First','user'],['hidden','g/Archived old','user'],['opaque','g/Automatic','provider'],['quoted','g/“url/a/b”','user'],
  ].map(([id,title,kind]) => [id, { id,title,updatedAt:1, projectionValues:{'betterWorkspace/titleSource':kind} }]))
  const state = { items, list: { byId }, archivedSessionIds: ['hidden'] }
  const declared = { workspace: { a: ['empty','empty/deep'] }, session: { a: ['empty','empty/deep'] } }
  let writes = [], declarations = [], hook
  const planner = plans.createPlanner({ operations: op, state: () => state,
    tree: () => h.buildTree(items,mode,declared.workspace,{}), split:h.splitTitleSegs,
    buildSessions:h.buildSessionTree, findSessions:h.findSessionGroup, collectSessions:h.collectSessionRows,
    allowed:h.groupsAllowedFor, declarations:(kind,scope) => declared[kind][scope] || [],
    runner:op.createRunner({timeoutMs:50}),
    renameWorkspace: async (id,title) => { writes.push([id,title]); items.find(w=>w.workspaceId===id).title=title; if(hook) await hook(id) },
    renameSession: async (id,title) => { writes.push([id,title]); byId[id].title=title; if(hook) await hook(id) },
    updateDeclarations:(...args)=>declarations.push(args),
  })
  return { state, planner, writes, declarations, hook: value => {hook=value}, declared }
}
test('exact same-name group under one disk owner; nested disk children untouched', async () => {
  const f=fixture(), prepared=f.planner.prepare('workspace',{idPath:'a//same',path:'same',scope:'a'},'renamed')
  assert.deepEqual(plain(prepared.plan.changes.map(r=>r.id)),['a1','a2'])
  assert.deepEqual(plain((await prepared.run()).map(r=>r.outcome)),['success','success'])
  assert.equal(f.state.items.find(w=>w.workspaceId==='b1').title,'same/Other')
  assert.equal(f.state.items.find(w=>w.workspaceId==='physical').title,'same/Physical child')
})
test('all grouping modes and compression preserve physical/naming identities', () => {
  for(const mode of ['disk','disk-slash','slash']) {
    const f=fixture(mode), tree=h.buildTree(f.state.items,mode,f.declared.workspace,{})
    if(mode==='disk') { assert.equal(op.findFolder(tree,'a//same'),null); continue }
    const key=mode==='slash'?'same':'a//same', node=op.findFolder(tree,key)
    assert.ok(node)
    const compressed=h.materializeChain(h.compressTree(node))
    assert.equal(compressed.idPath,key)
    const ids=op.folderMembers(node)
    assert.equal(ids.includes('b1'),mode==='slash')
    assert.equal(ids.includes('physical'),mode==='slash')
  }
})
test('group plan uses complete session membership including archived and age-hidden; provenance and quotes', async()=>{
  const f=fixture(), p=f.planner.prepare('session',{workspaceId:'a',path:'g'},'new')
  assert.deepEqual(plain(p.plan.changes.map(r=>r.id)),['one','hidden','quoted'])
  await p.run()
  assert.equal(f.state.list.byId.hidden.title,'new/Archived old')
  assert.equal(f.state.list.byId.opaque.title,'g/Automatic')
  assert.equal(f.state.list.byId.quoted.title,'new/“url/a/b”')
})
test('empty groups still get a confirmed declaration-only plan',async()=>{
  const f=fixture(),p=f.planner.prepare('workspace',{idPath:'a//empty',path:'empty',scope:'a'},'new')
  assert.equal(p.plan.changes.length,0); await p.run();assert.equal(f.declarations.length,1)
})
test('stale membership/title before confirmation refuses all writes',async()=>{
  for(const change of [f=>f.state.items.push({workspaceId:'new',title:'same/New',path:'/fixture/a/new'}),f=>f.state.items[2].title='other/Concurrent']) {
    const f=fixture(),p=f.planner.prepare('workspace',{idPath:'a//same',path:'same',scope:'a'},'new');change(f)
    await assert.rejects(p.run(),/stale-plan/);assert.equal(f.writes.length,0)
  }
})
test('concurrent prefix edit during writes stops without overwriting it or rolling back first success',async()=>{
  const f=fixture();f.hook(()=>{f.state.items.find(w=>w.workspaceId==='a2').title='elsewhere/Concurrent'})
  const p=f.planner.prepare('workspace',{idPath:'a//same',path:'same',scope:'a'},'new'), report=await p.run()
  assert.deepEqual(plain(report.map(r=>r.outcome)),['success','stale']);assert.equal(f.writes.length,1);assert.equal(f.declarations.length,0)
})
test('unknown authoritative session titles refuse a write plan',()=>{
  const f=fixture();delete f.state.list.byId.hidden.title
  assert.throws(()=>f.planner.prepare('session',{workspaceId:'a',path:'g'},'new'),/unknown-title/)
})
test('grammar keeps paths/URLs/opaque user leaves; raw prefix collision refused',()=>{
  for(const [title,from,to,result] of [
    ['g/https://example.invalid/a/b','g','new','new/https://example.invalid/a/b'],
    ['g/“/fixture/a/b”','g','new','new/“/fixture/a/b”'],
    ['g/sub/Leaf','g','new','new/sub/Leaf'],
  ]) assert.equal(op.retitle(title,from,to,h.splitTitleSegs),result)
  assert.throws(()=>op.retitle('group/Leaf','g','new',h.splitTitleSegs),/stale-group/)
  assert.throws(()=>op.retitle('g/Automatic','g','new',h.splitTitleSegs,false),/stale-group/)
})
test('partial failure, timeout, unknown result, and reentrancy produce exact report without retry',async()=>{
  const plan={snapshot:1,changes:['a','b','c'].map(id=>({id,expected:'old',before:'old',after:'new'}))}
  for(const kind of ['refusal','transport','timeout']) {
    let calls=0,settle
    const runner=op.createRunner({timeoutMs:5}), write=async()=>{
      if(++calls===1)return
      if(kind==='timeout')return new Promise(resolve=>{settle=resolve})
      const e=new Error(kind);e.definite=kind==='refusal';throw e
    }
    const promise=runner.run(plan,{snapshot:()=>1,read:()=> 'old',write})
    await assert.rejects(runner.run(plan,{snapshot:()=>1,read:()=> 'old',write}),/operation-busy/)
    const report=await promise
    assert.deepEqual(plain(report.map(r=>r.outcome)),['success',kind==='refusal'?'failure':'unknown','not-attempted'])
    assert.equal(calls,2)
    if(settle){assert.equal(runner.busy,true);settle();await Promise.resolve();await Promise.resolve()}
  }
})
test('public session using owns async rename lifetime on success and failure',async()=>{
  for(const ok of [true,false]) {
    const events=[]
    const sessions={using:async(id,options,callback)=>{
      assert.equal(options.source,'workspaceOperation');events.push('retain')
      try { return await callback({binding:{session:{rename:async title=>{await Promise.resolve();events.push(title);return {ok,error:{message:'refused'}}}}}}) }
      finally {events.push('release')}
    }}
    if(ok)await op.renameSession(sessions,'fixture-session','new');else await assert.rejects(op.renameSession(sessions,'fixture-session','new'),/refused/)
    assert.deepEqual(events,['retain','new','release'])
  }
})
test('indexed subagents: fork exclusion, live override, cycle guards, realistic/stress operation counts',()=>{
  const sample={p:{id:'p'},s:{id:'s',parentId:'p',origin:'subagent',running:true},f:{id:'f',parentId:'p',running:true}}
  assert.equal(op.subagentCounts(sample,new Map()).get('p'),1)
  assert.equal(op.subagentCounts(sample,new Map([['s',{running:false}]])).get('p'),0)
  const cycle={a:{id:'a',parentId:'b',origin:'subagent',running:true},b:{id:'b',parentId:'a',origin:'subagent',running:true}}
  assert.deepEqual(plain([...op.subagentCounts(cycle,new Map())]),[['a',1],['b',1]])
  for(const n of [500,2000,10000]) {
    const byId=Object.fromEntries(Array.from({length:n},(_,i)=>['s'+i,{id:'s'+i,parentId:i?'s'+(i-1):undefined,origin:'subagent',running:true}]))
    const metrics={},start=performance.now(),counts=op.subagentCounts(byId,new Map(),metrics),ms=performance.now()-start
    assert.equal(counts.get('s0'),n-1);assert.equal(metrics.nodes,n);assert.equal(metrics.edges,n-1)
    console.log(JSON.stringify({benchmark:'subagent-chain',n,ms:+ms.toFixed(3),...metrics}))
  }
})
test('group reorder preview fences membership/order and reports partial RPCs',async()=>{
  let items=['a','b','c','anchor'].map(workspaceId=>({workspaceId,title:workspaceId,path:'/fixture/'+workspaceId}))
  const writes=[]
  const make=()=>op.orderPlan({ids:['a','b','c'],anchor:'anchor',state:()=>items,runner:op.createRunner(),describe:title=>title+' before anchor',afterSuccess:()=>writes.push('local-order'),
    write:async(id,anchor)=>{writes.push(id);if(id==='b'){const e=new Error('refused');e.definite=true;throw e}const row=items.find(w=>w.workspaceId===id);items=items.filter(w=>w!==row);items.splice(items.findIndex(w=>w.workspaceId===anchor),0,row)},
  })
  const p=make();assert.equal(p.plan.changes.length,3)
  const report=await p.run();assert.deepEqual(plain(report.map(r=>r.outcome)),['success','failure','not-attempted']);assert.deepEqual(writes,['a','b'])
  const stale=make();items.reverse();await assert.rejects(stale.run(),/stale-plan/)
})

test('move identities preserve quoted delimiters, nested name-only parents and physical roots', () => {
  const items = [
    { workspaceId:'disk',title:'Container',path:'/fixture/a' },
    { workspaceId:'one',title:'top/“quoted//segment”/child/One',path:'/fixture/a/one' },
    { workspaceId:'two',title:'top/“quoted//segment”/child/Two',path:'/fixture/a/two' },
    { workspaceId:'nested',title:'inner/X',path:'/fixture/a/one/deeper' },
  ]
  for (const mode of ['slash','disk-slash']) {
    const index = op.folderIdentities(h.buildTree(items,mode,{},{}),h.splitTitleSegs)
    const scope = mode==='slash'?'':'disk', prefix=scope?scope+'//':''
    const quoted=index.get(prefix+'top/“quoted//segment”')
    assert.equal(quoted.scope,scope)
    assert.equal(quoted.path,'top/“quoted//segment”')
    assert.equal(quoted.leaf,'“quoted//segment”')
    assert.equal(quoted.parentKey,prefix+'top')
    const child=index.get(prefix+'top/“quoted//segment”/child')
    assert.equal(child.parentKey,prefix+'top/“quoted//segment”')
    assert.equal(child.parentPath,'top/“quoted//segment”')
    assert.equal(index.get(scope).path,'')
    assert.equal(index.get(prefix+'top').parentKey,scope)
    assert.equal(quoted.ownerId, mode==='slash'?null:'disk')
    if(mode==='disk-slash') assert.equal(index.get('disk//one//inner').ownerId,'one')
  }
})

test('passive verification failure preserves earlier successes and unattempted members', async () => {
  let checks=0
  const changes=['a','b','c'].map(id=>({id,expected:'old',before:'old',after:'new'}))
  const report=await op.createRunner().run({changes,snapshot:[]},{snapshot:()=>[],read:()=> 'old',
    validate:()=>{if(++checks===2)throw Error('read unavailable');return true},write:async()=>{}})
  assert.deepEqual(plain(report.map(r=>r.outcome)),['success','failure','not-attempted'])
  assert.equal(report[1].reason,'verification-unavailable')
})
