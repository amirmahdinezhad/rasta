// Library uses bundle fingerprints to detect when a vendor update displaced a connection.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { guiPaths, saveJSON } from './gui-runtime.js';

export function updateEventPaths(app) {
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir();
    let label = 'dev.rasta.update.' + createHash('sha256').update(app).digest('hex').slice(0, 12);
    // Retain an existing per-app registration when an installation's branding changes.
    const agents = path.join(home, 'Library/LaunchAgents'), support = guiPaths().support;
    if (!fs.existsSync(path.join(agents, label + '.plist')) && fs.existsSync(agents)) {
        for (const name of fs.readdirSync(agents).filter(name => name.endsWith('.plist')).sort()) {
            try {
                const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(agents, name)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
                const args = plist.ProgramArguments;
                if (typeof plist.Label !== 'string' || plist.Label + '.plist' !== name || !Array.isArray(args)
                    || path.basename(args[1] || '') !== 'gui-update-event.js' || !plist.WatchPaths?.includes(app)) continue;
                const runtime = path.dirname(args[0] || '');
                if (path.dirname(runtime) !== path.join(support, 'ui-runtimes') || args[1] !== path.join(runtime, 'bin/gui-update-event.js')) continue;
                label = plist.Label; break;
            } catch { /* Unrelated launch agents do not belong to this installation. */ }
        }
    }
    return { label, domain: `gui/${process.getuid()}`, plist: path.join(home, 'Library/LaunchAgents', label + '.plist'), state: path.join(guiPaths().support, 'update-event.json') };
}
function fingerprintPaths(app) {
    const archive = path.join(app, 'Contents/Resources/app.asar');
    // Read the executable name from this bundle, not the current process's selected target.
    if (fs.existsSync(archive) || !fs.existsSync(path.join(app, 'Contents/Info.plist'))) return ['Contents/Info.plist', 'Contents/Resources/app.asar'];
    const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8', stdio: 'pipe' }));
    if (info.CFBundleIdentifier !== 'com.google.GeminiMacOS' || typeof info.CFBundleExecutable !== 'string' || !info.CFBundleExecutable || path.basename(info.CFBundleExecutable) !== info.CFBundleExecutable) throw Error('Unknown native application fingerprint.');
    return ['Contents/Info.plist', path.join('Contents/MacOS', info.CFBundleExecutable)];
}
export function appFingerprint(app) {
    return fingerprintPaths(app).map(name => {
        const stat = fs.statSync(path.join(app, name)); return [stat.dev, stat.ino, stat.size, stat.mtimeMs].join(':');
    }).join('|');
}
export function installUpdateEvent(config, { healthy = true } = {}) {
    const paths = updateEventPaths(config.app);
    try { execFileSync('/bin/launchctl', ['bootout', `${paths.domain}/${paths.label}`], { stdio: 'pipe' }); } catch {}
    // Library uses this baseline to identify a connection displaced by a host update.
    saveJSON(paths.state, { enabled: true, app: config.app, healthyFingerprint: healthy ? appFingerprint(config.app) : null });
    fs.rmSync(paths.plist, { force: true });
    return paths;
}
export function removeUpdateEvent(config) {
    const paths = updateEventPaths(config.app); saveJSON(paths.state, { enabled: false, app: config.app });
    try { execFileSync('/bin/launchctl', ['bootout', `${paths.domain}/${paths.label}`], { stdio: 'pipe' }); } catch {}
    fs.rmSync(paths.plist, { force: true });
    try { fs.rmdirSync(path.dirname(paths.plist)); } catch {}
}
