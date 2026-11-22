import { installReadingBridge, setReading } from './helpers/browser-reading.js';
// T3 presentation fixture with CSS from the selected T3 bundle; no live
// conversations, servers or account state are opened by this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { resolveT3App } from '../bin/lib/t3.js';
import { buildCodexPayload } from '../bin/lib/codex.js';
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const folder = path.resolve('dist/design-preview/t3');
fs.mkdirSync(folder, { recursive: true });
const archive = process.env.ARTL_T3_ASAR || resolveT3App()?.archive;
if (!archive || !fs.existsSync(archive)) throw new Error('Install T3 Code or provide ARTL_T3_ASAR.');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const client = 'apps/server/dist/client';
const css = asar.listPackage(archive).find(name => new RegExp('^/' + client + '/assets/main-[^/]+\\.css$').test(name));
assert.ok(css, 'real T3 stylesheet');
const payload = buildCodexPayload(undefined, { target: 't3' });
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/t3.css"></head><body><main><button id="host">T3 action</button><div class="messages-timeline-scroll"><div data-timeline-row-kind="message" data-message-role="assistant" data-message-id="fixture"><div class="chat-markdown"><p>سلام T3</p></div></div></div><div class="composer-tiptap"><div class="ProseMirror" contenteditable="true"><p>سلام</p></div></div></main><script src="/payload.js"></script></body></html>`;
const server = http.createServer((req, res) => {
    const isCSS = req.url === '/t3.css', isJS = req.url === '/payload.js';
    res.setHeader('Content-Type', isCSS ? 'text/css' : isJS ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(isCSS ? asar.extractFile(archive, css.slice(1)) : isJS ? payload : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE });
try {
    for (const theme of ['Light', 'Dark']) {
        const context = await browser.newContext({ viewport: { width: 760, height: 1000 }, reducedMotion: 'reduce', colorScheme: theme.toLowerCase() });
        await installReadingBridge(context); const page = await context.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator('[data-message-id="fixture"]').evaluate(row => {
            const english = document.createElement('p');
            english.id = 'english-reply'; english.textContent = 'An English assistant reply.';
            const code = document.createElement('pre');
            code.id = 'code-reply'; code.textContent = 'const answer = 42;';
            row.append(english, code);
        });
        await page.waitForFunction(() => document.querySelector('#english-reply').getAttribute('dir') === 'ltr');
        for (const selector of ['.chat-markdown p', '.ProseMirror p']) {
            assert.equal(await page.locator(selector).getAttribute('dir'), 'rtl');
            assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).direction), 'rtl');
        }
        assert.equal(await page.locator('#code-reply').getAttribute('dir'), null);
        assert.equal(await page.locator('#host').getAttribute('dir'), null);
            await setReading(page, { forceRTL: true });
        assert.equal(await page.locator('#english-reply').getAttribute('dir'), 'rtl');
        assert.equal(await page.locator('#code-reply').getAttribute('dir'), null);
        assert.equal(await page.locator('#host').getAttribute('dir'), null);
        await setReading(page, { forceRTL: false });
        assert.equal(await page.locator('#english-reply').getAttribute('dir'), 'ltr');
        await setReading(page, { isRTL: false });
        for (const selector of ['.chat-markdown p', '.ProseMirror p', '#english-reply']) {
            assert.equal(await page.locator(selector).getAttribute('dir'), null);
        }
        await setReading(page, { isRTL: true });
        assert.equal(await page.locator('.ProseMirror p').getAttribute('dir'), 'rtl');
        assert.equal(await page.locator('.artl-widget-panel,.artl-version,.artl-accent-swatch,#artl-font-add').count(), 0);
        assert.equal(await page.locator('.artl-widget-trigger').isVisible(), false);
        await setReading(page, { fs: '18' }); await page.reload();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.chat-markdown p')).fontSize === '18px');
        await page.screenshot({ path: path.join(folder, 'reading-' + theme.toLowerCase() + '.png') });
        assert.deepEqual(errors, []); await context.close();
    }
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        const id = 'a'.repeat(32);
        const defaultFont = { selected: 'vazir', fonts: [], active: null };
        let saved = defaultFont;
        window.rastaNative = {
            status: async () => ({}), check: async () => ({}),
            saveReading: async () => ({}),
            preferences: () => new Promise(resolve => {
                const snapshot = saved;
                window.finishPreferences = () => resolve(snapshot);
            }),
            importFont: async (_name, data) => (saved = {
                selected: id, fonts: [{ id, label: 'Imported font' }], active: { id, data },
            }),
            selectFont: async () => (saved = { ...defaultFont, fonts: saved.fonts }),
        };
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.finishPreferences === 'function');
    await page.getByRole('button', { name: 'Open Rasta panel' }).click();
    await page.getByRole('button', { name: 'Typography' }).click();
    await page.getByRole('button', { name: 'Font', exact: true }).click();
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('menuitem', { name: 'Add font', exact: true }).click(),
    ]);
    const font = fs.readFileSync(new URL('../bin/assets/Vazir-Bold.ttf', import.meta.url));
    await chooser.setFiles({
        name: 'Custom.ttf', mimeType: 'font/ttf', buffer: font,
    });
    await page.getByRole('button', { name: 'Font', exact: true }).getByText('Imported font').waitFor();
    for (const selector of ['.chat-markdown p', '.ProseMirror p']) {
        assert.match(await page.locator(selector).evaluate(el => getComputedStyle(el).fontFamily), /RastaUser_/);
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.chat-markdown p' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some(face => face.isCustomFont && face.postScriptName === 'Vazir-Bold' && face.glyphCount > 0));
    await page.evaluate(() => window.finishPreferences());
    assert.match(await page.locator('.chat-markdown p').evaluate(el => getComputedStyle(el).fontFamily), /RastaUser_/);
    await page.getByRole('button', { name: 'Font', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Vazir', exact: true }).click();
    await page.getByRole('button', { name: 'Font', exact: true }).getByText('Vazir', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('.chat-markdown p').evaluate(el => getComputedStyle(el).fontFamily), /RastaUser_/);
    await context.close();
    console.log('PASS: real T3 CSS, mixed-language replies, RTL composer, code isolation, preferences and live custom glyphs during a pending settings read.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
