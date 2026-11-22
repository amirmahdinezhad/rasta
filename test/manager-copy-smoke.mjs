// Browser fixtures only. No installed app, signing key or release feed is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw Error('Provide ARTL_PLAYWRIGHT_MODULE and start npm run preview:manager.');
const engines = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const output = path.resolve('dist/shadcn-preview/copy');
fs.mkdirSync(output, { recursive: true });
const cases = [
    ['app-update', 'Update T3 Code first', 'Check again'],
    ['rasta-update', 'Rasta isn’t available for this T3 Code version yet', 'Check for Rasta update'],
    ['offline', 'Couldn’t check for a Rasta update for T3 Code', 'Check for Rasta update'],
    ['verification', 'The Rasta download could not be verified', 'Download Rasta'],
    ['disk-space', 'Not enough free disk space', 'Prepare Rasta'],
];
for (const engine of ['chromium', 'webkit']) {
    const browser = await engines[engine].launch({ headless: true });
    try {
        for (const theme of ['light', 'dark']) {
            const context = await browser.newContext({ viewport: { width: 1040, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
            const errors = [], external = [];
            context.on('page', page => {
                page.on('pageerror', error => errors.push(error.message));
                page.on('request', request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/) && !request.url().startsWith('data:')) external.push(request.url()); });
            });
            for (const [scenario, heading, action] of cases) {
                const page = await context.newPage();
                await page.goto(process.env.RASTA_MANAGER_URL || 'http://127.0.0.1:5173/');
                await page.waitForFunction(() => window.rastaPreviewControl);
                await page.evaluate(scenario => { window.rastaPreviewControl.setScenario(scenario); window.dispatchEvent(new Event('focus')); }, scenario);
                await page.getByRole('button', { name: 'Open T3 Code settings', exact: true }).click();
                const dialog = page.getByRole('dialog', { name: 'T3 Code', exact: true });
                await dialog.getByRole('heading', { name: heading, exact: true }).waitFor();
                assert.equal(await dialog.getByRole('button', { name: action, exact: true }).count(), 1);
                assert.equal(await dialog.getByRole('progressbar').count(), 0, 'blocked operations do not imply installation progress');
                assert.equal(await dialog.getByText('Let’s try that again.', { exact: true }).count(), 0);
                if (scenario === 'disk-space') {
                    await dialog.getByText('Free up space on your Mac, then choose Prepare Rasta again.', { exact: true }).waitFor();
                }
                if (scenario === 'app-update') assert.ok((await dialog.innerText()).includes('Update T3 Code to 0.1.8'));
                if (scenario === 'rasta-update') {
                    assert.ok((await dialog.innerText()).includes('The Rasta developer needs to release a compatible package.'));
                    await dialog.getByRole('button', { name: action, exact: true }).click();
                    await page.getByText('No Rasta update available for T3 Code.', { exact: true }).waitFor();
                    await dialog.getByRole('heading', { name: heading, exact: true }).waitFor();
                }
                if (scenario === 'offline') {
                    assert.ok(!(await dialog.innerText()).includes('needs to release a compatible package'));
                    await dialog.getByRole('button', { name: action, exact: true }).click();
                    await dialog.getByRole('heading', { name: heading, exact: true }).waitFor();
                }
                await page.screenshot({ path: path.join(output, `${engine}-${theme}-${scenario}.png`), fullPage: true });
                await page.setViewportSize({ width: 390, height: 480 });
                await dialog.getByRole('button', { name: action, exact: true }).scrollIntoViewIfNeeded();
                assert.ok(await dialog.getByRole('button', { name: action, exact: true }).isVisible());
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                if (scenario === 'disk-space') {
                    await dialog.getByRole('button', { name: action, exact: true }).click();
                    await dialog.getByRole('button', { name: 'Simulate Launch', exact: true }).waitFor();
                    const state = await page.evaluate(() => window.rastaPreview({ action: 'status' }));
                    assert.equal(state.apps.find(app => app.id === 't3').installed, false);
                }
                await page.close();
            }
            const page = await context.newPage();
            await page.goto(process.env.RASTA_MANAGER_URL || 'http://127.0.0.1:5173/');
            await page.waitForFunction(() => window.rastaPreviewControl);
            await page.evaluate(() => { window.rastaPreviewControl.setScenario('old-runtime'); window.dispatchEvent(new Event('focus')); });
            await page.getByRole('button', { name: 'Open T3 Code settings', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'T3 Code', exact: true });
            const status = dialog.getByRole('region', { name: 'Installation status', exact: true });
            assert.equal(await status.getByText(/Local compatibility checks passed/).count(), 0);
            assert.equal(await dialog.getByRole('alert').count(), 0, 'passing compatibility does not display an alert');
            assert.equal(await status.getByRole('button', { name: 'Install Rasta for T3 Code', exact: true }).count(), 1);
            assert.ok(!(await dialog.innerText()).includes('Installing Rasta changes only'));
            await dialog.getByRole('button', { name: 'Install Rasta for T3 Code', exact: true }).click();
            await dialog.getByRole('button', { name: 'Simulate Launch', exact: true }).waitFor();
            const state = await page.evaluate(() => window.rastaPreview({ action: 'status' }));
            const t3 = state.apps.find(app => app.id === 't3');
            assert.equal(t3.cachedVersion, '1.1.37', 'the obsolete package is replaced before preparation completes');
            assert.equal(t3.installed, false, 'preparation still waits for explicit Launch');
            assert.equal(await dialog.getByRole('progressbar').count(), 0);
            assert.equal(await status.getByRole('button', { name: 'Simulate Launch', exact: true }).count(), 1);
            await page.screenshot({ path: path.join(output, `${engine}-${theme}-ready.png`), fullPage: true });
            await dialog.getByRole('button', { name: 'Simulate Launch', exact: true }).click();
            await dialog.getByRole('heading', { name: 'Rasta is installed in T3 Code', exact: true }).waitFor();
            assert.equal(await dialog.getByRole('progressbar').count(), 0);
            assert.equal(await dialog.getByRole('list', { name: 'Installation stages' }).count(), 1);
            const updateCheck = dialog.getByRole('button', { name: 'Check for Rasta update', exact: true });
            const hostVersion = dialog.getByText('T3 Code version 0.1.8', { exact: true });
            assert.ok((await hostVersion.boundingBox()).x < (await updateCheck.boundingBox()).x);
            await dialog.getByRole('tab', { name: 'Reading', exact: true }).click();
            await dialog.getByRole('button', { name: 'Font', exact: true }).waitFor();
            await page.close();
            const removed = await context.newPage();
            await removed.goto(process.env.RASTA_MANAGER_URL || 'http://127.0.0.1:5173/');
            await removed.waitForFunction(() => window.rastaPreviewControl);
            await removed.evaluate(() => window.rastaPreview({ action: 'remove', target: 'codex' }));
            await removed.reload();
            await removed.getByRole('button', { name: 'Open Codex settings', exact: true }).click();
            const codex = removed.getByRole('dialog', { name: 'Codex', exact: true });
            const codexStatus = codex.getByRole('region', { name: 'Installation status', exact: true });
            await codexStatus.getByRole('heading', { name: 'Install Rasta for Codex', exact: true }).waitFor();
            assert.equal(await codex.getByRole('progressbar').count(), 0, 'a historical removal never shows completed installation progress');
            assert.equal(await codexStatus.getByText(/Local compatibility checks passed/).count(), 0);
            assert.equal(await codex.getByRole('button', { name: 'Versions, repair & details' }).count(), 0);
            assert.ok(!(await codex.innerText()).includes('Rasta removed from Codex'));
            assert.ok(!(await codex.innerText()).includes('Put the original app files back'));
            await codex.getByRole('button', { name: 'Close', exact: true }).click();
            await removed.getByRole('button', { name: 'Open Codex settings', exact: true }).click();
            await codexStatus.getByRole('heading', { name: 'Install Rasta for Codex', exact: true }).waitFor();
            await removed.screenshot({ path: path.join(output, `${engine}-${theme}-fresh-install.png`), fullPage: true });
            await codexStatus.getByRole('button', { name: 'Install Rasta for Codex', exact: true }).click();
            await codexStatus.getByRole('heading', { name: 'Finding Rasta for Codex', exact: true }).waitFor();
            await codexStatus.getByRole('heading', { name: 'Verifying the Rasta package', exact: true }).waitFor();
            const verifying = codex.getByRole('button', { name: 'Verifying…', exact: true });
            assert.equal(await verifying.isDisabled(), true);
            assert.equal(await verifying.getAttribute('aria-busy'), 'true');
            assert.equal(await codex.getByRole('progressbar').count(), 0);
            assert.equal(await codex.getByRole('list', { name: 'Installation stages' }).count(), 1);
            await codexStatus.getByText('Signing the prepared app copy for macOS.', { exact: true }).waitFor();
            assert.equal(await codexStatus.getByText(/you can close this dialog|simulation runs with this dialog closed|preparation continues in rasta/i).count(), 0);
            await codex.getByRole('button', { name: 'Close', exact: true }).click();
            await removed.getByRole('button', { name: 'Open Codex settings', exact: true }).click();
            await codexStatus.getByRole('button', { name: 'Simulate Launch', exact: true }).waitFor();
            assert.equal(await codexStatus.getByText(/Local compatibility checks passed/).count(), 0);
            assert.equal(await codexStatus.getByText('Action needed', { exact: true }).count(), 0);
            const codexState = await removed.evaluate(() => window.rastaPreview({ action: 'status' }));
            assert.equal(codexState.apps.find(app => app.id === 'codex').installed, false, 'reinstallation still waits for explicit Launch');
            assert.equal(codexState.apps.find(app => app.id === 't3').installed, false, 'the other connection stays independent');
            await removed.setViewportSize({ width: 390, height: 480 });
            await codexStatus.getByRole('button', { name: 'Simulate Launch', exact: true }).scrollIntoViewIfNeeded();
            assert.ok(await codexStatus.getByRole('button', { name: 'Simulate Launch', exact: true }).isVisible());
            assert.equal(await removed.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            assert.deepEqual(errors, []);
            assert.deepEqual(external, [], 'preview actions never access a real feed');
            await context.close();
        }
        console.log(`PASS: ${engine} clear recovery actions, separate publisher/user responsibility, offline checks, no false progress, old installer recovery, fresh setup after removal, compact progress actions, explicit Launch, both themes and narrow viewport.`);
    } finally { await browser.close(); }
}
