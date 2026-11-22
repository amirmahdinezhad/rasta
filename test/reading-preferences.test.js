import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { managerPreferences } from '../bin/lib/manager.js';
import { saveReadingPreferences } from '../bin/lib/reading-preferences.js';
import { targets } from '../bin/lib/targets.js';

it('starts every Library connection with Vazir and the same reading settings', t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-reading-defaults-'));
    const previousHome = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    t.after(() => {
        if (previousHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME;
        else process.env.ARTL_CODEX_STATE_HOME = previousHome;
        fs.rmSync(home, { recursive: true, force: true });
    });
    for (const id of Object.keys(targets)) {
        assert.deepEqual(managerPreferences(id, { scan: () => [] }), {
            selected: 'vazir', fonts: [], active: null,
            reading: { isRTL: true, forceRTL: false, fixAtSign: false, fs: '16', lh: '1.6' },
        }, id);
    }
});

it('preserves existing renderer settings on the first native save', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-reading-baseline-'));
    try {
        for (const fixAtSign of [false, true]) {
            const file = path.join(root, String(fixAtSign), 'reading.json');
            const baseline = { isRTL: true, forceRTL: true, fixAtSign, fs: '18', lh: '1.8' };
            const result = saveReadingPreferences({ isRTL: false }, file, baseline);
            assert.deepEqual(result, { ...baseline, isRTL: false });
            assert.deepEqual(JSON.parse(fs.readFileSync(file)), result);
            assert.deepEqual(saveReadingPreferences({ isRTL: true }, file, { ...baseline, fixAtSign: !fixAtSign }), { ...baseline, isRTL: true }, 'saved native settings take precedence over a stale renderer');
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('skips unchanged reading preferences before and after the first save', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-reading-noop-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'reading.json');
    assert.equal(saveReadingPreferences({ fs: '16' }, file).fs, '16');
    const baseline = { fs: '18', lh: '1.8' };
    assert.equal(saveReadingPreferences({ fs: '18', lh: '1.8' }, file, baseline).fs, '18');
    assert.equal(fs.existsSync(file), false);

    const saved = saveReadingPreferences({ fs: '14' }, file, baseline);
    assert.equal(saved.lh, '1.8');
    const { ino, mtimeMs } = fs.statSync(file);
    assert.deepEqual(saveReadingPreferences({ fs: '14', lh: '1.8' }, file, baseline), saved);
    assert.equal(fs.statSync(file).ino, ino);
    assert.equal(fs.statSync(file).mtimeMs, mtimeMs);
});
