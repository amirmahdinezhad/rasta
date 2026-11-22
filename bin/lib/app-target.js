import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as asar from '@electron/asar';
import { matchesPackageName, targetDefinition } from './targets.js';

const config = JSON.parse(fs.readFileSync(new URL('../release-config.json', import.meta.url)));
const runtimeRoot = fileURLToPath(new URL('../../', import.meta.url));
/** The bundled target owns its own settings, backups and updater runtime. */
export const targetId = () => targetDefinition(process.env.ARTL_TARGET || config.target || 'codex').id;
export const targetName = () => targetDefinition(targetId()).name;

/** Keep an authenticated updater in the support directory that owns its runtime. */
export function runtimeSupportPath(runtime, home) {
    if (!path.isAbsolute(runtime)) return null;
    const root = path.resolve(runtime), runtimes = path.dirname(root), support = path.dirname(runtimes);
    return path.basename(runtimes) === 'ui-runtimes'
        && path.dirname(support) === path.join(home, 'Library/Application Support') ? (fs.existsSync(support) ? fs.realpathSync(support) : support) : null;
}

/** Read the installed host through its package entry rather than a historical brand name. */
export function installedSupportPath({ home, app, target }) {
    try {
        if (target === 'gemini') {
            const host = JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/rasta/host.json'), 'utf8'));
            return host.schema === 1 && host.app === app && host.target === target && typeof host.runtime === 'string' ? runtimeSupportPath(host.runtime, home) : null;
        }
        const archive = path.join(app, 'Contents/Resources/app.asar');
        asar.uncache(archive);
        const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
        if (!matchesPackageName(targetDefinition(target), pkg.name) || typeof pkg.main !== 'string') return null;
        const main = path.posix.normalize(pkg.main);
        if (path.posix.isAbsolute(main) || main.startsWith('../') || !['main.cjs', 'main.mjs'].includes(path.posix.basename(main))) return null;
        const host = JSON.parse(asar.extractFile(archive, path.posix.join(path.posix.dirname(main), 'host.json')));
        if (host.app !== app || (host.target || 'codex') !== target || typeof host.runtime !== 'string') return null;
        return runtimeSupportPath(host.runtime, home);
    } catch { return null; }
}

export const canonicalSupportPath = (home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) => path.join(home, 'Library/Application Support', targetDefinition(targetId()).support);

export function supportPath(home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) {
    const own = runtimeSupportPath(runtimeRoot, home);
    if (own) return own;
    const target = targetId();
    // Disposable test homes must never adopt the real user's installed state.
    if (!process.env.ARTL_CODEX_STATE_HOME && home === os.homedir()) {
        const args = process.argv, index = args.indexOf('--app');
        const explicit = index >= 0 ? args[index + 1] : null;
        let apps = [];
        if (explicit) apps = [explicit];
        else if (target === 'codex') apps = process.env.ARTL_CODEX_APP ? [process.env.ARTL_CODEX_APP] : [
            '/Applications/Codex.app', path.join(home, 'Applications/Codex.app'),
            '/Applications/ChatGPT.app', path.join(home, 'Applications/ChatGPT.app'),
        ];
        else if (targetDefinition(target).bundleId) apps = ['/Applications', path.join(home, 'Applications')].map(root => path.join(root, `${targetDefinition(target).name}.app`));
        else if (process.env.ARTL_ASAR_T3) apps = [path.dirname(path.dirname(path.dirname(process.env.ARTL_ASAR_T3)))];
        else {
            try { apps = fs.readdirSync('/Applications').filter(name => name.startsWith('T3') && name.endsWith('.app')).sort().map(name => path.join('/Applications', name)); } catch {}
        }
        for (const app of apps) {
            const installed = installedSupportPath({ home, app, target });
            if (installed) return installed;
        }
    }
    return canonicalSupportPath(home);
}
