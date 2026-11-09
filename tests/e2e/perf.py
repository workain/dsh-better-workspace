"""Chromium observations for actual production tree helpers and workspace rows.
Uses existing BW_SDK React assets; no server/provider/session data or network.
"""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright
REPO=Path(__file__).resolve().parents[2]

async def main():
    sdk=Path(os.environ['BW_SDK'])
    entry=(REPO/'src/client.js').read_text()
    entry=entry.replace("      name: 'dsh-better-workspace',\n      // The list stays", "      helpers: {buildTree, WorkspaceRow},\n      name: 'dsh-better-workspace',\n      // The list stays")
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        try:
            page=await browser.new_page(viewport={'width':1440,'height':1000})
            await page.set_content('<div id="root"></div>')
            for name in ['react/umd/react.production.min.js','react-dom/umd/react-dom.production.min.js']:
                await page.add_script_tag(path=str(sdk/'node_modules'/name))
            await page.evaluate('''() => {
              window.__ModuleLoader__={load:({factory})=>{window.bwHelpers=factory(id=>id==='react'?React:{}).helpers}};
            }''')
            await page.add_script_tag(content=entry)
            results=[]
            for n in [500,2000,10000]:
                result=await page.evaluate('''async n => {
                  const E=React.createElement,H=bwHelpers,root=ReactDOM.createRoot(document.getElementById('root'));
                  let signal,frames=0;
                  const mounted=new Promise(resolve=>signal=resolve);
                  function App(){
                    const [tick,setTick]=React.useState(0),[open,setOpen]=React.useState(true);
                    const items=React.useMemo(()=>Array.from({length:n},(_,i)=>({workspaceId:'fixture-'+i,path:'/synthetic/'+Math.floor(i/20)+'/'+i,title:'group'+Math.floor(i/20)+'/Item '+i+(i===0?' '+tick:''),sessionIds:[]})),[tick]);
                    H.buildTree(items,'disk-slash',{},{});
                    React.useEffect(()=>{window.bwUpdate=()=>setTick(t=>t+1);signal()},[]);
                    return E('div',{'data-tick':tick,'data-open':String(open)},items.map((w,i)=>E(H.WorkspaceRow,{key:w.workspaceId,workspace:{...w,leaf:w.title},depth:0,count:3,sessionsOpen:open,onToggle:()=>setOpen(x=>!x),onOpenService:()=>{},onRename:()=>{},onStart:()=>{},t:k=>k})));
                  }
                  const start=performance.now();root.render(E(App));await mounted;
                  const initialMs=performance.now()-start,latencies=[];
                  for(let i=0;i<5;i++){
                    const before=document.querySelector('[data-open]').dataset.open, t=performance.now();
                    bwUpdate();document.querySelector('.bw-tree-toggle').click();
                    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                    if(document.querySelector('[data-open]').dataset.open===before) throw Error('toggle lost under update');
                    latencies.push(performance.now()-t);frames++;
                  }
                  const rowCount=document.querySelectorAll('.bw-container-row').length;
                  root.unmount();return {n,rowCount,initialMs,interactionMs:latencies,updates:frames};
                }''',n)
                assert result['rowCount']==n and result['updates']==5
                results.append(result)
            print(json.dumps({'benchmark':'chromium-production-rows-under-catalog-updates','observations':results}))
        finally:
            await browser.close()

if __name__=='__main__':asyncio.run(main())
