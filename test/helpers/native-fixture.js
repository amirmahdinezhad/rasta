import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { targets } from '../../bin/lib/targets.js';
import { dictionaryDigest } from '../../bin/lib/codex-native.js';

export async function nativeFixture(dir, version = '26.1013.40934', signed = true, target = 'codex') {
    const desktop = ['claude', 'opencode', 'zcode'].includes(target);
    const esm = ['opencode', 'zcode'].includes(target);
    const currentOpenCode = target === 'opencode' && version === '2.2.7';
    const extra = desktop ? { target, build: version, htmlPaths: [], allowDisabledIntegrity: target !== 'claude' } : {};
    const antigravity = target === 'antigravity', t3 = target === 't3', htmlDir = t3 ? 'apps/server/dist/client' : 'webview', frameworkName = t3 || antigravity || desktop ? 'Electron Framework' : 'Codex Framework';
    const app = path.join(dir, desktop ? `${targets[target].name}.app` : antigravity ? 'Antigravity.app' : t3 ? 'T3 Code.app' : 'ChatGPT.app'), source = path.join(dir, 'source');
    fs.mkdirSync(path.join(source, htmlDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(source, '.vite/build'), { recursive: true });
    const packageName = currentOpenCode ? targets.opencode.alternatePackageName : desktop ? targets[target].packageName : antigravity ? 'antigravity' : t3 ? 't3code' : 'openai-codex-electron';
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: packageName, version, codexBuildNumber: '20770', ...(esm ? { type: 'module' } : {}), main: target === 'claude' ? '.vite/build/index.pre.js' : esm ? 'out/main/index.js' : antigravity ? 'dist/main.js' : '.vite/build/main.js' }));
    for (const name of t3 ? ['index.html'] : ['index.html', 'detached-window.html']) fs.writeFileSync(path.join(source, htmlDir, name), '<html><head></head><body><script src="./assets/original.js"></script></body></html>');
    for (const name of ['main.js', 'preload.js']) fs.writeFileSync(path.join(source, '.vite/build', name), `// original ${name} logic`);
    fs.writeFileSync(path.join(source, htmlDir, 'assets/original.js'), '// original renderer logic');
    if (antigravity) {
        fs.mkdirSync(path.join(source, 'dist'));
        fs.writeFileSync(path.join(source, 'dist/main.js'), '// original startup');
        fs.writeFileSync(path.join(source, 'dist/preload.js'), '// original preload');
        fs.writeFileSync(path.join(source, 'dist/constants.js'), "exports.WINDOW_ORIGIN = 'https://127.0.0.1';");
        fs.writeFileSync(path.join(source, 'dist/utils.js'), "exports.getHubWindows = getHubWindows; exports.getHubWebContents = getHubWebContents; const webPreferences = { preload: path_1.default.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true };");
    }
    if (target === 'claude') {
        fs.writeFileSync(path.join(source, '.vite/build/index.pre.js'), "require('./index.chunk-fixture.js');");
        fs.writeFileSync(path.join(source, '.vite/build/mainView.js'), '// vendor preload');
        fs.writeFileSync(path.join(source, '.vite/build/index.chunk-fixture.js'), 'var bo=e.r({mainView:()=>V,mainWindow:()=>B}); const origin="app://localhost"; Object.defineProperty(exports,"registry",{enumerable:!0,get:function(){return bo}});');
    } else if (esm) {
        for (const dir of ['out/main', 'out/preload', 'out/renderer']) fs.mkdirSync(path.join(source, dir), { recursive: true });
        fs.writeFileSync(path.join(source, 'out/renderer/index.html'), '<html><body>Original presentation</body></html>');
        fs.writeFileSync(path.join(source, `out/preload/index.${target === 'zcode' || currentOpenCode ? 'cjs' : 'js'}`), '// vendor preload');
        fs.writeFileSync(path.join(source, 'out/main/index.js'), currentOpenCode
            ? 'protocol.registerSchemesAsPrivileged([{scheme:`oc`}]);var Ce=`renderer`;win.loadURL(`oc://${Ce}/${name}`);const prefs={preload:`../preload/index.cjs`,contextIsolation:!0,nodeIntegration:!1};'
            : target === 'opencode'
            ? 'const rendererProtocol = "oc"; const rendererHost = "renderer"; const prefs = { contextIsolation: true, nodeIntegration: false };'
            : 'const preload = "../preload/index.cjs"; const prefs = { contextIsolation: !0, nodeIntegration: !1 }; win.loadFile(`../renderer/${name}.html`);');
    }
    const archive = path.join(app, 'Contents/Resources/app.asar'); fs.mkdirSync(path.dirname(archive), { recursive: true });
    await asar.createPackage(source, archive);
    const dictionary = { 'Resources/app.asar': { algorithm: 'SHA256', hash: createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex') } };
    const executable = path.join(app, 'Contents/MacOS/Codex'); fs.mkdirSync(path.dirname(executable), { recursive: true });
    const plist = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); execFileSync('/usr/bin/plutil', ['-convert', 'xml1', file]); };
    plist(path.join(app, 'Contents/Info.plist'), { CFBundleShortVersionString: version, CFBundleVersion: t3 || antigravity || desktop ? version : '20770', CFBundleExecutable: 'Codex', CFBundleIdentifier: desktop ? targets[target].bundleId : antigravity ? 'com.google.antigravity' : 'dev.rasta.fixture', CFBundlePackageType: 'APPL', ElectronAsarIntegrity: dictionary });
    if (!signed) { fs.writeFileSync(executable, 'fixture'); return { app, archive, executable, version, ...extra, ...(antigravity ? { target, build: version, htmlPaths: [], allowDisabledIntegrity: true } : {}) }; }
    const framework = path.join(app, 'Contents/Frameworks/' + frameworkName + '.framework'), binary = path.join(framework, 'Versions/A/' + frameworkName);
    const bytes = Buffer.concat([Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A'), Buffer.from(antigravity || esm ? [0, 0] : [1, 1]), dictionaryDigest(dictionary)]);
    const c = path.join(dir, 'fixture.c');
    fs.writeFileSync(c, `__attribute__((used,section("__DATA_CONST,__asar_integrity"),aligned(1))) static const unsigned char integrity[66] = {${[...bytes].join(',')}}; __attribute__((used)) static const char preload_api[] = "registerPreloadScript exposeInIsolatedWorld executeJavaScriptInIsolatedWorld"; int main(void) {return 0;}`);
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    const architecture = process.env.ARTL_BUILD_ARCH;
    execFileSync('/usr/bin/xcrun', ['clang', ...(architecture ? ['-arch', architecture] : []), c, '-o', binary]);
    fs.copyFileSync(binary, executable);
    plist(path.join(framework, 'Versions/A/Resources/Info.plist'), { CFBundleExecutable: frameworkName, CFBundleIdentifier: 'dev.rasta.fixture-framework', CFBundlePackageType: 'FMWK' });
    fs.symlinkSync('A', path.join(framework, 'Versions/Current'));
    for (const entry of [frameworkName, 'Resources']) fs.symlinkSync(`Versions/Current/${entry}`, path.join(framework, entry));
    for (const target of [framework, app]) execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', target], { stdio: 'pipe' });
    return { app, archive, executable, version, ...extra, ...(antigravity ? { target, build: version, htmlPaths: [], allowDisabledIntegrity: true } : {}) };
}
