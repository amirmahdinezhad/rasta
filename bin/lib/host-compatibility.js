import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { CODEX_HTML, dictionaryDigest, digestSlots } from './codex-native.js';
import { patchHtml, PAYLOAD_FILENAME } from './html.js';
import { desktopAdapter, desktopTargets } from './desktop-adapters.js';
import { verifyArchiveBaseline } from './vendor-baseline.js';
import { matchesPackageName, targetDefinition } from './targets.js';
import { geminiCompatibility } from './gemini-native.js';

/** Check local integration requirements without executing or changing the host. Staging still verifies signatures and every installed byte. */
export function hostCompatibility(bundle, { testedVersions = [], blockedVersions = [] } = {}) {
    const target = targetDefinition(bundle.target || 'codex');
    const t3 = target.id === 't3', antigravity = target.id === 'antigravity', name = target.name;
    if (target.available === false) return { compatible: false, tested: false, status: 'unavailable', message: target.reason };
    if (target.id === 'gemini') return geminiCompatibility(bundle, { testedVersions, blockedVersions });
    const isolated = desktopTargets.includes(target.id);
    const htmlPaths = antigravity || isolated ? [] : t3 ? ['apps/server/dist/client/index.html'] : CODEX_HTML;
    const scriptSrc = t3 ? '/rasta-payload.js' : `./${PAYLOAD_FILENAME}`;
    const tested = testedVersions.includes(bundle.version);
    let code = 'rasta-update-required';
    try {
        if (blockedVersions.includes(bundle.version)) throw new Error('This Codex version is known to be incompatible with Rasta.');
        asar.uncache(bundle.archive);
        const pkg = JSON.parse(asar.extractFile(bundle.archive, 'package.json'));
        code = 'app-verification-failed';
        if (!matchesPackageName(target, pkg.name) || pkg.version !== bundle.version) throw new Error('Codex application identity changed.');
        code = 'rasta-update-required';
        let main = pkg.main;
        if (['rasta/main.cjs', 'rasta/main.mjs'].includes(main)) main = JSON.parse(asar.extractFile(bundle.archive, 'rasta/host.json')).originalMain;
        if ((pkg.type === 'module' && !isolated) || typeof main !== 'string' || main.includes('..') || path.posix.isAbsolute(main)) throw new Error('Codex needs a different startup adapter.');
        asar.extractFile(bundle.archive, main);
        for (const name of htmlPaths) {
            const html = asar.extractFile(bundle.archive, name).toString();
            if (!patchHtml(html, { scriptSrc }).html.includes(`<script src="${scriptSrc}"></script>`)) throw new Error('Codex needs a different interface adapter.');
        }
        if (isolated) desktopAdapter(bundle.archive, target.id, { ...pkg, main });
        if (antigravity) {
            const constants = asar.extractFile(bundle.archive, 'dist/constants.js').toString();
            const utils = asar.extractFile(bundle.archive, 'dist/utils.js').toString();
            asar.extractFile(bundle.archive, 'dist/preload.js');
            if (main !== 'dist/main.js' || !/exports\.WINDOW_ORIGIN\s*=\s*['"]https:\/\/127\.0\.0\.1['"]/.test(constants)
                || !/preload:\s*path_1\.default\.join\(__dirname, 'preload\.js'\)/.test(utils)
                || !utils.includes('exports.getHubWindows = getHubWindows;') || !utils.includes('exports.getHubWebContents = getHubWebContents;')
                || !/contextIsolation:\s*true/.test(utils) || !/nodeIntegration:\s*false/.test(utils)) throw Error('Antigravity needs a different Hub adapter.');
        }
        code = 'app-verification-failed';
        const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle.app, 'Contents/Info.plist')], { encoding: 'utf8' }));
        if (plist.CFBundleShortVersionString !== pkg.version || !String(plist.CFBundleVersion || '') || (target.id === 'codex' && String(plist.CFBundleVersion) !== String(pkg.codexBuildNumber)) || ((antigravity || isolated) && (plist.CFBundleIdentifier !== target.bundleId || plist.CFBundleVersion !== bundle.build))) throw new Error('Codex bundle and archive version/build do not agree.');
        const dictionary = plist.ElectronAsarIntegrity;
        const frameworks = path.join(bundle.app, 'Contents/Frameworks');
        const names = fs.readdirSync(frameworks).filter(name => /^(Codex|Electron) Framework\.framework$/.test(name));
        if (names.length !== 1) throw new Error('Cannot identify the Codex framework.');
        const binary = fs.readFileSync(path.join(frameworks, names[0], 'Versions/Current', names[0].replace('.framework', '')));
        code = 'rasta-update-required';
        if (!binary.includes(Buffer.from('registerPreloadScript'))) throw new Error('Codex does not expose the required preload API.');
        if ((antigravity || isolated) && (!binary.includes(Buffer.from('exposeInIsolatedWorld')) || !binary.includes(Buffer.from('executeJavaScriptInIsolatedWorld')))) throw Error('Antigravity does not expose the required isolated world APIs.');
        code = 'app-verification-failed';
        const digest = dictionaryDigest(dictionary);
        const slots = digestSlots(binary, { allowDisabled: t3 || antigravity || (isolated && target.id !== 'claude') });
        verifyArchiveBaseline(bundle, dictionary, createHash('sha256').update(asar.getRawHeader(bundle.archive).headerString).digest('hex'), slots);
        if (slots.some(offset => !binary.subarray(offset, offset + 32).equals(digest))) throw new Error('Codex native integrity does not match.');
        return { compatible: true, tested, status: tested ? 'tested' : 'unverified', message: tested ? null : `This ${name} version has not been fully tested. Local compatibility checks passed; reading support still needs to be checked inside the app.` };
    } catch (error) {
        return { compatible: false, tested, status: 'incompatible', code, message: error.message.replaceAll('Codex', name) };
    }
}
