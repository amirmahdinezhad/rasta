// Real font decoding/rendering and persistence on owned pages only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { fontPaths, fontPreferences, importFont, selectFont } from '../bin/lib/font-preferences.js';
import { buildCodexPayload } from '../bin/lib/codex.js';

if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw new Error('Provide ARTL_PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-font-browser-'));
fs.mkdirSync(path.resolve('dist/design-preview'), { recursive: true });
const payload = buildCodexPayload();
const font = fs.readFileSync(new URL('../bin/assets/Vazir-Bold.ttf', import.meta.url));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:">
<style>body{font-family:Arial}aside span,button,input{font-family:Arial}pre,code,.font-mono,.xterm{font-family:monospace}.codicon{font-family:TestIcons}</style></head><body>
<aside><span id="sidebar">گفتگوها</span></aside><button id="host-button">Settings</button><input id="host-input" value="جستجو">
<div data-markdown-text-style><p id="message">سلام، متن فارسی و English text</p><pre><code id="code"><span id="code-span">let x = 1;</span></code></pre><p><code id="inline-code">inline</code></p></div>
<div class="font-mono"><span id="mono">diff text</span></div><div class="xterm"><span id="terminal">terminal output</span></div><span class="codicon" id="icon">X</span>
<script src="/bridge.js"></script><script src="/payload.js"></script></body></html>`;
const root = path.resolve('bin');
let reading = { isRTL: true, forceRTL: false, fixAtSign: false, fs: '14', lh: '1.6' };
const paths = fontPaths(directory), preferences = () => ({ ...fontPreferences(paths), reading });
const server = http.createServer((request, response) => {
    if (request.url.startsWith('/manager/') || request.url.startsWith('/assets/')) {
        const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
        response.setHeader('Content-Type', ({ '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'text/html; charset=utf-8'); response.end(fs.readFileSync(file)); return;
    }
    response.setHeader('Content-Type', request.url.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/payload.js' ? payload : request.url === '/bridge.js' ? `window.rastaNative={preferences:()=>window.fontRPC(),status:async()=>({}),check:async()=>({})};` : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE });
try {
    const context = await browser.newContext({ viewport: { width: 940, height: 900 } });
    await context.exposeBinding('fontRPC', () => preferences());
    await context.exposeBinding('managerRPC', (_source, request) => {
        if (request.action === 'status') return { version: '1.1.27', apps: [{ id: 'codex', name: 'Codex', app: '/fixture/Codex.app', installed: true, hostVersion: '26.1103.41825', version: '1.1.27' }] };
        if (request.action === 'preferences') return preferences();
        if (request.action === 'font-import') importFont(request.input, paths);
        if (request.action === 'font-select') selectFont(request.input.id, paths);
        if (request.action === 'reading-save') reading = { ...reading, ...request.input };
        return preferences();
    });
    await context.addInitScript(() => { window.rastaPreview = input => window.managerRPC(input); });
    const manager = await context.newPage(), page = await context.newPage(), errors = [];
    for (const tab of [manager, page]) tab.on('pageerror', error => errors.push(error.message));
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await manager.goto(url + '/manager/index.html'); await manager.locator('#tab-codex').click(); await page.goto(url + '/host');
    await manager.getByRole('combobox', { name: 'Font', exact: true }).waitFor();
    assert.equal(await page.locator('#artl-font-add,#artl-app-font,input[type=file]').count(), 0);
    const untouched = ['#code', '#code-span', '#inline-code', '#mono', '#terminal', '#icon'];
    const original = await Promise.all(untouched.map(selector => page.locator(selector).evaluate(el => getComputedStyle(el).fontFamily)));
    const [chooser] = await Promise.all([manager.waitForEvent('filechooser'), manager.getByRole('button', { name: 'Add font', exact: true }).click()]);
    await chooser.setFiles({ name: 'MyFont.ttf', mimeType: 'font/ttf', buffer: font });
    await manager.waitForFunction(() => document.getElementById('font-family').selectedOptions[0].textContent === 'Vazir Bold');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('sidebar')).fontFamily.includes('RastaUser_'));
    const custom = await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily);
    assert.match(await manager.locator('#reading-sample').evaluate(el => getComputedStyle(el).fontFamily), /Preview_/);
    for (const selector of ['#host-button', '#host-input', '#message']) assert.match(await page.locator(selector).evaluate(el => getComputedStyle(el).fontFamily), /RastaUser_/);
    assert.deepEqual(await Promise.all(untouched.map(selector => page.locator(selector).evaluate(el => getComputedStyle(el).fontFamily))), original);
    const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument'), { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#sidebar' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some(face => face.isCustomFont && /Vazir/.test(face.familyName) && face.glyphCount > 0));
    await manager.getByRole('switch', { name: 'Enable right-to-left reading', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('artl-app-font-style'));
    assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
    await page.reload(); await page.waitForSelector('.artl-widget-container', { state: 'attached' });
    assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
    await manager.getByRole('switch', { name: 'Enable right-to-left reading', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('sidebar')).fontFamily.includes('RastaUser_'));
    assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), custom);
    await manager.locator('#font-file').setInputFiles({ name: 'Broken.ttf', mimeType: 'font/ttf', buffer: Buffer.from('broken') });
    await manager.getByText('Choose a valid TTF or OTF font (up to 2 MB).', { exact: true }).waitFor();
    assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), custom, 'invalid import preserves the selected face');
    await manager.getByRole('combobox', { name: 'Font', exact: true }).selectOption('vazir');
    await page.waitForFunction(() => !getComputedStyle(document.getElementById('sidebar')).fontFamily.includes('RastaUser_'));
    await manager.screenshot({ path: path.resolve('dist/design-preview/font-manager.png') });
    await page.evaluate(() => window.__rastaPro.dispose());
    assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
    assert.deepEqual(errors, []); await context.close();
    console.log('PASS: real manager file chooser and font preview, read-only host catalog, actual custom glyphs, code/icon isolation, reload, RTL off/on, reset and invalid-file preservation.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
