import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// These paths are identical in the manager and every connection built with it.
const enginePaths = [
    'node', 'node-LICENSE', 'node_modules', 'bin/assets/Vazir-Bold.ttf',
    'bin/assets/Vazir-OFL.txt', 'bin/assets/Vazir-Regular.ttf', 'bin/assets/Vazir-Regular.woff2',
];

export const libraryPackageDirectory = runtime => path.resolve(runtime, '../library-packages');
export const libraryPackagePath = (runtime, target) => path.join(libraryPackageDirectory(runtime), `${target}.zip`);

export function connectionEngineId(runtime) {
    const digest = createHash('sha256');
    function add(relative) {
        const file = path.join(runtime, relative), info = fs.lstatSync(file);
        if (info.isDirectory()) {
            digest.update(JSON.stringify([relative, 'directory']) + '\n');
            for (const child of fs.readdirSync(file).sort()) add(`${relative}/${child}`);
        } else if (info.isFile()) {
            const bytes = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
            digest.update(JSON.stringify([relative, info.mode & 0o111, bytes]) + '\n');
        } else throw Error('Invalid file in the Rasta connection engine.');
    }
    for (const relative of enginePaths) add(relative);
    return digest.digest('hex');
}

function hasEngine(runtime, id) {
    try { return connectionEngineId(runtime) === id; }
    catch { return false; }
}

function copyEngine(source, destination) {
    for (const relative of enginePaths) {
        const to = path.join(destination, relative);
        if (fs.lstatSync(to, { throwIfNoEntry: false })) throw Error('Unexpected engine file in the compact Rasta package.');
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.cpSync(path.join(source, relative), to, {
            recursive: true, force: false, errorOnExist: true, mode: fs.constants.COPYFILE_FICLONE,
        });
    }
}

export function omitConnectionEngine(runtime) {
    for (const relative of enginePaths) fs.rmSync(path.join(runtime, relative), { recursive: true });
}

export function restoreConnectionEngine(runtime, engine) {
    copyEngine(engine, runtime);
}

/** Keep immutable, content-addressed versions available to future offline operations. */
export function cachedConnectionEngine(cache, id, source) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid Rasta connection engine identity.');
    const destination = path.join(cache, id);
    if (hasEngine(destination, id)) return destination;
    if (!hasEngine(source, id)) return null;
    fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
    const stage = fs.mkdtempSync(path.join(cache, '.engine-'));
    try {
        copyEngine(source, stage);
        if (!hasEngine(stage, id)) return null;
        try { fs.renameSync(stage, destination); }
        catch (error) {
            if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
            // Another download may have published the same engine while we copied it.
            return hasEngine(destination, id) ? destination : source;
        }
        return destination;
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

function ownerOf(lock) {
    try { return fs.readlinkSync(lock); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

function ownerAlive(owner) {
    const pid = Number(owner.split('-')[0]);
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
}

/** Serialize cold downloads for one engine across Library requests and service processes. */
export async function acquireConnectionEngine(cache, id, source) {
    const local = cachedConnectionEngine(cache, id, source);
    if (local) return { runtime: local };
    fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
    const lock = path.join(cache, `.download-${id}`), owner = `${process.pid}-${randomUUID()}`;
    const signal = AbortSignal.timeout(360000);
    while (true) {
        const runtime = cachedConnectionEngine(cache, id);
        if (runtime) return { runtime };
        try { fs.symlinkSync(owner, lock); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const previous = ownerOf(lock);
            if (previous && !ownerAlive(previous) && ownerOf(lock) === previous) fs.rmSync(lock, { force: true });
            await delay(150, undefined, { signal });
            continue;
        }
        return { runtime: cachedConnectionEngine(cache, id),
            release: () => { if (ownerOf(lock) === owner) fs.rmSync(lock, { force: true }); } };
    }
}
