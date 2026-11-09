"""Finite browser test against an immutable SDK and a fresh disposable profile.

BW_SDK: installed release directory containing node_modules.
BW_PRIVATE: private artifact directory (0700), outside the repository.
BW_NODE: Node >=24.9 binary. Run with a Python environment providing Playwright.
No ambient credentials, production profile, prompts or model messages are used.
"""
import asyncio
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tarfile
import tempfile
import time
from urllib.parse import urlparse
from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parents[2]


def link_modules(sdk, target):
    target.mkdir(parents=True)
    for package in (sdk / 'node_modules').iterdir():
        if package.name.startswith('@'):
            scope = target / package.name
            scope.mkdir()
            for child in package.iterdir():
                (scope / child.name).symlink_to(child)
        elif not package.name.startswith('.'):
            (target / package.name).symlink_to(package)


async def dismiss_setup(page):
    # Fresh browsers have independent preview/login UI preferences. Never
    # supply provider credentials; use only native dismissal buttons.
    quiet = 0
    for _ in range(18):
        await page.wait_for_timeout(200)
        clicked = False
        for name in ['Continue', 'Configure later', 'Later', 'Skip for now', 'Close']:
            button = page.get_by_role('button', name=name, exact=True)
            if await button.count() and await button.last.is_visible():
                try:
                    await button.last.click(timeout=600)
                    clicked = True
                    break
                except Exception:
                    pass
        quiet = 0 if clicked else quiet+1
        if quiet >= 5:
            break


async def local_only(route):
    if urlparse(route.request.url).hostname in ('127.0.0.1', 'localhost'):
        await route.continue_()
    else:
        await route.abort()


