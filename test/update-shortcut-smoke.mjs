import assert from 'node:assert/strict';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildCodexPayload } from '../bin/lib/codex.js';
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const payload = buildCodexPayload();
const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/payload.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    response.end(request.url === '/payload.js' ? payload : '<!doctype html><html><head><meta charset="utf-8"></head><body><textarea data-codex-composer></textarea><script src="/payload.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
        const context = await browser.newContext({ reducedMotion });
        await context.addInitScript(() => {
            window.opens = 0; window.update = { available: true, release: { agentVersion: '2.0.0' } };
            window.rastaNative = { status: async () => ({ update: window.update }), check: async () => window.update, openManager: async () => { window.opens++; } };
        });
        const page = await context.newPage(); page.on('pageerror', error => console.error(error.message)); await page.goto(`http://127.0.0.1:${server.address().port}`);
        const trigger = page.getByRole('button', { name: 'Rasta update available. Open Rasta', exact: true }); await trigger.waitFor();
        assert.equal(await page.locator('.artl-widget-panel,.artl-version,#artl-font-add,#artl-update-check,#artl-update-restore').count(), 0);
        const bounds = await trigger.boundingBox(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
        if (reducedMotion === 'reduce') assert.equal(await trigger.evaluate(el => getComputedStyle(el).transform), 'none');
        else await page.waitForFunction(() => getComputedStyle(document.querySelector('.artl-widget-trigger')).transform !== 'none');
        await page.mouse.up(); await page.waitForFunction(() => window.opens === 1);
        await trigger.focus(); await page.keyboard.down('Space');
        assert.equal(await trigger.evaluate(el => getComputedStyle(el).transform), 'none', 'keyboard activation has no scale animation');
        await page.keyboard.up('Space'); await page.waitForFunction(() => window.opens === 2);
        await page.evaluate(() => { window.update = { available: false, release: null }; window.dispatchEvent(new Event('focus')); });
        await trigger.waitFor({ state: 'hidden' }); await context.close();
    }
    console.log('PASS: update-only shortcut opens the manager, hides without an update, has no mutation controls and respects keyboard and reduced-motion press feedback.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
