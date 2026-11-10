"""Registered grouping tools in a finite disposable native SDK/browser."""
import asyncio
import json
import run as runner

async def scenarios(url, root, report):
    async with runner.async_playwright() as p:
        browser = await p.chromium.launch(headless=True, env={'HOME': str(root/'home'), 'PATH': '/usr/bin:/bin', 'LANG':'C.UTF-8'})
        try:
            context = await browser.new_context(viewport={'width':1440,'height':1000})
            async def local(route):
                if runner.urlparse(route.request.url).hostname in ('127.0.0.1','localhost'):
                    await route.continue_()
                else:
                    await route.abort()
            await context.route('**/*', local)
            page = await context.new_page()
            errors=[]
            page.on('pageerror', lambda e: errors.append(str(e)))
            await page.goto(url, wait_until='networkidle')
            await page.wait_for_function('window.__bwFixture !== undefined')
            await runner.dismiss_setup(page)
            await page.locator('.bw-root').wait_for()
            result=await page.evaluate("fetch('api/bw-grouping-fixture',{method:'POST'}).then(async r=>({status:r.status,body:await r.json()}))")
            (root/'native-tools-result.json').write_text(json.dumps(result,indent=2))
            assert result['status']==200, result['body']
            assert result['body']['nativePipeline'] and result['body']['passiveNoAgentEvents']
            await page.reload(wait_until='networkidle')
            await runner.dismiss_setup(page)
            await page.locator('.bw-root').get_by_text('RenamedTools',exact=True).wait_for(timeout=20000)
            assert not errors
            report.update(result['body'])
            report['native_browser_group_visible']='pass'
            report['unexpected_page_errors']=0
            await context.close()
        except Exception:
            (root/'groups-synthetic-dom.txt').write_text(await page.locator('body').inner_text())
            raise
        finally:
            await browser.close()

runner.scenarios=scenarios
if __name__=='__main__':
    runner.main()
