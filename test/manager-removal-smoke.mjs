import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw Error('Provide ARTL_PLAYWRIGHT_MODULE and start npm run preview:manager.');
const { chromium, webkit } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const url = process.env.RASTA_MANAGER_URL || 'http://127.0.0.1:5173/';

for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
        const page = await browser.newPage({ reducedMotion: 'reduce', colorScheme: engine.name() === 'webkit' ? 'dark' : 'light' });
        page.setDefaultTimeout(10000);
        await page.addInitScript(() => {
            // Headless WebKit may report the test page as backgrounded.
            Object.defineProperty(document, 'hidden', { get: () => false });
        });
        const localTest = new URL(url);
        localTest.searchParams.set('preview', 'local-test');
        await page.goto(localTest.href);
        const card = id => page.locator(`#card-${id}`);
        const assertRemoving = async (id, name) => {
            await card(id).getByRole('status').getByText('Removing Rasta', { exact: true }).waitFor();
            await card(id).getByText('View removal', { exact: true }).waitFor();
            assert.equal(await card(id).getByRole('button', { name: `Remove Rasta from ${name}` }).isDisabled(), true);
        };
        const assertFresh = async (id, name) => {
            await card(id).getByText('Install Rasta', { exact: true }).waitFor();
            await card(id).getByRole('button', { name: `Open ${name} settings` }).click();
            const dialog = page.getByRole('dialog', { name, exact: true });
            await dialog.getByRole('button', { name: `Install Rasta for ${name}`, exact: true }).waitFor();
            assert.equal(await dialog.getByRole('button', { name: 'Simulate Launch', exact: true }).count(), 0);
            await dialog.getByRole('button', { name: 'Close', exact: true }).click();
            const state = await page.evaluate(() => window.rastaPreview({ action: 'status' }));
            const app = state.apps.find(item => item.id === id);
            assert.equal(app.cachedVersion, undefined);
            assert.deepEqual(state.preferences[id].reading, { fs: '16', lh: '1.6', isRTL: true, forceRTL: false, fixAtSign: false });
        };
        const prepare = async (id, name) => {
            await card(id).getByRole('button', { name: `Open ${name} settings` }).click();
            const dialog = page.getByRole('dialog', { name, exact: true });
            await dialog.getByRole('button', { name: `Install Rasta for ${name}`, exact: true }).click();
            await dialog.getByRole('button', { name: 'Simulate Launch', exact: true }).waitFor();
            await dialog.getByRole('button', { name: 'Close', exact: true }).click();
            await card(id).getByText('Continue installation', { exact: true }).waitFor();
        };
        const remove = async (id, name) => {
            await page.evaluate(target => window.rastaPreview({ action: 'reading-save', target, input: { fs: '22' } }), id);
            const trigger = card(id).getByRole('button', { name: `Remove Rasta from ${name}` });
            const confirmation = page.getByRole('alertdialog');
            await trigger.click();
            await confirmation.getByRole('button', { name: 'Keep Rasta installed', exact: true }).click();
            await trigger.and(page.locator(':focus')).waitFor();
            await card(id).getByText('Continue installation', { exact: true }).waitFor();
            await trigger.click();
            await confirmation.getByRole('button', { name: 'Remove Rasta', exact: true }).click();
            await assertRemoving(id, name);
            await card(id).getByRole('button', { name: `Open ${name} settings` }).and(page.locator(':focus')).waitFor();
            await assertFresh(id, name);
        };

        const claudeStatus = card('claude').getByRole('status');
        await claudeStatus.getByText('Rasta installed', { exact: true }).waitFor();
        await claudeStatus.evaluate(status => {
            const history = [status.textContent.trim()];
            const observer = new MutationObserver(() => {
                const text = status.textContent.trim();
                if (history.at(-1) !== text) history.push(text);
            });
            observer.observe(status, { childList: true, characterData: true, subtree: true });
            window.readClaudeRemovalHistory = () => { observer.disconnect(); return history; };
        });
        await card('claude').getByRole('button', { name: 'Remove Rasta from Claude' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Remove Rasta', exact: true }).click();
        await assertRemoving('claude', 'Claude');
        await claudeStatus.getByText('Rasta not installed', { exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.readClaudeRemovalHistory()),
            ['Rasta installed', 'Removing Rasta', 'Rasta not installed']);

        await prepare('antigravity', 'Antigravity');
        await remove('antigravity', 'Antigravity');
        await card('codex').getByRole('button', { name: 'Remove Rasta from Codex' }).waitFor();
        await prepare('t3', 'T3 Code');
        await page.evaluate(() => {
            const preview = window.rastaPreview;
            const waitForCodex = new Promise(resolve => { window.resumeCodexRemoval = resolve; });
            const waitForT3 = new Promise(resolve => { window.resumeT3Removal = resolve; });
            window.rastaPreview = async request => {
                if (request.action === 'remove' && request.target === 'codex') await waitForCodex;
                if (request.action === 'remove' && request.target === 't3') await waitForT3;
                return preview(request);
            };
        });
        await page.getByRole('button', { name: 'Rasta settings', exact: true }).click();
        const settings = page.getByRole('dialog', { name: 'Rasta settings', exact: true });
        await settings.getByRole('button', { name: 'Review removal', exact: true }).click();
        const removal = page.getByRole('alertdialog');
        await removal.getByRole('list', { name: 'Removal by app' }).getByText('T3 Code', { exact: true }).waitFor();
        await removal.getByRole('button', { name: 'Simulate removing all connections' }).click();
        await removal.getByRole('heading', { name: 'Removing Rasta from apps', exact: true }).waitFor();
        await removal.getByRole('button', { name: 'Close', exact: true }).click();
        await settings.getByRole('button', { name: 'Close', exact: true }).click();
        await assertRemoving('codex', 'Codex');
        await card('t3').getByRole('status').getByText('Removal queued', { exact: true }).waitFor();
        assert.equal(await card('t3').getByRole('button', { name: 'Remove Rasta from T3 Code' }).isDisabled(), true);
        await card('t3').getByRole('button', { name: 'Open T3 Code settings' }).click();
        const queued = page.getByRole('dialog', { name: 'T3 Code', exact: true });
        await queued.getByRole('heading', { name: 'Removal queued', exact: true }).waitFor();
        await queued.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(() => window.resumeCodexRemoval());
        await assertRemoving('t3', 'T3 Code');
        await page.evaluate(() => window.resumeT3Removal());
        await page.waitForFunction(async () => (await window.rastaPreview({ action: 'status' })).removal?.phase === 'complete');
        await assertFresh('codex', 'Codex');
        await assertFresh('t3', 'T3 Code');
        await page.reload();
        await assertFresh('antigravity', 'Antigravity');
        await assertFresh('t3', 'T3 Code');
        console.log(`PASS: ${engine.name()} shows individual and bulk removal on the app cards and offers a fresh installation afterward.`);
    } finally {
        await browser.close();
    }
}
