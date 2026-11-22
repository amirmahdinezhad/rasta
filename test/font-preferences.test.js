import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fontPaths, fontPreferences, importFont, removeFont, selectFont, inspectFont, MAX_FONT_BYTES } from '../bin/lib/font-preferences.js';

const bytes = fs.readFileSync(new URL('../bin/assets/Vazir-Regular.ttf', import.meta.url));
const bold = fs.readFileSync(new URL('../bin/assets/Vazir-Bold.ttf', import.meta.url));
const input = { name: 'My font.ttf', data: bytes.toString('base64') };

function fixture(run) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-font-preferences-'));
    try { return run(fontPaths(home), home); }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
}

it('defaults to Vazir and persists an imported private copy across service invocations', () => fixture((paths, home) => {
    assert.deepEqual(fontPreferences(paths), { selected: 'vazir', fonts: [], active: null });
    assert.equal(selectFont('vazir', paths).selected, 'vazir');
    assert.equal(fs.existsSync(paths.preferences), false);
    const imported = importFont(input, paths);
    assert.match(imported.selected, /^[a-f0-9]{32}$/);
    assert.equal(imported.fonts[0].label, 'Vazir Regular');
    assert.equal(imported.active.data, input.data);
    const { ino } = fs.statSync(paths.preferences);
    assert.deepEqual(selectFont(imported.selected, paths), imported);
    assert.equal(fs.statSync(paths.preferences).ino, ino);
    assert.deepEqual(importFont(input, paths), imported, 'importing the same file twice keeps one entry');
    const files = fs.readdirSync(paths.directory);
    assert.equal(files.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(paths.directory, files[0])), bytes);
    const result = spawnSync(process.execPath, ['bin/gui-service.js', '--rpc', 'fonts'], {
        env: { ...process.env, ARTL_CODEX_STATE_HOME: home }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).value, imported);
    assert.equal(selectFont('vazir', paths).active, null);
    assert.equal(fontPreferences(paths).selected, 'vazir');
    assert.equal(selectFont(imported.selected, paths).active.data, input.data);
}));

it('lists the full names of two weights and restores their exact bytes using existing saved IDs', () => fixture(paths => {
    const regular = importFont(input, paths);
    const heavy = importFont({ ...input, data: bold.toString('base64') }, paths);
    const saved = JSON.parse(fs.readFileSync(paths.preferences, 'utf8'));
    for (const font of saved.fonts) font.label = 'Vazir';
    fs.writeFileSync(paths.preferences, JSON.stringify(saved));

    assert.deepEqual(fontPreferences(paths).fonts, [
        { id: regular.selected, label: 'Vazir Regular' },
        { id: heavy.selected, label: 'Vazir Bold' },
    ]);
    assert.equal(fontPreferences(paths).active.data, bold.toString('base64'));
    assert.equal(selectFont(regular.selected, paths).active.data, input.data);
}));

it('rejects invalid font data, oversized files and arbitrary selections without changing the saved font', () => fixture(paths => {
    const previous = importFont(input, paths);
    for (const invalid of [null, { ...input, name: 'font.woff2' }, { ...input, data: 'not base64!' },
        { ...input, data: Buffer.from('not a font').toString('base64') }, { ...input, data: Buffer.alloc(MAX_FONT_BYTES + 1).toString('base64') }])
        assert.throws(() => importFont(invalid, paths));
    for (const id of ['../somewhere', '/tmp/font.ttf', 'missing', null]) assert.throws(() => selectFont(id, paths), /unavailable/);
    assert.deepEqual(fontPreferences(paths), previous);
    const broken = Buffer.from(bytes); broken.writeUInt32BE(0xfffffff0, 20);
    assert.throws(() => inspectFont(broken), /incomplete/);
    assert.throws(() => inspectFont(bytes.subarray(0, 100)), /incomplete/);
}));

it('falls back to Vazir when a private face disappears or is damaged', () => fixture(paths => {
    importFont(input, paths);
    const file = path.join(paths.directory, fs.readdirSync(paths.directory)[0]);
    fs.writeFileSync(file, 'damaged');
    assert.deepEqual(fontPreferences(paths), { selected: 'vazir', fonts: [], active: null });
    fs.rmSync(file);
    assert.equal(fontPreferences(paths).selected, 'vazir');
    fs.writeFileSync(paths.preferences, '{broken');
    assert.equal(fontPreferences(paths).selected, 'vazir');
}));

it('removes only the requested private copy, preserving the choice until the active copy is removed', () => fixture(paths => {
    const first = importFont(input, paths).selected;
    const second = importFont({ name: 'Bold.ttf', data: bold.toString('base64') }, paths).selected;
    assert.throws(() => removeFont('../font.ttf', paths), /Choose a font/);
    const remaining = removeFont(first, paths);
    assert.equal(remaining.selected, second);
    assert.deepEqual(remaining.fonts.map(font => font.id), [second]);
    assert.deepEqual(fs.readdirSync(paths.directory), [`${second}.ttf`]);
    assert.deepEqual(removeFont(first, paths), remaining, 'a stale deletion can be retried');
    assert.deepEqual(removeFont(second, paths), { selected: 'vazir', fonts: [], active: null });
    assert.deepEqual(fs.readdirSync(paths.directory), []);
    assert.equal(importFont(input, paths).selected, first, 'a removed font can be added again');
}));

it('removes bundled Vazir when a usable custom face remains and protects the last face', () => fixture(paths => {
    assert.throws(() => removeFont('vazir', paths), /Keep at least one font/);
    const first = importFont(input, paths).selected;
    const second = importFont({ name: 'Bold.ttf', data: bold.toString('base64') }, paths).selected;
    assert.equal(removeFont('vazir', paths).selected, second, 'removing inactive Vazir preserves the current choice');
    const remaining = removeFont(second, paths);
    assert.equal(remaining.vazirRemoved, true);
    assert.equal(remaining.selected, first);
    assert.equal(remaining.active.id, first);
    assert.throws(() => selectFont('vazir', paths), /unavailable/);
    assert.throws(() => removeFont(first, paths), /Keep at least one font/);
    assert.deepEqual(fontPreferences(paths), remaining);
    fs.rmSync(path.join(paths.directory, `${first}.ttf`));
    assert.deepEqual(fontPreferences(paths), { selected: 'vazir', fonts: [], active: null });
}));

it('imports, selects and removes via bounded stdin RPC without an installed app', () => fixture((paths, home) => {
    const invoke = (action, payload) => spawnSync(process.execPath, ['bin/gui-service.js', '--rpc', action], {
        input: JSON.stringify(payload), env: { ...process.env, ARTL_CODEX_STATE_HOME: home }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    const imported = invoke('font-import', input);
    assert.equal(imported.status, 0, imported.stderr);
    assert.notEqual(fontPreferences(paths).selected, 'vazir');
    assert.equal(invoke('font-select', { id: 'vazir' }).status, 0);
    assert.equal(fontPreferences(paths).selected, 'vazir');
    assert.notEqual(invoke('font-select', { id: '../bad' }).status, 0);
    assert.equal(fontPreferences(paths).selected, 'vazir');
    const removedVazir = invoke('font-remove', { id: 'vazir' });
    assert.equal(removedVazir.status, 0, removedVazir.stderr);
    assert.equal(JSON.parse(removedVazir.stdout).value.selected, JSON.parse(imported.stdout).value.selected);
    const removed = invoke('font-remove', { id: JSON.parse(imported.stdout).value.selected });
    assert.notEqual(removed.status, 0);
    assert.match(removed.stdout, /Keep at least one font/);
    assert.equal(fs.readdirSync(paths.directory).length, 1);
}));