async def scenarios(url, root, report):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, env={'HOME':str(root/'home'), 'XDG_CONFIG_HOME':str(root/'home/config'), 'XDG_DATA_HOME':str(root/'home/data'), 'XDG_STATE_HOME':str(root/'home/state'), 'PATH':'/usr/bin:/bin', 'LANG':'C.UTF-8'})
        try:
            context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
            await context.route('**/*', local_only)
            # Auth bootstrap stays in memory. Never serialize browser state.
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            await page.goto(url, wait_until='networkidle')
            await page.wait_for_function('window.__bwFixture !== undefined')
            await dismiss_setup(page)
            assert await page.locator('.bw-root').count() == 1
            snapshot = await page.evaluate('window.__bwFixture.snapshots()')
            workspaces = snapshot['workspaces']['items']
            workspace = next(w for w in workspaces if w['title'] == 'Container A')
            assert len(workspace['sessionIds']) == 3
            by_id = snapshot['sessions']['byId']
            managing = next(s['id'] for s in by_id.values() if s.get('title') == 'g/Managing')
            other = next(s['id'] for s in by_id.values() if s.get('title') == 'g/Other')
            archived = next(s['id'] for s in by_id.values() if s.get('title') == 'g/Archived')
            observation = await page.evaluate('__bwFixture.observe()')
            assert observation['ok']
            cold_before = observation['value']
            titles = await page.evaluate('(request)=>__bwFixture.readTitles(request)', {'workspaceId':workspace['workspaceId'],'sessionIds':workspace['sessionIds']})
            assert titles['ok'], titles.get('error',{}).get('code')
            assert len(titles['value']) == 3
            after = await page.evaluate('__bwFixture.observe()')
            assert after['value'] == cold_before
            report['native_passive_titles_no_activation_or_write'] = 'pass'
            assert snapshot['config']['status'] == 'ready' and snapshot['config']['writable']
            label = page.get_by_role('button', name='Container A', exact=True)
            arrow = page.locator('.bw-container-row').filter(has=label).locator('.bw-tree-toggle')
            before = len(by_id)
            await arrow.click()
            assert len((await page.evaluate('__bwFixture.snapshots()'))['sessions']['ids']) == before
            await label.click()
            await page.get_by_role('dialog').wait_for()
            assert await page.get_by_text('Choose a managing session.', exact=False).count()
            # The shipped MenuPicker keeps keyboard/focus behavior and theme.
            await page.get_by_role('dialog').get_by_role('button', name='No managing session', exact=False).click()
            await page.get_by_role('menuitem', name='g/Managing', exact=True).click()
            await page.get_by_role('dialog').get_by_role('button', name='OK', exact=True).click()
            await page.wait_for_function('([w,id])=>__bwFixture.snapshots().config.value.serviceSessions[w]===id', arg=[workspace['workspaceId'], managing])
            await label.press('Enter')
            await page.wait_for_function('(id)=>__bwFixture.snapshots().sessions.byId[id].retainedBy?.mainView>0', arg=managing)
            report['service_assign_open'] = 'pass'
            # Reload and genuinely separate browser storage, same native server.
            await page.reload(wait_until='networkidle')
            await page.wait_for_function('window.__bwFixture !== undefined')
            await dismiss_setup(page)
            second = await browser.new_context()
            await second.route('**/*', local_only)
            page2 = await second.new_page()
            await page2.goto(url, wait_until='networkidle')
            await page2.wait_for_function('window.__bwFixture !== undefined')
            await dismiss_setup(page2)
            await page2.wait_for_function('([w,id])=>__bwFixture.snapshots().config.value?.serviceSessions?.[w]===id', arg=[workspace['workspaceId'], managing])
            report['reload_separate_browser'] = 'pass'
            # Native menu rename adapter retains and releases through RPC settlement.
            result = await page.evaluate('async ([id,title])=>{const r=await __bwFixture.renameSession(id,title);return r.ok?r:{ok:false,error:{code:r.error.code,message:r.error.message}}}', [other, 'g/Other renamed'])
            (root/'rename-result.json').write_text(json.dumps(result))
            assert result['ok'], result.get('error',{}).get('code')
            await page.wait_for_function('(id)=>__bwFixture.retainInfo(id).retainedBy.workspaceOperation===undefined', arg=other)
            report['public_rename_disposal'] = 'pass'
            # The real group dialog must include the hidden archived member.
            toggle = page.locator('.bw-container-row').filter(has=page.get_by_role('button', name='Container A', exact=True)).locator('.bw-tree-toggle')
            if await toggle.get_attribute('aria-expanded') == 'false':
                await toggle.click()
            group = page.locator('.bw-sgroup-row').filter(has=page.locator('.bw-row-label', has_text='g')).first
            await group.click(button='right')
            await page.get_by_role('menuitem', name='Rename session group', exact=True).click()
            await page.get_by_role('dialog').get_by_role('textbox').fill('renamed')
            await page.get_by_role('dialog').get_by_role('button', name='OK', exact=True).click()
            await page.get_by_role('dialog', name='Review group changes').wait_for()
            assert await page.get_by_role('dialog').get_by_text('g/Archived', exact=False).count()
            await page.get_by_role('dialog').get_by_role('button', name='OK', exact=True).click()
            await page.wait_for_function("()=>document.querySelectorAll('[role=dialog] strong').length===3")
            outcomes = await page.get_by_role('dialog').locator('strong').all_text_contents()
            assert all('Confirmed' in outcome for outcome in outcomes), outcomes
            await page.get_by_role('dialog').get_by_role('button', name='Close', exact=True).last.click()
            group_titles = await page.evaluate('(request)=>__bwFixture.readTitles(request)', {'workspaceId':workspace['workspaceId'],'sessionIds':workspace['sessionIds']})
            assert all(row['title'].startswith('renamed/') for row in group_titles['value'])
            observation = (await page.evaluate('__bwFixture.observe()'))['value']
            assert archived in observation['archived']
            assert all(row['prompts']==0 for row in observation['sessions'])
            assert any(row['id']==archived and row['live'] for row in observation['sessions'])
            report['native_group_hidden_archived_rename_no_prompt_or_unarchive'] = 'pass'
            # Bad bindings never create/rebind/restore implicitly.
            for session_id, text in [(archived, 'The assigned session is archived.'), ('fixture-missing-session', 'The assigned session is unavailable.')]:
                await page.evaluate('([w,id])=>__bwFixture.setBindings({[w]:id})', [workspace['workspaceId'], session_id])
                await page.get_by_role('button', name='Container A', exact=True).click()
                await page.get_by_role('dialog').wait_for()
                assert await page.get_by_text(text, exact=False).count()
                await page.get_by_role('dialog').get_by_role('button', name='Cancel', exact=True).click()
            assert len((await page.evaluate('__bwFixture.snapshots()'))['sessions']['ids']) == before
            report['invalid_binding_no_creation'] = 'pass'
            await page.evaluate('__bwFixture.setBindings({})')
            await page2.wait_for_function('(w)=>!__bwFixture.snapshots().config.value.serviceSessions[w]', arg=workspace['workspaceId'])
            report['clear_cross_browser'] = 'pass'
            # Real group UI under duplicate disk branches: the full-title
            # preview must contain precisely A's two members, never B's group.
            await page.evaluate("""()=>{const k='dsh.betterWorkspace.view.v1';const v=JSON.parse(localStorage.getItem(k)||'{}');v.workspaceGroupMode='disk-slash';v.prefs={...v.prefs,compactChains:false};localStorage.setItem(k,JSON.stringify(v))}""")
            await page.reload(wait_until='networkidle')
            await page.wait_for_function('window.__bwFixture !== undefined')
            await dismiss_setup(page)
            group_row = page.locator('[data-row-key="f-'+workspace['workspaceId']+'//same"]')
            await group_row.click(button='right')
            await page.get_by_role('menuitem', name='Rename folder', exact=True).click()
            await page.get_by_role('dialog').get_by_role('textbox').fill('scoped')
            await page.get_by_role('dialog').get_by_role('button', name='OK', exact=True).click()
            preview = page.get_by_role('dialog', name='Review group changes')
            await preview.wait_for()
            assert await preview.get_by_text('same/One', exact=False).count()
            assert await preview.get_by_text('same/Two', exact=False).count()
            assert not await preview.get_by_text('same/Other', exact=False).count()
            await preview.get_by_role('button', name='OK', exact=True).click()
            await page.wait_for_function("()=>document.querySelectorAll('[role=dialog] strong').length===2")
            assert all('Confirmed' in outcome for outcome in await preview.locator('strong').all_text_contents())
            await preview.get_by_role('button', name='Close', exact=True).last.click()
            fresh = (await page.evaluate('__bwFixture.snapshots()'))['workspaces']['items']
            assert sum(w['title'].startswith('scoped/') for w in fresh)==2
            assert any(w['title']=='same/Other' for w in fresh)
            report['native_duplicate_disk_group_exact_members'] = 'pass'
            # New-session hero still owns its native picker; no child-hole takeover.
            await page.get_by_text('New Session', exact=True).first.click()
            await dismiss_setup(page)
            report['hero_entries'] = await page.evaluate('__bwFixture.slots("conversation.hero.workspace").length')
            assert report['hero_entries'] >= 2
            await page.get_by_role('button', name='Choose workspace', exact=True).click()
            await page.locator('.bw-pick-row').first.wait_for()
            names = await page.locator('.bw-pick-row').all_text_contents()
            for title in ['Container A','Container B','One','Two']:
                assert any(title in name for name in names), title
            assert any('Other' in name for name in names)
            await page.get_by_role('menuitem', name='Add workspace', exact=False).click()
            directory = page.get_by_role('dialog', name='Select Workspace Directory')
            await directory.wait_for()
            await directory.get_by_role('button', name='Cancel', exact=True).click()
            report['native_hero_picker_and_directory_flow_cancel'] = 'pass'
            assert not errors, errors
            # Trigger a real render fault in the disposable copy. Test the
            # shipped recovery dialog and registration disposers, not a mock.
            flows_before = await page.evaluate('[__bwFixture.slots("sidebar.workspaces.directoryFlow"),__bwFixture.slots("conversation.hero.workspace.directoryFlow")]')
            await page.evaluate('window.__bwTreeFault=true')
            await page.locator('.bw-tree-toggle').first.click()
            await page.get_by_role('alert').filter(has_text='The workspace tree could not be displayed').wait_for()
            await page.evaluate('window.__bwTreeFault=false')
            await page.get_by_role('button', name='Retry tree', exact=True).click()
            await page.locator('.bw-root').wait_for()
            await page.evaluate('window.__bwTreeFault=true')
            await page.locator('.bw-tree-toggle').first.click()
            await page.get_by_role('button', name='Use standard list', exact=True).click()
            await page.wait_for_function('()=>document.querySelector(".bw-root")===null')
            entries = await page.evaluate('[__bwFixture.slots("sidebar.workspaces"),__bwFixture.slots("conversation.hero.workspace")]')
            assert all(not any(row['priority']==-1 for row in rows) for rows in entries)
            flows_after = await page.evaluate('[__bwFixture.slots("sidebar.workspaces.directoryFlow"),__bwFixture.slots("conversation.hero.workspace.directoryFlow")]')
            assert flows_before == flows_after
            assert await page.get_by_text('Container A', exact=True).count()
            report['native_root_retry_stock_restoration_original_flow_owners'] = 'pass'
            # Distinguish deliberate fault events from unrelated errors.
            unexpected = [error for error in errors if 'synthetic root fault' not in error]
            report['expected_fault_events'] = len(errors)-len(unexpected)
            report['unexpected_page_errors'] = len(unexpected)
            assert not unexpected, [error[:100] for error in unexpected]
            await page.get_by_role('button', name='Choose workspace', exact=True).click()
            await page.get_by_role('menuitem', name='Add workspace', exact=False).click()
            directory = page.get_by_role('dialog', name='Select Workspace Directory')
            await directory.wait_for()
            await directory.get_by_role('button', name='Cancel', exact=True).click()
            report['native_stock_directory_flow_after_recovery'] = 'pass'
            await second.close()
            await context.close()
        except Exception:
            (root/'synthetic-dom.txt').write_text(await page.locator('body').inner_text())
            raise
        finally:
            await browser.close()


