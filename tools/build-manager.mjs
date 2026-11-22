import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCodexApp } from '../bin/lib/codex.js';
import { copyPackage, copyPortableNode } from '../bin/lib/gui-runtime.js';
import { bundleLibraryPackages } from './development-release.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.env.ARTL_MANAGER_OUTPUT || 'dist/Rasta.app');
const run = (file, args) => execFileSync(file, args, { stdio: 'pipe' });
const identity = process.env.ARTL_CODESIGN_IDENTITY || '-';
const architecture = process.env.ARTL_BUILD_ARCH || (process.arch === 'arm64' ? 'arm64' : 'x86_64');
if (!['arm64', 'x86_64'].includes(architecture)) throw Error('Unsupported build architecture.');
fs.rmSync(output, { recursive: true, force: true });
const runtime = path.join(output, 'Contents/Resources/runtime'); fs.mkdirSync(runtime, { recursive: true });
// Bundle the same current panel source as every connection package.
execFileSync('/usr/bin/env', ['npm', '--prefix', path.join(root, 'ui/manager'), 'run', 'build', '--', '--mode', 'panel'], { stdio: 'inherit' });
copyPackage(runtime, { releaseBuildId: process.env.ARTL_RELEASE_BUILD_ID });
// WKWebView loads the signed UI from a file URL. A classic single bundle
// avoids module CORS while retaining the local-only navigation policy.
const compiledUI = path.join(root, 'dist/manager-ui');
run('/usr/bin/env', ['npm', '--prefix', path.join(root, 'ui/manager'), 'run', 'build', '--', '--mode', 'native']);
const managerUI = path.join(runtime, 'bin/manager');
fs.rmSync(managerUI, { recursive: true, force: true });
fs.cpSync(compiledUI, managerUI, { recursive: true });
const index = path.join(managerUI, 'index.html');
const html = fs.readFileSync(index, 'utf8')
    .replace('<script type="module" crossorigin', '<script defer')
    .replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'">`);
if (html.includes('type="module"')) throw Error('Native manager requires a classic script.');
fs.writeFileSync(index, html);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const configFile = path.join(runtime, 'bin/manager-config.json'), config = JSON.parse(fs.readFileSync(configFile));
fs.writeFileSync(configFile, JSON.stringify({ ...config, ...(process.env.ARTL_RELEASE_BUILD_ID ? { releaseBuildId: process.env.ARTL_RELEASE_BUILD_ID } : {}), version: process.env.ARTL_MANAGER_VERSION || pkg.version, ...(process.env.ARTL_BUNDLED_FEEDS ? { bundledFeeds: JSON.parse(process.env.ARTL_BUNDLED_FEEDS) } : {}) }, null, 2) + '\n');
const bundled = resolveCodexApp();
const node = process.env.ARTL_PORTABLE_NODE || (bundled && path.join(bundled.app, 'Contents/Resources/cua_node/bin/node'));
if (!node || !fs.existsSync(node)) throw Error('Provide ARTL_PORTABLE_NODE for a standalone macOS Node runtime.');
copyPortableNode(node, runtime);
if (process.env.ARTL_LIBRARY_PACKAGES) {
    const { directory, artifacts } = JSON.parse(process.env.ARTL_LIBRARY_PACKAGES);
    bundleLibraryPackages(runtime, directory, artifacts);
}
const executable = path.join(output, 'Contents/MacOS/Rasta'); fs.mkdirSync(path.dirname(executable), { recursive: true });
run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-target', `${architecture}-apple-macosx13.5`, architecture === 'x86_64' ? '-Osize' : '-O', path.join(root, 'native/RastaManager.swift'), '-o', executable]);
const artwork = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-manager-icon-'));
try {
    const set = path.join(artwork, 'Rasta.iconset'); fs.mkdirSync(set);
    const helper = path.join(artwork, 'rasta-icon');
    run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', path.join(root, 'native/RastaPackageTool.swift'), '-o', helper]);
    for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2])
        run(helper, ['--write-icon', path.join(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), String(size * scale)]);
    run('/usr/bin/iconutil', ['-c', 'icns', '-o', path.join(output, 'Contents/Resources/Rasta.icns'), set]);
} finally { fs.rmSync(artwork, { recursive: true, force: true }); }
const plist = path.join(output, 'Contents/Info.plist');
fs.writeFileSync(plist, JSON.stringify({ CFBundleName: 'Rasta', CFBundleDisplayName: 'Rasta', CFBundleExecutable: 'Rasta', CFBundleIdentifier: 'dev.rasta.manager',
    CFBundleShortVersionString: process.env.ARTL_MANAGER_VERSION || pkg.version, CFBundleVersion: process.env.ARTL_MANAGER_VERSION || pkg.version, CFBundlePackageType: 'APPL', LSMinimumSystemVersion: '13.5', NSHighResolutionCapable: true,
    CFBundleIconFile: 'Rasta.icns', CFBundleURLTypes: [{ CFBundleURLName: 'Rasta connection', CFBundleURLSchemes: ['rasta'] }] }));
run('/usr/bin/plutil', ['-convert', 'xml1', plist]);
run('/usr/bin/codesign', ['--force', '--sign', identity, '--options', 'runtime', output]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', output]);
console.log(output);
