import { installReadingBridge, setReading } from './helpers/browser-reading.js';
// Exercise optional adapter failures in an isolated browser, without opening the installed host.
import assert from 'node:assert/strict';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildCodexPayload } from '../bin/lib/codex.js';
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const original = buildCodexPayload();
const payload = original.replace('contextFactory({ document, window, changed: () => updateDir() })', '(() => { throw new Error("fixture adapter failure"); })()');
assert.notEqual(payload, original);
const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/payload.js' ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    response.end(request.url === '/payload.js' ? payload : '<html><body><textarea id="composer"></textarea><script src="/payload.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE });
try {
    const context = await browser.newContext();
    await installReadingBridge(context);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('.artl-widget-trigger', { state: 'attached' });
    assert.equal(await page.locator('.artl-widget-panel').count(), 0);
    await setReading(page, { isRTL: false }); await setReading(page, { isRTL: true });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rasta-config')).isRTL), true);
    assert.deepEqual(errors, []);
    console.log('PASS: optional adapter failure retains centrally managed reading preferences, and raises no uncaught errors.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
