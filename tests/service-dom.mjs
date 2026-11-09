import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { chunk, entryHelpers } from './chunks.mjs'
const feature=chunk('service',{'react':React})
const plain=v=>JSON.parse(JSON.stringify(v))
function nativeForm() {
  let state={status:'ready',writable:true,revision:1,value:{serviceSessions:{}}}
  const listeners=new Set()
  return {getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    async mutate(ops,revision){
      if(revision!==state.revision)return false
      const map={...state.value.serviceSessions}
      for(const op of ops){const id=op.path[1];if(op.op==='unset')delete map[id];else map[id]=op.value}
      state={...state,revision:state.revision+1,value:{serviceSessions:map}};for(const fn of listeners)fn();return true
    },
  }
}
test('server binding store: assign/change/clear, reload and independent browsers, revision conflict',async()=>{
  const form=nativeForm(),a=feature.createBindingStore(),b=feature.createBindingStore()
  a.attach(form);b.attach(form)
  await a.save('workspace','one',1)
  assert.equal(b.getSnapshot().value.serviceSessions.workspace,'one')
  await assert.rejects(b.save('workspace','other',1),/settings-refused/)
  const reloaded=feature.createBindingStore();reloaded.attach(form)
  assert.equal(reloaded.getSnapshot().value.serviceSessions.workspace,'one')
  await b.save('workspace','two',2);assert.equal(a.getSnapshot().value.serviceSessions.workspace,'two')
  await reloaded.save('workspace','',3);assert.deepEqual(plain(a.getSnapshot().value.serviceSessions),{})
  a.attach(null);await assert.rejects(a.save('workspace','one',4),/settings-unavailable/)
})
test('explicit binding eligibility: pins never designate, missing/deleted/foreign/subagent/archived stay unavailable',()=>{
  const w={sessionIds:['one','archived','child']},byId={one:{id:'one'},archived:{id:'archived'},child:{origin:'subagent'},foreign:{id:'foreign'}}
  for(const [id,reason] of [[undefined,'unassigned'],['missing','missing'],['foreign','foreign'],['child','foreign'],['archived','archived']])
    assert.equal(feature.resolve(w,id,byId,new Set(['archived'])).reason,reason)
  assert.equal(feature.resolve(w,'one',byId,new Set()).id,'one')
})
function setup() {
  const dom=new JSDOM('<!DOCTYPE html><div id="root"></div>',{url:'http://fixture.invalid'})
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  return {dom,container:document.getElementById('root')}
}
test('actual workspace row: label/chevron, keyboard, double-click rename, focus and propagation',async()=>{
  const {dom,container}=setup(),op=chunk('operations'),h=entryHelpers(op,{'react':React})
  const root=createRoot(container),calls=[]
  await act(()=>root.render(React.createElement(h.WorkspaceRow,{
    workspace:{workspaceId:'fixture',title:'Fixture',leaf:'Fixture'},depth:0,count:1,sessionsOpen:false,
    onToggle:()=>calls.push('toggle'),onOpenService:()=>calls.push('open'),onRename:()=>calls.push('rename'),
    onStart:()=>calls.push('new'),t:key=>key,
  })))
  const label=container.querySelector('.bw-service-label'),arrow=container.querySelector('.bw-tree-toggle')
  assert.equal(label.tagName,'BUTTON');assert.equal(arrow.getAttribute('aria-expanded'),'false')
  await act(()=>arrow.click());assert.deepEqual(calls,['toggle']);calls.length=0
  label.focus();assert.equal(document.activeElement,label)
  await act(()=>label.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})))
  assert.deepEqual(calls,['open']);calls.length=0
  await act(()=>label.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})))
  assert.deepEqual(calls,['toggle']);calls.length=0
  await act(()=>{label.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,detail:1}));label.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,detail:2}));label.dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true,detail:2}))})
  await new Promise(resolve=>setTimeout(resolve,520));assert.deepEqual(calls,['rename']);calls.length=0
  await act(()=>label.click());await new Promise(resolve=>setTimeout(resolve,520));assert.deepEqual(calls,['open'])
  await act(()=>root.unmount());dom.window.close()
})
test('actual root boundary retries and withdraws only fork entries, restoring native owner/child registrations',async()=>{
  const {dom,container}=setup(),recovery=chunk('recovery',{'react':React}),restoration=recovery.createRestoration()
  const entries=new Set(['native-sidebar','native-directory-flow','fork-sidebar','fork-hero','optional-badge'])
  restoration.add(()=>entries.delete('fork-sidebar'));restoration.add(()=>entries.delete('fork-hero'))
  let broken=true
  function Tree(){if(broken)throw Error('fixture render fault');return React.createElement('p',null,'tree restored')}
  const root=createRoot(container),originalError=console.error;console.error=()=>{}
  try {
    await act(()=>root.render(React.createElement(recovery.RootBoundary,{t:key=>key,restore:()=>restoration.restore()},React.createElement(Tree))))
    assert.match(container.textContent,/recovery.message/)
    broken=false;await act(()=>container.querySelector('button').click());assert.match(container.textContent,/tree restored/)
    broken=true;await act(()=>root.render(React.createElement(recovery.RootBoundary,{t:key=>key,restore:()=>restoration.restore()},React.createElement(Tree))))
    await act(()=>container.querySelectorAll('button')[1].click())
    assert.deepEqual([...entries],['native-sidebar','native-directory-flow','optional-badge'])
    assert.equal(restoration.disabled,true)
    restoration.add(()=>entries.delete('late-fork'));assert.equal(entries.has('late-fork'),false)
  } finally {console.error=originalError;await act(()=>root.unmount());dom.window.close()}
})

test('actual hero picker keeps all workspace targets across the nine view/group modes',async()=>{
  const {dom,container}=setup(),root=createRoot(container),op=chunk('operations')
  const Menu=({children})=>React.createElement('div',null,children)
  const h=entryHelpers(op,{'react':React,'@deepseek-ai/dsh-client-ui-primitives':{Menu}})
  const items=[{workspaceId:'a',title:'Container',path:'/fixture/a'},
    {workspaceId:'one',title:'g/One',path:'/fixture/a/one'},
    {workspaceId:'two',title:'g/Two',path:'/fixture/a/two'}]
  const choices=[]
  for(const groupBy of ['workspace-tree','workspace','flat']) for(const workspaceGroupMode of ['disk','disk-slash','slash']) {
    const state={groupBy,workspaceGroupMode,prefs:{compactChains:false}},snapshot={items}
    await act(()=>root.render(React.createElement(h.HeroWorkspacePicker,{open:true,
      useWorkspaces:selector=>selector(snapshot),useStore:selector=>selector(state),
      useDirectoryFlow:selector=>selector(0),onPick:id=>choices.push(id),t:key=>key})))
    const buttons=[...container.querySelectorAll('.bw-pick-row')].filter(b=>!b.querySelector('.bw-pick-folder'))
    assert.equal(buttons.length,3,groupBy+'/'+workspaceGroupMode)
    for(const button of buttons) await act(()=>button.click())
    assert.deepEqual(choices.splice(0).sort(),['a','one','two'])
  }
  await act(()=>root.unmount());dom.window.close()
})
