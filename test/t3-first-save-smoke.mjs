// Exercise the real native reading service in a disposable home with a simulated T3 page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw Error('Provide ARTL_PLAYWRIGHT_MODULE and start npm run preview:manager.');
const engines = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const base = process.env.RASTA_MANAGER_URL || 'http://127.0.0.1:5173/';
for (const engine of ['chromium', 'webkit']) {
    const browser = await engines[engine].launch({ headless: true });
    try {
        for (const fixAtSign of [true, false]) {
            const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-t3-first-save-'));
            const context = await browser.newContext({ reducedMotion: 'reduce' });
            try {
                const page = await context.newPage();
                const baseline = { isRTL: true, forceRTL: true, fixAtSign, fs: '18', lh: '1.8' };
                await page.exposeFunction('saveNativeReading', (key, value, current) => {
                    const result = JSON.parse(execFileSync(process.execPath, ['bin/gui-service.js', '--rpc', 'reading-save', '--reading-key', key, '--reading-value', String(value), '--reading-baseline', JSON.stringify(current)], {
                        env: { ...process.env, ARTL_CODEX_STATE_HOME: home, ARTL_TARGET: 't3' }, encoding: 'utf8',
                    }));
                    assert.equal(result.ok, true);
                    return result.value;
                });
                await page.addInitScript(reading => {
                    localStorage.setItem('rasta-config', JSON.stringify(reading));
                    let native;
                    Object.defineProperty(window, 'rastaNative', {
                        get: () => native,
                        set: value => {
                            native = value;
                            // No native preferences file exists before this first save.
                            native.preferences = async () => ({ selected: 'vazir', fonts: [], active: null, reading: null });
                            native.saveReading = (...args) => window.saveNativeReading(...args);
                        },
                    });
                }, baseline);
                await page.goto(new URL('panel-preview?host=t3', base).href);
                await page.getByRole('button', { name: 'Open Rasta panel', exact: true }).click();
                const rtl = page.getByRole('switch', { name: 'Enable RTL', exact: true });
                const shortcut = page.getByRole('switch', { name: 'Type @ with Shift+2', exact: true });
                assert.equal(await shortcut.getAttribute('aria-checked'), String(fixAtSign));
                await rtl.click();
                await page.getByRole('switch', { name: 'Enable RTL', exact: true, checked: false }).waitFor();
                assert.equal(await shortcut.getAttribute('aria-checked'), String(fixAtSign));
                const saved = JSON.parse(fs.readFileSync(path.join(home, 'Library/Application Support/Rasta T3/reading-preferences.json')));
                assert.deepEqual(saved, { ...baseline, isRTL: false });
                await rtl.click();
                await page.getByRole('switch', { name: 'Enable RTL', exact: true, checked: true }).waitFor();
                assert.equal(await shortcut.getAttribute('aria-checked'), String(fixAtSign));
                console.log(`${engine}: first native save preserves shortcut=${fixAtSign} and other reading preferences`);
            } finally {
                await context.close();
                fs.rmSync(home, { recursive: true, force: true });
            }
        }
    } finally { await browser.close(); }
}
