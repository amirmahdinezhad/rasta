import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const root = path.resolve('bin');
const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(file), mime = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', mime[ext] || 'text/html; charset=utf-8'); res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const output = path.resolve('dist/manager-preview'); fs.mkdirSync(output, { recursive: true });
try {
    for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ colorScheme, viewport: { width: 940, height: 790 } });
        await context.addInitScript(() => {
            window.calls = [];
            window.apps = [{ id: 'codex', name: 'Codex', app: '/Applications/Codex.app', hostVersion: '26.1103.41825', installed: true, version: '1.1.25' }, { id: 't3', name: 'T3 Code', app: '/Applications/T3.app', hostVersion: '0.1.7', installed: false, cachedVersion: null }];
            window.apps.push({ id: 'antigravity', name: 'Antigravity', app: '/Applications/Antigravity.app', hostVersion: '2.29.1', installed: false }, { id: 'gemini', name: 'Gemini', app: '/Applications/Gemini.app', hostVersion: '1.138.0.1315', installed: false, available: false });
            window.apps.push(...['claude', 'opencode', 'zcode'].map(id => ({ id, name: ({claude:'Claude',opencode:'OpenCode',zcode:'ZCode'})[id], app: '/Applications/' + id + '.app', hostVersion: '1.0.0', installed: false })));
            window.prefs = Object.fromEntries(['codex', 't3', 'antigravity', 'claude', 'opencode', 'zcode'].map(id => [id, { selected: 'vazir', fonts: [], active: null, reading: { fs: '14', lh: '1.6', isRTL: true, forceRTL: false, fixAtSign: false } }]));
            window.rastaPreview = async input => {
                window.calls.push(input); const app = window.apps.find(app => app.id === input.target);
                if (input.action === 'status') return structuredClone({ version: '1.1.26', apps: window.apps });
                if (input.action === 'preferences') return structuredClone(window.prefs[input.target]);
                if (input.action === 'reading-save') { Object.assign(window.prefs[input.target].reading, input.input); return structuredClone(window.prefs[input.target]); }
                if (input.action === 'check') { await new Promise(resolve => setTimeout(resolve, 900)); return { version: '1.1.26' }; }
                if (input.action === 'download') {
                    app.download = { phase: 'downloading', downloaded: 5 * 1048576, total: 20 * 1048576, progress: .25 };
                    await new Promise(resolve => setTimeout(resolve, 1400)); app.cachedVersion = '1.1.26'; app.download = { phase: 'downloaded', progress: 1 }; return { version: '1.1.26' };
                }
                if (input.action === 'install' || input.action === 'repair') { app.operation = { id: 'fixture-job', phase: 'ready-to-install', progress: 1 }; return { id: 'fixture-job', inline: true }; }
                if (input.action === 'launch') { app.installed = true; app.version = '1.1.26'; app.operation = { id: input.job, phase: 'complete', progress: 1 }; return { id: input.job }; }
                if (input.action === 'remove') { app.operation = { id: 'removed-job', phase: 'installing', action: 'restore', progress: 1 }; setTimeout(() => { app.installed = false; app.version = null; app.operation = { id: 'removed-job', phase: 'complete', progress: 1, restored: true }; }, 1500); return { id: 'removed-job' }; }
                if (input.action === 'cancel') { app.operation = { id: input.job, phase: 'cancelled', progress: 0 }; return { id: input.job }; }
                return {};
            };
        });
        const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/manager/index.html`);
        await page.locator('#tab-codex').waitFor();
        await page.waitForFunction(() => window.rastaLoaded);
        await page.getByRole('button', { name: 'Rasta settings', exact: true }).click();
        assert.equal(await page.locator('#settings-view').isVisible(), true);
        await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
        assert.equal(await page.locator('#apps-view').isVisible(), true);
        await page.getByRole('button', { name: 'Rasta settings', exact: true }).click();
        await page.getByRole('button', { name: 'Rasta connections', exact: true }).click();
        assert.equal(await page.locator('#apps-view').isVisible(), true);
        await page.screenshot({ path: path.join(output, colorScheme + '-overview.png') });
        const cardWidth = await page.locator('#card-codex').evaluate(el => el.getBoundingClientRect().width);
        await page.locator('#tab-codex').click();
        assert.equal(await page.locator('#detail').evaluate(el => el.parentElement.id), 'app-list', 'Library details occupy their own grid row');
        assert.equal(await page.locator('#card-codex').evaluate(el => el.getBoundingClientRect().width), cardWidth, 'opening preferences preserves card width');
        await page.getByRole('button', { name: 'Close preferences', exact: true }).click();
        assert.equal(await page.locator('#detail').isVisible(), false);
        assert.equal(await page.locator('#tab-codex').evaluate(el => document.activeElement === el), true);
        await page.locator('#tab-codex').click();
        for (const name of ['Codex connection', 'T3 Code connection']) { const control = page.getByRole('switch', { name, exact: true }); const background = await control.evaluate(el => getComputedStyle(el).backgroundColor); await control.hover(); assert.equal(await control.evaluate(el => getComputedStyle(el).backgroundColor), background, 'hover preserves switch state'); }
        await page.mouse.move(0, 0);
        await page.getByRole('combobox', { name: 'Font', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Repair connection', exact: true }).isVisible(), false);
        await page.locator('.connection-info summary').click();
        assert.equal(await page.getByRole('button', { name: 'Repair connection', exact: true }).isVisible(), true);
        await page.locator('.connection-info summary').click();
        assert.equal(await page.getByRole('heading', { name: 'Private testing' }).count(), 0);
        assert.equal(await page.locator('aside').count(), 0);
        assert.equal(await page.getByRole('switch', { name: 'Codex connection', exact: true }).getAttribute('aria-checked'), 'true');
        assert.equal(await page.getByRole('switch', { name: 'T3 Code connection', exact: true }).getAttribute('aria-checked'), 'false');
        assert.equal(await page.locator('.provider-card').count(), 8);
        assert.equal(await page.locator('.provider-open').locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
        await page.getByRole('combobox', { name: 'Text size' }).focus();
        await page.getByRole('combobox', { name: 'Text size' }).selectOption('18');
        await page.waitForFunction(() => document.activeElement?.id === 'text-size' && !document.getElementById('text-size').disabled);
        const statusCalls = await page.evaluate(() => window.calls.filter(call => call.action === 'status').length);
        await page.waitForFunction(before => window.calls.filter(call => call.action === 'status').length > before, statusCalls);
        assert.equal(await page.locator('#text-size').evaluate(el => document.activeElement === el), true, 'status polling preserves focus in the expanded card');
        assert.equal(await page.locator('#reading-sample').evaluate(el => getComputedStyle(el).fontSize), '18px');
        assert.equal(await page.evaluate(() => window.prefs.t3.reading.fs), '14', 'typography stays target-specific');
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(output, colorScheme + '.png'), fullPage: true });
        await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
        assert.equal(await page.locator('#refresh').getAttribute('aria-busy'), 'true');
        assert.equal(await page.locator('#refresh svg').evaluate(el => getComputedStyle(el).animationName), 'refresh-spin');
        await page.getByRole('button', { name: 'Update connection' }).waitFor();
        await page.locator('#tab-t3').click();
        await page.getByRole('switch', { name: 'T3 Code connection', exact: true }).click();
        await page.getByText('25% · 5.0 / 20.0 MB', { exact: true }).waitFor();
        assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '25');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(output, colorScheme + '-download.png'), fullPage: true });
        await page.getByRole('button', { name: 'Launch', exact: true }).waitFor();
        assert.equal(await page.locator('.connection-steps [aria-current=step]').innerText(), 'Prepare');
        assert.equal(await page.locator('#operation').getByText('Ready to install', { exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => window.calls.some(call => call.action === 'launch')), false, 'preparation never approves installation');
        await page.getByRole('button', { name: 'Cancel installation' }).click();
        await page.getByText('Cancelled', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.apps.find(app => app.id === 't3').installed), false);
        await page.getByRole('button', { name: 'Install connection', exact: true }).click();
        await page.getByRole('button', { name: 'Launch', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Launch', exact: true }).click();
        await page.getByRole('combobox', { name: 'Font', exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.calls.filter(call => ['download', 'install', 'cancel', 'launch'].includes(call.action)).map(call => [call.action, call.target])), [['download', 't3'], ['install', 't3'], ['cancel', 't3'], ['install', 't3'], ['launch', 't3']]);
        assert.equal(await page.getByRole('switch', { name: 'T3 Code connection', exact: true }).getAttribute('aria-checked'), 'true');
        await page.getByRole('switch', { name: 'T3 Code connection', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await page.evaluate(() => window.calls.some(call => call.action === 'remove')), false);
        await page.getByRole('button', { name: 'Remove T3 Code connection', exact: true }).click();
        await page.locator('#confirm-ok').click();
        await page.getByText('Restoring original app', { exact: true }).waitFor();
        await page.waitForFunction(() => !window.apps.find(app => app.id === 't3').installed && document.querySelector('#card-t3 [role=switch]').getAttribute('aria-checked') === 'false');
        assert.equal(await page.getByRole('switch', { name: 'Codex connection', exact: true }).getAttribute('aria-checked'), 'true');
        assert.equal(await page.getByRole('button', { name: 'Remove T3 Code connection', exact: true }).isVisible(), false);
        await page.locator('#tab-gemini').click();
        await page.getByRole('heading', { name: 'Gemini connection is not available yet' }).waitFor();
        assert.equal(await page.locator('#detail button').count(), 0);
        assert.equal(await page.getByRole('switch', { name: 'Gemini connection', exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => window.calls.some(call => call.target === 'gemini')), false, 'unavailable native targets never request a feed or worker');
        await page.locator('#tab-antigravity').click();
        await page.getByRole('switch', { name: 'Antigravity connection', exact: true }).click();
        await page.getByRole('button', { name: 'Launch', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.apps.find(app => app.id === 'antigravity').installed), false);
        await page.getByRole('button', { name: 'Launch', exact: true }).click();
        await page.getByRole('combobox', { name: 'Font', exact: true }).waitFor();
        assert.equal(await page.getByRole('switch', { name: 'Antigravity connection', exact: true }).getAttribute('aria-checked'), 'true');
        await page.getByRole('combobox', { name: 'Text size' }).selectOption('16');
        await page.waitForFunction(() => window.prefs.antigravity.reading.fs === '16');
        assert.equal(await page.evaluate(() => window.prefs.codex.reading.fs), '18');
        assert.equal(await page.evaluate(() => window.prefs.t3.reading.fs), '14');
        for (const [id, name] of [['claude', 'Claude'], ['opencode', 'OpenCode'], ['zcode', 'ZCode']]) {
            await page.locator(`#tab-${id}`).click();
            await page.getByRole('switch', { name: `${name} connection`, exact: true }).click();
            await page.getByRole('button', { name: 'Launch', exact: true }).waitFor();
            assert.equal(await page.evaluate(id => window.apps.find(app => app.id === id).installed, id), false);
            await page.getByRole('button', { name: 'Launch', exact: true }).click();
            await page.getByRole('combobox', { name: 'Font', exact: true }).waitFor();
            await page.getByRole('combobox', { name: 'Text size' }).selectOption('16');
            await page.waitForFunction(id => window.prefs[id].reading.fs === '16', id);
            assert.equal(await page.evaluate(() => window.prefs.codex.reading.fs), '18');
            await page.getByRole('button', { name: `Remove ${name} connection`, exact: true }).click();
            await page.locator('#confirm-ok').click();
            await page.waitForFunction(id => !window.apps.find(app => app.id === id).installed, id);
        }
        await page.locator('#tab-claude').press('Home');
        assert.equal(await page.locator('#tab-codex').evaluate(el => document.activeElement === el), true);
        await page.locator('#tab-codex').press('Enter');
        assert.equal(await page.locator('#tab-codex').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#detail').evaluate(el => el.getAnimations().length), 0, 'the first keyboard selection after a pointer click has no content animation');
        await page.setViewportSize({ width: 390, height: 720 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(output, colorScheme + '-narrow.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.locator('#tab-t3').click();
        assert.equal(await page.locator('#tab-t3').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#detail').evaluate(el => el.getAnimations().length), 0);
        await page.getByRole('button', { name: 'Rasta settings', exact: true }).click();
        await page.evaluate(() => window.rastaOpenConnection('codex'));
        assert.equal(await page.locator('#apps-view').isVisible(), true);
        assert.equal(await page.locator('#tab-codex').getAttribute('aria-expanded'), 'true');
        assert.deepEqual(errors, []); await context.close();
    }
    console.log('PASS: provider card toggles, confirmed target-only removal, header settings, real manager surface, light/dark, app logos, Claude/OpenCode/ZCode connections, target-only preferences, refresh feedback, byte progress, inline preparation and explicit Launch, cancellation, keyboard and reduced motion.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
