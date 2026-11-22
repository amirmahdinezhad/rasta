import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { guiPaths, saveJSON, readJSON } from '../bin/lib/gui-runtime.js';
import { appFingerprint, installUpdateEvent, updateEventPaths } from '../bin/lib/update-events.js';

test('connections retire old watchers and retain the Library recovery baseline', { skip: process.platform !== 'darwin' }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-library-event-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    try {
        const config = { app: path.join(home, 'ZCode.app'), managedByRasta: false };
        for (const file of ['Contents/Info.plist', 'Contents/Resources/app.asar'])
            saveJSON(path.join(config.app, file), {});
        const paths = updateEventPaths(config.app);
        saveJSON(paths.plist, { Label: paths.label });
        installUpdateEvent(config);
        assert.equal(fs.existsSync(paths.plist), false);
        assert.deepEqual(readJSON(paths.state), { enabled: true, app: config.app, healthyFingerprint: appFingerprint(config.app) });
        fs.appendFileSync(path.join(config.app, 'Contents/Resources/app.asar'), 'updated');
        assert.notEqual(appFingerprint(config.app), readJSON(paths.state).healthyFingerprint);
    } finally {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test('retains only the update registration owned by the same app and support directory', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-event-owner-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    try {
        const app = path.join(home, 'Codex.app'), support = guiPaths().support;
        const runtime = path.join(support, 'ui-runtimes', 'previous');
        const agents = path.join(home, 'Library/LaunchAgents');
        const entry = (label, runtime, watchedApp) => saveJSON(path.join(agents, label + '.plist'), {
            Label: label, ProgramArguments: [path.join(runtime, 'node'), path.join(runtime, 'bin/gui-update-event.js')], WatchPaths: [watchedApp],
        });
        entry('dev.previous.other', path.join(home, 'other/ui-runtimes/old'), app);
        entry('dev.previous.foreign', runtime, path.join(home, 'T3.app'));
        assert.match(updateEventPaths(app).label, /^dev\.rasta\.update\./);
        entry('dev.previous.owned', runtime, app);
        assert.equal(updateEventPaths(app).label, 'dev.previous.owned');
    } finally {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, { recursive: true, force: true });
    }
});
