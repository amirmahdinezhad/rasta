// Exercise the complete catalog at supported desktop sizes without touching host apps.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw Error('Provide ARTL_PLAYWRIGHT_MODULE and start npm run preview:manager.');
const engines = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
for (const engine of ['chromium', 'webkit']) {
    const browser = await engines[engine].launch({ headless: true });
    try {
        for (const colorScheme of ['light', 'dark']) {
            const page = await browser.newPage({ colorScheme, viewport: { width: 940, height: 780 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            // Exercise native titlebar spacing; all requests still use simulated fixtures.
            await page.goto(process.env.RASTA_MANAGER_URL || 'http://127.0.0.1:5173/');
            await page.waitForFunction(() => window.rastaPreviewControl);
            await page.evaluate(() => {
                window.webkit = { messageHandlers: { rasta: { postMessage() { throw Error('Unexpected native request.'); } } } };
                window.dispatchEvent(new Event('focus'));
            });
            await page.waitForFunction(() => getComputedStyle(document.querySelector('header')).paddingTop === '40px');
            await page.getByRole('button', { name: 'Open Grok Bot settings', exact: true }).waitFor();
            await page.locator('main').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
            assert.deepEqual(await page.locator('[id^=card-]').evaluateAll(cards => cards.map(card => card.id)), ['card-codex', 'card-claude', 'card-t3', 'card-antigravity', 'card-grokbot', 'card-gemini', 'card-opencode', 'card-zcode']);
            for (const width of [940, 720, 1040]) {
                await page.setViewportSize({ width, height: 780 });
                const bounds = await page.evaluate(() => ({
                    height: document.documentElement.scrollHeight,
                    width: document.documentElement.scrollWidth,
                    brand: document.querySelector('[aria-label="Rasta Library"]').getBoundingClientRect().left,
                    title: document.querySelector('h1').getBoundingClientRect().left,
                    card: document.querySelector('#card-codex').getBoundingClientRect().left,
                    last: document.querySelector('#card-grokbot').getBoundingClientRect().bottom,
                }));
                assert.equal(bounds.height, 780, `${engine}/${colorScheme}/${width}: no vertical page scroll`);
                assert.equal(bounds.width, width, 'no horizontal overflow');
                assert.equal(bounds.brand, bounds.title, 'brand and Library share an inset');
                assert.equal(bounds.brand, bounds.card, 'brand and cards share an inset');
                assert.ok(bounds.last <= 780, 'last row remains visible');
            }
            assert.equal(await page.locator('header [aria-label="Rasta version"]').innerText(), '1.1.37');
            assert.equal(await page.locator('header button').count(), 1);
            assert.equal(await page.locator('main > footer').count(), 0);
            assert.doesNotMatch(await page.locator('#card-codex').innerText(), /1\.1\.36/);
            assert.equal(await page.locator('#card-grokbot img').evaluate(img => img.complete && img.naturalWidth > 0), true);
            await page.getByRole('button', { name: 'Open Grok Bot settings', exact: true }).click();
            const support = page.getByRole('dialog', { name: 'Grok Bot', exact: true });
            await support.getByRole('heading', { name: 'Install Rasta for Grok Bot', exact: true }).waitFor();
            assert.equal(await support.getByRole('button', { name: /Install Rasta/ }).count(), 1);
            await support.getByRole('button', { name: 'Close', exact: true }).click();
            await page.getByRole('button', { name: 'Rasta settings', exact: true }).click();
            const settings = page.getByRole('dialog', { name: 'Rasta settings', exact: true });
            assert.equal(await settings.locator('[aria-label="Rasta version"]').count(), 0);
            await settings.getByRole('button', { name: 'Close', exact: true }).click();
            await page.getByRole('button', { name: 'UI preview · Simulated', exact: true }).click();
            await page.getByRole('dialog', { name: 'Preview tools', exact: true }).waitFor();
            assert.deepEqual(errors, []);
            await page.close();
        }
        console.log(`PASS: ${engine} full catalog fits 940/720/1040 × 780, aligned native header, header version, Grok Bot installation card and simulated preview controls in both themes.`);
    } finally { await browser.close(); }
}
