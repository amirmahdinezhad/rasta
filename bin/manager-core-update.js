import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

function removePreparedUpdates(request, remove) {
    const folder = path.dirname(request.app);
    const support = path.dirname(request.status);
    const stats = fs.lstatSync(folder);
    const preparedFile = path.join(support, 'core-prepared.json');
    let prepared;
    try { prepared = JSON.parse(fs.readFileSync(preparedFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (prepared?.app === request.app) remove(preparedFile);
    for (const entry of fs.readdirSync(support, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^core-update-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
        const candidate = path.join(support, entry.name);
        if (candidate !== folder && path.join(candidate, 'Rasta.app') !== prepared?.app &&
            fs.lstatSync(candidate).birthtimeMs < stats.birthtimeMs) remove(candidate);
    }
    remove(folder);
}

/** Replace only the manager after its window exits, retaining a verified rollback bundle. */
export async function runManagerUpdate(request, {
    run = (command, args) => execFileSync(command, args, { stdio: 'pipe' }),
    alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } },
    pause = delay, installer,
} = {}) {
    const staging = path.join(path.dirname(request.destination), `.Rasta-update-${randomUUID()}.app`);
    const backup = path.join(path.dirname(request.destination), `.Rasta-previous-${randomUUID()}.app`);
    let moved = false, installed = false, complete = false;
    const publish = value => {
        const temporary = request.status + '.tmp'; fs.writeFileSync(temporary, JSON.stringify({ version: request.version, ...value })); fs.renameSync(temporary, request.status);
    };
    try {
        const deadline = Date.now() + 30000;
        while (true) {
            if (!alive(request.parentPid)) break;
            if (Date.now() >= deadline) throw Error('Rasta did not close. Try the update again.');
            await pause(150);
        }
        publish({ phase: 'installing', progress: 1 });
        run('/usr/bin/ditto', [request.app, staging]);
        run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staging]);
        const info = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(staging, 'Contents/Info.plist')]));
        const original = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(request.destination, 'Contents/Info.plist')]));
        if (original.CFBundleIdentifier !== 'dev.rasta.manager' || info.CFBundleIdentifier !== original.CFBundleIdentifier || info.CFBundleShortVersionString !== request.version) throw Error('The Rasta update identity changed.');
        fs.renameSync(request.destination, backup); moved = true;
        fs.renameSync(staging, request.destination); installed = true;
        run('/usr/bin/open', [request.destination]);
        publish({ phase: 'complete', progress: 1 });
        complete = true;
    } catch (error) {
        if (moved) {
            if (installed) fs.rmSync(request.destination, { recursive: true, force: true });
            fs.renameSync(backup, request.destination);
        }
        publish({ phase: 'failed', error: error.message });
        try { run('/usr/bin/open', [request.destination]); } catch {}
    } finally {
        const warnings = [];
        const attempt = callback => {
            try { callback(); } catch (error) { warnings.push(error.message); }
        };
        const remove = file => attempt(() => fs.rmSync(file, { recursive: true, force: true }));
        if (complete) {
            remove(backup);
            attempt(() => removePreparedUpdates(request, remove));
        }
        remove(staging);
        if (installer) remove(installer);
        if (complete && warnings.length) {
            publish({ phase: 'complete', progress: 1, cleanupWarning: warnings.join('\n') });
        }
    }

}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const file = process.argv[2];
    await runManagerUpdate(JSON.parse(fs.readFileSync(file, 'utf8')), { installer: path.dirname(file) });
}
