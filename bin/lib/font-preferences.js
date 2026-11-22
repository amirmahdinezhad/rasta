import fs from 'node:fs';
import { supportPath } from './app-target.js';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

import { inspectFont, MAX_FONT_BYTES, MAX_FONT_LABEL_LENGTH } from './font-names.js';

export { inspectFont, MAX_FONT_BYTES };
export const MAX_CUSTOM_FONTS = 20;
const ID = /^[a-f0-9]{32}$/;

/** Stable user-owned storage, independent of replaceable installer runtimes. */
export function fontPaths(home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) {
    const support = supportPath(home);
    return { preferences: path.join(support, 'font-preferences.json'), directory: path.join(support, 'custom-fonts') };
}

function readPreferences(paths) {
    try {
        const saved = JSON.parse(fs.readFileSync(paths.preferences, 'utf8'));
        if (saved?.schema !== 1 || !Array.isArray(saved.fonts)) return { schema: 1, selected: 'vazir', fonts: [] };
        const fonts = saved.fonts.filter(font => font && typeof font.id === 'string' && ID.test(font.id) && typeof font.file === 'string' && font.file === `${font.id}${path.extname(font.file)}`
            && ['.ttf', '.otf'].includes(path.extname(font.file)) && typeof font.label === 'string' && font.label.length <= MAX_FONT_LABEL_LENGTH);
        return { schema: 1, selected: saved.selected, fonts, ...(saved.vazirRemoved === true && { vazirRemoved: true }) };
    } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        return { schema: 1, selected: 'vazir', fonts: [] };
    }
}

function savePreferences(paths, saved) {
    fs.mkdirSync(path.dirname(paths.preferences), { recursive: true });
    const temporary = `${paths.preferences}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(temporary, paths.preferences);
    } finally { fs.rmSync(temporary, { force: true }); }
}

// Manager and host requests can write the same connection from separate processes.
function editPreferences(paths, edit) {
    const lock = `${paths.preferences}.lock`;
    const owner = `${process.pid}-${randomUUID()}`;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const claim = () => fs.symlinkSync(owner, lock);
    try {
        claim();
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let previous;
        try {
            previous = fs.readlinkSync(lock);
            const pid = Number(previous.split('-')[0]);
            if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, 0);
        } catch (cause) {
            if (cause.code === 'ESRCH') {
                try { if (fs.readlinkSync(lock) === previous) fs.unlinkSync(lock); }
                catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
            } else if (!['ENOENT', 'EPERM'].includes(cause.code)) throw cause;
        }
        try { claim(); }
        catch (cause) {
            if (cause.code !== 'EEXIST') throw cause;
            throw new Error('Another font change is in progress. Try again.', { cause });
        }
    }
    try { return edit(readPreferences(paths)); }
    finally { fs.unlinkSync(lock); }
}

/** List imported faces and return bytes only for the selected face. */
function availableFonts(paths, saved) {
    const fonts = [];
    let active = null, first = null;
    for (const font of saved.fonts) {
        try {
            const file = path.join(paths.directory, font.file);
            if (fs.statSync(file).size > MAX_FONT_BYTES) continue;
            const bytes = fs.readFileSync(file);
            const { label } = inspectFont(bytes);
            if (createHash('sha256').update(bytes).digest('hex').slice(0, 32) !== font.id) continue;
            fonts.push({ id: font.id, label });
            if (!first && saved.vazirRemoved) first = { id: font.id, data: bytes.toString('base64') };
            if (saved.selected === font.id) active = { id: font.id, data: bytes.toString('base64') };
        } catch { /* A missing or damaged custom face must never break the UI. */ }
    }
    active ??= first;
    return { selected: active?.id || 'vazir', fonts, active, ...(first && { vazirRemoved: true }) };
}

export function fontPreferences(paths = fontPaths()) {
    return availableFonts(paths, readPreferences(paths));
}

/** Import a bounded SFNT file and select a private copy; never install OS fonts. */
export function importFont(input, paths = fontPaths()) {
    if (!input || typeof input.name !== 'string' || !/\.(ttf|otf)$/i.test(input.name)
        || typeof input.data !== 'string' || input.data.length > Math.ceil(MAX_FONT_BYTES / 3) * 4
        || input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))
        throw new Error('Choose a valid TTF or OTF font (up to 2 MB).');
    const bytes = Buffer.from(input.data, 'base64'), { label, ext } = inspectFont(bytes);
    const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32), file = `${id}${ext}`;
    return editPreferences(paths, saved => {
        const exists = saved.fonts.some(font => font.id === id);
        if (!exists && saved.fonts.length >= MAX_CUSTOM_FONTS) throw new Error('You can add up to 20 fonts.');
        fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(paths.directory, file), bytes, { mode: 0o600 });
        if (!exists) saved.fonts.push({ id, label, file });
        saved.selected = id;
        savePreferences(paths, saved);
        return availableFonts(paths, saved);
    });
}

/** Keep at least one usable face in the connection's font list. */
export function removeFont(id, paths = fontPaths()) {
    if (typeof id !== 'string' || (id !== 'vazir' && !ID.test(id))) throw new Error('Choose a font to remove.');
    return editPreferences(paths, saved => {
        const available = availableFonts(paths, saved);
        const remaining = available.fonts.filter(font => font.id !== id);
        if (id === 'vazir' ? available.vazirRemoved : !available.fonts.some(font => font.id === id)) return available;
        const vazirRemoved = id === 'vazir' || available.vazirRemoved === true;
        if (vazirRemoved && !remaining.length) throw new Error('Keep at least one font. Add another font first.');
        const next = {
            ...saved,
            vazirRemoved,
            selected: available.selected === id ? (vazirRemoved ? remaining[0].id : 'vazir') : available.selected,
            fonts: saved.fonts.filter(font => font.id !== id),
        };
        savePreferences(paths, next);
        const file = saved.fonts.find(font => font.id === id)?.file;
        if (file) {
            try { fs.rmSync(path.join(paths.directory, file), { force: true }); }
            catch (error) {
                savePreferences(paths, saved);
                throw new Error('The font could not be removed. Try again.', { cause: error });
            }
        }
        return availableFonts(paths, next);
    });
}

/** Select an imported ID or restore bundled Vazir, rejecting arbitrary paths. */
export function selectFont(id, paths = fontPaths()) {
    return editPreferences(paths, saved => {
        const available = availableFonts(paths, saved);
        if (id === 'vazir' ? available.vazirRemoved : !available.fonts.some(font => font.id === id))
            throw new Error('This font is unavailable. Add it again.');
        if (id === available.selected) return available;
        saved.selected = id;
        savePreferences(paths, saved);
        return availableFonts(paths, saved);
    });
}
