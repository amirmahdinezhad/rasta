import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { runManagerUpdate } from '../bin/manager-core-update.js';

for (const profile of ['dev.rasta.manager']) for (const scenario of ['success', 'reopen failure', 'cleanup denied']) test(`manager ${profile} replacement handles ${scenario}`, { skip: process.platform !== 'darwin' }, async t => {
    const fail = scenario === 'reopen failure', cleanupDenied = scenario === 'cleanup denied';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-core-update-'));
    try {
        const obsolete = fs.mkdtempSync(path.join(root, 'core-update-'));
        await delay(25);
        const prepared = fs.mkdtempSync(path.join(root, 'core-update-'));
        const destination = path.join(root, 'Applications/Rasta.app'), app = path.join(prepared, 'Rasta.app');
        for (const [bundle, version] of [[destination, '1.0.0'], [app, '2.0.0']]) {
            fs.mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
            fs.copyFileSync('/usr/bin/true', path.join(bundle, 'Contents/MacOS/Rasta'));
            const info = path.join(bundle, 'Contents/Info.plist');
            fs.writeFileSync(info, JSON.stringify({ CFBundleIdentifier: profile, CFBundleShortVersionString: version, CFBundleExecutable: 'Rasta', CFBundlePackageType: 'APPL' }));
            execFileSync('/usr/bin/plutil', ['-convert', 'xml1', info]);
            execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { stdio: 'pipe' });
        }
        const newer = fs.mkdtempSync(path.join(root, 'core-update-'));
        const preparedFile = path.join(root, 'core-prepared.json');
        fs.writeFileSync(preparedFile, JSON.stringify({ app }));
        const connection = path.join(root, 'connections'); fs.mkdirSync(connection); fs.writeFileSync(path.join(connection, 'keep'), 'original connection');
        const status = path.join(root, 'status.json'), calls = []; let polls = 0, opens = 0;
        if (cleanupDenied) {
            const remove = fs.rmSync;
            t.mock.method(fs, 'rmSync', (file, options) => {
                if (file === obsolete) throw Error('Fixture cleanup denied');
                return remove(file, options);
            });
        }
        await runManagerUpdate({ app, destination, version: '2.0.0', parentPid: 42, status }, {
            alive: () => ++polls < 3, pause: async () => assert.equal(fs.existsSync(destination), true),
            run: (command, args) => { calls.push([command, args]); if (command.endsWith('/open')) { opens++; if (fail && opens === 1) throw Error('Could not reopen fixture'); return ''; } return execFileSync(command, args, { stdio: 'pipe' }); },
        });
        assert.equal(polls, 3);
        const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(destination, 'Contents/Info.plist')]));
        assert.equal(info.CFBundleShortVersionString, fail ? '1.0.0' : '2.0.0');
        const result = JSON.parse(fs.readFileSync(status));
        assert.equal(result.phase, fail ? 'failed' : 'complete');
        if (cleanupDenied) assert.match(result.cleanupWarning, /Fixture cleanup denied/);
        assert.ok(calls.some(([command]) => command.endsWith('/codesign')));
        assert.equal(opens, fail ? 2 : 1);
        assert.equal(fs.readFileSync(path.join(connection, 'keep'), 'utf8'), 'original connection');
        assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['Rasta.app']);
        for (const file of [prepared, preparedFile]) assert.equal(fs.existsSync(file), fail, file);
        assert.equal(fs.existsSync(obsolete), fail || cleanupDenied);
        assert.ok(fs.existsSync(newer));
    } finally { t.mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }); }
});
