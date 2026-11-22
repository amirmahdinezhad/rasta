import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import os from 'node:os';

function findT3Archive() {
    if (process.env.ARTL_ASAR_T3) return process.env.ARTL_ASAR_T3;
    if (os.platform() !== 'darwin') return null;
    const roots = ['/Applications', path.join(os.homedir(), 'Applications')];
    for (const root of roots) {
        let apps;
        try { apps = fs.readdirSync(root).filter(name => name.startsWith('T3') && name.endsWith('.app')).sort(); }
        catch { continue; }
        const found = apps.map(name => path.join(root, name, 'Contents/Resources/app.asar')).find(file => fs.existsSync(file));
        if (found) return found;
    }
    return null;
}

/** Resolve the actual T3 bundle and its vendor client entry. */
export function resolveT3App(app = null) {
    const archive = app ? path.join(app, 'Contents/Resources/app.asar') : findT3Archive();
    if (!archive || !fs.existsSync(archive)) return null;
    asar.uncache(archive);
    const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
    if (pkg.name !== 't3code') throw new Error('Unexpected T3 application identity.');
    app ||= path.dirname(path.dirname(path.dirname(archive)));
    const executable = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    if (!executable || path.basename(executable) !== executable) throw new Error('Invalid T3 executable.');
    return { app, archive, executable: path.join(app, 'Contents/MacOS', executable), version: pkg.version,
        target: 't3', htmlPaths: ['apps/server/dist/client/index.html'], scriptSrc: '/rasta-payload.js', allowDisabledIntegrity: true };
}