def main():
    sdk = Path(os.environ['BW_SDK']).resolve()
    private = Path(os.environ['BW_PRIVATE']).resolve()
    node = Path(os.environ['BW_NODE']).resolve()
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    assert private != REPO and REPO not in private.parents
    root = Path(tempfile.mkdtemp(prefix='bw-isolated-', dir=private))
    os.chmod(root, 0o700)
    home, cwd = root / 'home', root / 'cwd'
    home.mkdir(); cwd.mkdir()
    catalog = root / 'synthetic-catalog'; catalog.mkdir()
    profile = home / '.dsh/profiles/web'; profile.mkdir(parents=True)
    link_modules(sdk, profile / 'node_modules')
    package = profile / 'node_modules/dsh-better-workspace'; package.mkdir()
    artifact = REPO / 'dsh-better-workspace-0.41.0-workain.1.tgz'
    with tarfile.open(artifact) as tar:
        for member in tar.getmembers():
            assert member.name.startswith('package/') and '..' not in Path(member.name).parts
            member.name = member.name[len('package/'):]
            if member.name:
                tar.extract(member, package, filter='data')
    entry = package/'src/client.js'
    original = entry.read_text()
    marker = 'function BetterBrowser(props) {'
    assert original.count(marker) == 1
    entry.write_text(original.replace(marker, marker+" if (window.__bwTreeFault) throw Error('synthetic root fault');"))
    (profile / 'node_modules/bw-tree-fixture').symlink_to(REPO / 'tests/e2e/fixture')
    (profile / 'package.json').write_text(json.dumps({'name':'bw-isolated-profile','private':True,'dependencies':{},'dsh':{'profile':{'bundles':['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-better-workspace']}}}))
    (profile / 'cordis.yml').write_text('[]\n')
    (profile / 'cordis.patch.yml').write_text('- insert:\n    - id: bw-tree-fixture\n      name: bw-tree-fixture\n      config:\n        root: '+str(catalog)+'\n')
    env = {'HOME':str(home),'DSH_HOME':str(home/'.dsh'),'TMPDIR':str(root),'LANG':'C.UTF-8','PATH':str(node.parent)+':/usr/bin:/bin','DSH_TELEMETRY_DISABLED':'1'}
    for key, sub in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_STATE_HOME','state')]:
        env[key] = str(home/sub)
    log = root / 'server.log'
    report = {}
    with log.open('w') as out:
        process = subprocess.Popen([str(node),str(sdk/'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--no-open','--host','127.0.0.1','--port','0'],cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT,start_new_session=True)
        try:
            deadline = time.monotonic()+60
            while time.monotonic()<deadline:
                if process.poll() is not None:
                    raise RuntimeError('Isolated server exited; inspect private log')
                match = re.search(r'https?://[^\s\x1b]+',log.read_text())
                if match:
                    asyncio.run(asyncio.wait_for(scenarios(match.group(),root,report), timeout=180))
                    break
                time.sleep(.2)
            else:
                raise TimeoutError('Isolated startup timeout')
        finally:
            os.killpg(process.pid,signal.SIGTERM)
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
            report['server_stopped'] = process.poll() is not None
            # Retain exact disposable paths privately for diagnosis; never delete
            # unrelated paths or expose startup URLs/cookies in public evidence.
            (root/'result.json').write_text(json.dumps(report,indent=2))
            print(json.dumps(report,sort_keys=True))

if __name__ == '__main__':
    main()
