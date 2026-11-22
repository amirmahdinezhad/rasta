import path from 'node:path';
import * as asar from '@electron/asar';

export const desktopTargets = Object.freeze(['claude', 'opencode', 'zcode', 'grokbot']);
const read = (archive, file) => asar.extractFile(archive, file).toString();
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Identify presentation entry points from vendor bytes without loading vendor modules. */
export function desktopAdapter(archive, target, pkg) {
    const main = path.posix.normalize(pkg.main || '');
    if (target === 'grokbot') {
        if (main !== 'dist/electron-main/main.cjs' || pkg.type !== 'module') throw Error('Grok Bot needs a different startup adapter.');
        read(archive, main);
        read(archive, 'dist/electron-preload/preload.cjs');
        const source = read(archive, 'dist/electron-main/main-core.cjs');
        const html = read(archive, 'dist/renderer/index.html');
        const renderer = html.match(/src="\.\/(assets\/index-[\w-]+\.js)"/);
        if (!source.includes('../renderer/index.html') || !source.includes('contextIsolation:!0,nodeIntegration:!1')
            || !renderer) throw Error('Grok Bot needs a different renderer adapter.');
        const entry = read(archive, `dist/renderer/${renderer[1]}`);
        const presentationModule = entry.match(/from\s*"\.\/(index\.eager-app-[\w-]+\.js)"/);
        if (!presentationModule) throw Error('Grok Bot needs a different conversation adapter.');
        const presentation = read(archive, `dist/renderer/assets/${presentationModule[1]}`);
        if (!['sand-message-prose', 'sand-chat-input-dock'].every(marker => presentation.includes(marker)))
            throw Error('Grok Bot needs a different conversation adapter.');
        return { kind: 'grokbot-file' };
    }
    if (target === 'claude') {
        const entry = '.vite/build/index.pre.js';
        const launcher = '.vite/build/launcher.js';
        if (![entry, launcher].includes(main) || pkg.type === 'module') throw Error('Claude needs a different startup adapter.');
        if (main === launcher && !/\brequire\(\s*(["'])\.\/index\.pre\.js\1\s*\)/.test(read(archive, launcher)))
            throw Error('Claude needs a different launcher adapter.');
        read(archive, entry);
        read(archive, '.vite/build/mainView.js');
        const matches = [];
        for (const file of asar.listPackage(archive).filter(file => /^\/\.vite\/build\/index\.chunk-[\w-]+\.js$/.test(file))) {
            const source = read(archive, file.slice(1));
            const registry = source.match(/([\w$]+)=\w+\.r\(\{[^}]{0,2400}\bmainView:\(\)=>[\w$]+,/);
            if (!registry || !source.includes('app://localhost')) continue;
            const exported = source.match(new RegExp(`Object\\.defineProperty\\(exports,"([\\w$]+)",\\{enumerable:!0,get:function\\(\\)\\{return ${escapePattern(registry[1])}\\}\\}\\)`));
            if (exported) matches.push({ kind: 'claude-view', registryModule: file.slice(1), registryExport: exported[1] });
        }
        if (matches.length !== 1) throw Error('Cannot identify the Claude main-view registry.');
        return matches[0];
    }
    if (!['opencode', 'zcode'].includes(target) || main !== 'out/main/index.js' || pkg.type !== 'module') throw Error('This desktop app needs a different startup adapter.');
    const source = read(archive, main);
    read(archive, 'out/renderer/index.html');
    if (target === 'opencode') {
        if (pkg.name === '@opencode/desktop') {
            read(archive, 'out/preload/index.cjs');
            const load = source.match(/\.loadURL\(`oc:\/\/\$\{([\w$]+)\}\/\$\{[\w$]+\}`\)/);
            if (!load || !new RegExp(`\\b${escapePattern(load[1])}\\s*=\\s*` + '`renderer`').test(source)
                || !source.includes('../preload/index.cjs') || !source.includes('registerSchemesAsPrivileged([{scheme:`oc`'))
                throw Error('OpenCode needs a different renderer adapter.');
        } else {
            read(archive, 'out/preload/index.js');
            if (!/const rendererProtocol\s*=\s*["']oc["']/.test(source) || !/const rendererHost\s*=\s*["']renderer["']/.test(source))
                throw Error('OpenCode needs a different renderer adapter.');
        }
        if (!/contextIsolation:\s*(?:true|!0)/.test(source) || !/nodeIntegration:\s*(?:false|!1)/.test(source))
            throw Error('OpenCode needs a different renderer adapter.');
        return { kind: 'opencode-renderer' };
    }
    read(archive, 'out/preload/index.cjs');
    if (!source.includes('../renderer/${') || !source.includes('loadFile(') || !source.includes('../preload/index.cjs')
        || !/contextIsolation:\s*(?:!0|true)/.test(source) || !/nodeIntegration:\s*(?:!1|false)/.test(source)) throw Error('ZCode needs a different renderer adapter.');
    return { kind: 'zcode-file' };
}
