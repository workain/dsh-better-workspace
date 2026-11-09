import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceTitleReader, requestSchema, contribution } from '../src/title-bridge.js'
import { chunk, entryHelpers } from './chunks.mjs'
const plain = value => JSON.parse(JSON.stringify(value))
const op=chunk('operations'),h=entryHelpers(op),plans=chunk('plans')

test('passive title bridge scopes membership/visibility, returns title-only facts and keeps archive state',async()=>{
  let reads=0
  const ctx={
    workspaceRegistry:{get:id=>id==='w'?{sessionIds:['cold','archived','untitled','denied','child']}:undefined,archivedSessionIds:['archived']},
    remoteAccess:{allows:({id})=>id!=='denied'},
    sessionQuery:{readTitleSnapshots:async ids=>{reads++;return ids.map(id=>({sessionId:id,status:'fulfilled',value:{session:{origin:id==='child'?'subagent':'user'},...(id==='untitled'?{}:{title:{title:'g/'+id,source:{kind:'user'},eventSeq:7}})}}))}},
    // Any accidental activation or write fails this test immediately.
    sessions:new Proxy({}, {get(){throw Error('activation forbidden')}}),agents:new Proxy({}, {get(){throw Error('activation forbidden')}}),
  }
  const read=input=>WorkspaceTitleReader.prototype.read.call({ctx},input)
  const result=await read({workspaceId:'w',sessionIds:['cold','archived','untitled','denied','child']})
  assert.deepEqual(result[0],{id:'cold',title:'g/cold',sourceKind:'user',eventSeq:7,eligible:true})
  assert.equal(result[1].eligible,false);assert.equal(result[2].error,'untitled');assert.equal(result[3].title,undefined);assert.equal(result[4].error,'subagent')
  await assert.rejects(read({workspaceId:'w',sessionIds:['foreign']}),/Membership/)
  assert.equal(reads,1)
  assert.throws(()=>requestSchema.parse({workspaceId:'w',sessionIds:Array(257).fill('cold')}))
  assert.equal(contribution.descriptors[0].cancellation.parameter,'signal')
})

test('cold unrelated/archived titles are passively resolved; complete plan and concurrent readback',async()=>{
  const authoritative=new Map([['one',{id:'one',title:'g/First',sourceKind:'user',eventSeq:1}],['hidden',{id:'hidden',title:'g/Archived',sourceKind:'user',eventSeq:2}],['unrelated',{id:'unrelated',title:'elsewhere/Cold',sourceKind:'user',eventSeq:3}],['blank',{id:'blank',error:'untitled'}]])
  const state={items:[{workspaceId:'w',sessionIds:[...authoritative.keys()]}],list:{byId:{one:{id:'one',title:'g/First'}}}}
  let reads=0,writes=[]
  const planner=plans.createPlanner({operations:op,state:()=>state,tree:()=>({}),split:h.splitTitleSegs,buildSessions:h.buildSessionTree,findSessions:h.findSessionGroup,collectSessions:h.collectSessionRows,allowed:h.groupsAllowedFor,
    declarations:()=>[],updateDeclarations:()=>{},runner:op.createRunner(),
    readTitles:async(w,ids)=>{reads++;return ids.map(id=>({...authoritative.get(id)}))},
    renameSession:async(id,title)=>{writes.push(id);authoritative.get(id).title=title;authoritative.get(id).sourceKind='user'},
  })
  const p=await planner.prepareWithTitles('session',{workspaceId:'w',path:'g'},'new')
  assert.deepEqual(plain(p.plan.changes.map(r=>r.id)),['one','hidden'])
  assert.equal(reads,1);assert.equal(writes.length,0)
  assert.deepEqual(plain((await p.run()).map(r=>r.outcome)),['success','success'])
  assert.equal(authoritative.get('unrelated').title,'elsewhere/Cold')
  const stale=await planner.prepareWithTitles('session',{workspaceId:'w',path:'new'},'final')
  authoritative.get('hidden').title='concurrent/Changed'
  assert.deepEqual(plain((await stale.run()).map(r=>r.outcome)),['stale','not-attempted'])
})
