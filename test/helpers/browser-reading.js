/** Model the read-only host bridge. Tests change preferences from the manager side. */
export async function installReadingBridge(context) {
    await context.addInitScript(() => {
        window.rastaNative = {
            status: async () => ({}), check: async () => ({}), openManager: async () => ({}),
            preferences: async () => ({ selected: 'vazir', fonts: [], active: null, reading: JSON.parse(localStorage.getItem('reading-fixture') || 'null') }),
        };
    });
}
export async function setReading(page, input) {
    await page.evaluate(input => {
        const defaults = { isRTL: true, forceRTL: false, fixAtSign: false, fs: '16', lh: '1.6' };
        const prior = JSON.parse(localStorage.getItem('reading-fixture') || 'null') || JSON.parse(localStorage.getItem('rasta-config') || '{}');
        localStorage.setItem('reading-fixture', JSON.stringify({ ...defaults, ...prior, ...input }));
        window.dispatchEvent(new Event('focus'));
    }, input);
    await page.waitForFunction(input => { const saved = JSON.parse(localStorage.getItem('rasta-config') || '{}'); return Object.entries(input).every(([key, value]) => saved[key] === value); }, input);
}
