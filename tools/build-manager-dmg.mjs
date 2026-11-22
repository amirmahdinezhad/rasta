import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = path.resolve(process.env.ARTL_MANAGER_OUTPUT || 'dist/Rasta.app');
const version = JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/runtime/bin/manager-config.json'))).version;
const output = path.resolve(process.env.ARTL_MANAGER_DMG || `dist/Rasta-${version}-darwin-${process.arch}.dmg`);
if (fs.existsSync(output)) throw Error('DMG already exists. Inspect it before rebuilding.');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-manager-dmg-'));
const content = path.join(stage, 'content'), mount = path.join(stage, 'mounted');
const volume = process.env.ARTL_MANAGER_DMG_VOLUME || `Rasta ${version}`;
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let attached = false;
try {
    fs.mkdirSync(content); fs.mkdirSync(mount); fs.mkdirSync(path.join(content, '.background'));
    run('/usr/bin/ditto', [app, path.join(content, 'Rasta.app')]);
    fs.symlinkSync('/Applications', path.join(content, 'Applications'));
    const artwork = path.join(stage, 'artwork');
    run('/usr/bin/xcrun', ['swiftc', path.join(root, 'native/DiskImageArtwork.swift'), '-o', artwork]);
    run(artwork, [path.join(content, '.background/install.png')]);
    const writable = path.join(stage, 'layout.dmg');
    run('/usr/bin/hdiutil', ['create', '-volname', volume, '-srcfolder', content, '-format', 'UDRW', '-fs', 'HFS+', writable]);
    run('/usr/bin/hdiutil', ['attach', writable, '-readwrite', '-nobrowse', '-noautoopen', '-mountpoint', mount]); attached = true;
    run('/usr/bin/osascript', [path.join(root, 'tools/configure-dmg.applescript'), mount]);
    if (!fs.existsSync(path.join(mount, '.DS_Store'))) throw Error('Finder did not save the installation layout.');
    run('/bin/sync', []);
    run('/usr/bin/hdiutil', ['detach', mount]); attached = false;
    run('/usr/bin/hdiutil', ['convert', writable, '-format', 'UDZO', '-o', output]);
    run('/usr/bin/hdiutil', ['verify', output]);
    // Verify the actual read-only delivery image, including its persistent Finder layout.
    run('/usr/bin/hdiutil', ['attach', output, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount]); attached = true;
    if (!fs.existsSync(path.join(mount, '.DS_Store')) || !fs.existsSync(path.join(mount, '.background/install.png')) || fs.readlinkSync(path.join(mount, 'Applications')) !== '/Applications') throw Error('Installation guide is missing from the final DMG.');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(mount, 'Rasta.app')]);
    run('/usr/bin/hdiutil', ['detach', mount]); attached = false;
    console.log(output);
} finally {
    if (attached) { try { run('/usr/bin/hdiutil', ['detach', mount]); } catch {} }
    fs.rmSync(stage, { recursive: true, force: true });
}
