import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw Error('Provide ARTL_PLAYWRIGHT_MODULE and start npm run preview:manager.');
const engines = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);

for (const engine of ['chromium', 'webkit']) {
    const browser = await engines[engine].launch({ headless: true });
    try {
        const page = await browser.newPage({ reducedMotion: 'reduce' });
        await page.addInitScript(() => {
            let preview;
            const job = 't3-approved-install';
            const t3 = { id: 't3', name: 'T3 Code', app: '/Applications/T3 Code (Beta).app', hostVersion: '0.1.11',
                installed: false, operation: { id: job, action: 'repair', phase: 'ready-to-install', progress: 1 } };
            window.installFixture = t3;
            Object.defineProperty(window, 'rastaPreview', {
                get: () => preview && (async request => {
                    if (request.action === 'status') {
                        const state = await preview(request);
                        return { ...state, apps: state.apps.map(app => app.id === 't3' ? structuredClone(t3) : app) };
                    }
                    if (request.action === 'launch' && request.target === 't3') {
                        if (request.job !== job) throw Error('Wrong prepared job.');
                        return new Promise((_, reject) => { window.rejectLaunch = () => reject(Error('Rasta could not complete this operation. Please try again.')); });
                    }
                    return preview(request);
                }),
                set: implementation => { preview = implementation; },
            });
        });
        await page.goto(process.env.RASTA_MANAGER_URL || 'http://127.0.0.1:5173/');
        await page.getByRole('button', { name: 'Open T3 Code settings', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'T3 Code', exact: true });
        await dialog.getByRole('button', { name: 'Simulate Launch', exact: true }).click();
        await page.waitForFunction(() => window.rejectLaunch);
        await dialog.getByRole('heading', { name: 'Checking installation for T3 Code', exact: true }).waitFor();
        await page.evaluate(() => { window.rejectLaunch(); window.rejectLaunch = undefined; });
        await dialog.getByRole('heading', { name: 'Couldn’t launch T3 Code', exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Retry Launch', exact: true }).click();
        await page.waitForFunction(() => window.rejectLaunch);
        await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            window.prepareAppeared = false;
            new MutationObserver(() => {
                window.prepareAppeared ||= [...dialog.querySelectorAll('button')].some(button => button.textContent.trim() === 'Prepare Rasta');
            }).observe(dialog, { subtree: true, childList: true, characterData: true });
            window.installFixture.operation.phase = 'reopening';
            window.rejectLaunch();
        });
        await dialog.getByRole('heading', { name: 'Checking Rasta in T3 Code', exact: true }).waitFor({ timeout: 3000 });
        await dialog.getByText('Checking startup', { exact: true }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: 'Prepare Rasta', exact: true }).count(), 0);

        await page.evaluate(() => {
            window.installFixture.installed = true;
            window.installFixture.version = '1.1.57';
            window.installFixture.operation.phase = 'complete';
        });
        await dialog.getByRole('heading', { name: 'Rasta is installed in T3 Code', exact: true }).waitFor({ timeout: 3000 });
        assert.equal(await page.evaluate(() => window.prepareAppeared), false, 'an approved launch never flashes a Prepare retry');
        assert.equal(await page.getByText('Couldn’t install Rasta for T3 Code', { exact: true }).count(), 0);
        await dialog.getByRole('tab', { name: 'Reading', exact: true }).click();
        await dialog.getByRole('button', { name: 'Font', exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();

        await page.getByRole('button', { name: 'Open Claude settings', exact: true }).click();
        const claude = page.getByRole('dialog', { name: 'Claude', exact: true });
        await claude.getByRole('heading', { name: 'Install Rasta for Claude', exact: true }).waitFor();
        await claude.getByRole('button', { name: 'Install Rasta for Claude', exact: true }).click();
        await claude.getByRole('heading', { name: 'Finding Rasta for Claude', exact: true }).waitFor();
        await claude.getByRole('button', { name: 'Simulate Launch', exact: true }).waitFor();
        assert.equal(await claude.getByText('Action needed', { exact: true }).count(), 0);
        console.log(`PASS: ${engine} starts a fresh Claude preparation and follows the approved T3 job through reopening and completion.`);
    } finally {
        await browser.close();
    }
}
