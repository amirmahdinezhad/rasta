// Exercise minified, file-ready UI assets without creating an app package.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw Error('Provide ARTL_PLAYWRIGHT_MODULE.');
const engines = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
execFileSync('npm', ['--prefix', 'ui/manager', 'run', 'build', '--', '--mode', 'native'], { stdio: 'pipe' });
const root = path.resolve('dist/manager-ui');
const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + (request.url === '/' ? '/index.html' : request.url));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.png') ? 'image/png' : 'font/woff2');
    const bytes = fs.readFileSync(file);
    response.end(file.endsWith('.html') ? bytes.toString().replace('<script type="module" crossorigin', '<script defer') : bytes);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
    for (const engine of ['chromium', 'webkit']) {
        const browser = await engines[engine].launch({ headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 940, height: 780 } });
            const errors = []; page.on('pageerror', e => errors.push(e.message));
            await page.addInitScript(() => {
                window.fixtureOperation = { phase: 'downloading-agent', progress: .1 };
                window.rastaPreview = async request => request.action === 'preferences'
                    ? { selected: 'vazir', active: null, fonts: [], reading: { fs: '14', lh: '1.6', isRTL: true, forceRTL: false, fixAtSign: true } }
                    : { version: '1.0.5', apps: [{ id: 'codex', app: '/Fixture/Codex.app', hostVersion: '26.1103.60933', installed: true, version: '1.0.5', operation: window.fixtureOperation }] };
            });
            await page.goto(`http://127.0.0.1:${server.address().port}/`);
            await page.getByRole('tab', { name: /^Rasta installed/ }).click();
            const marker = page.locator('[data-slot=tabs-indicator]');
            const duration = await marker.evaluate(el => el.getAnimations()[0]?.effect.getTiming().duration);
            assert.equal(duration, 220, `${engine}: CSS seconds are converted to milliseconds in production`);
            await page.evaluate(() => window.rastaOpenConnection('codex', 'reading'));
            await page.getByRole('tab', { name: 'Reading', exact: true, selected: true }).waitFor();
            await page.getByRole('tab', { name: 'Installation', exact: true }).click();
            const download = page.getByRole('button', { name: 'Downloading…', exact: true });
            await download.waitFor();
            assert.equal(await download.getAttribute('aria-busy'), 'true');
            assert.equal(await download.isDisabled(), true);
            await page.emulateMedia({ reducedMotion: 'reduce' });
            assert.equal(await download.locator('svg').evaluate(el => getComputedStyle(el).animationName), 'none');
            const stages = page.getByRole('list', { name: 'Installation stages' });
            const status = page.getByRole('region', { name: 'Installation status' });
            const hostVersion = status.getByText('Codex version 26.1103.60933', { exact: true });
            for (const width of [940, 390]) {
                await page.setViewportSize({ width, height: 780 });
                let layout;
                const stageGlyphs = new Set();
                let activityGlyph;
                for (const [phase, heading, step] of [
                    ['downloading-agent', 'Downloading Rasta for Codex', 'Package'],
                    ['verifying', 'Verifying the Rasta package', 'Verify'],
                    ['ready-to-install', 'Ready to install — choose Launch', 'Prepare'],
                    ['waiting-for-quit', 'Waiting for Codex', 'Install'],
                    ['reopening', 'Checking Rasta in Codex', 'Install'],
                    ['complete', 'Rasta is installed in Codex', null],
                ]) {
                    await page.evaluate(phase => { window.fixtureOperation = { phase, progress: 1 }; }, phase);
                    await status.getByRole('heading', { name: heading, exact: true }).waitFor();
                    assert.equal(await stages.getByRole('listitem').count(), 4);
                    assert.equal(await status.getByRole('progressbar').count(), 0);
                    if (step) assert.match(await stages.locator('[aria-current=step]').innerText(), new RegExp(step));
                    const activity = status.locator('button[aria-busy="true"] svg');
                    if (['downloading-agent', 'verifying', 'waiting-for-quit', 'reopening'].includes(phase)) {
                        const glyph = await activity.evaluate(svg => svg.innerHTML);
                        activityGlyph ??= glyph;
                        assert.equal(glyph, activityGlyph, `${phase} uses the shared activity spinner`);
                        if (phase === 'downloading-agent' || phase === 'verifying') {
                            const stageGlyph = await stages.locator('[aria-current=step] svg').evaluate(svg => svg.innerHTML);
                            assert.notEqual(stageGlyph, glyph, `${phase} keeps its semantic step icon`);
                            assert.equal(stageGlyphs.has(stageGlyph), false, `${phase} has a distinct step icon`);
                            stageGlyphs.add(stageGlyph);
                        }
                    }
                    if (phase === 'waiting-for-quit') {
                        const waiting = status.getByRole('button', { name: 'Waiting for Codex to close…', exact: true });
                        assert.equal(await waiting.isDisabled(), true);
                        assert.equal(await waiting.getAttribute('aria-busy'), 'true');
                        assert.equal(await waiting.locator('svg').count(), 1);
                    }
                    if (phase === 'reopening') {
                        assert.equal(await status.getByText('Waiting for Codex to confirm that Rasta reading support has started.').count(), 1);
                    }
                    const bounds = await Promise.all([stages, status, hostVersion].map(locator => locator.boundingBox()));
                    layout ??= bounds;
                    assert.deepEqual(bounds, layout, `${engine} ${width}px: stepper, status and version stay in place during ${phase}`);
                }
            }
            assert.deepEqual(errors, []);
            console.log(`PASS: ${engine} compiled tabs (220ms), loading action, reduced motion and installation status.`);
        } finally { await browser.close(); }
    }
} finally { await new Promise(resolve => server.close(resolve)); }
