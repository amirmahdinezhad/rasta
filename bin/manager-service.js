import fs from 'node:fs';
import { connectionFailure } from './lib/connection-errors.js';
import { savedConnectionStates, managerStatus, downloadConnection, manageConnection, removeConnections, checkConnection, downloadManagerUpdate, installManagerUpdate, managerPaths, scanConnections, launchConnection, cancelConnection, managerPreferences, changeConnectionPreferences } from './lib/manager.js';
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const main = async () => {
    const { action, target } = request;
    if (action === 'status') return managerStatus();
    if (action === 'check') { const { manifest } = await checkConnection(target); return { version: manifest.agentVersion }; }
    if (action === 'download') return downloadConnection(target);
    if (action === 'launch') return launchConnection(target, request.job);
    if (action === 'cancel') return cancelConnection(target, request.job);
    if (action === 'preferences') return managerPreferences(target);
    if (['font-import', 'font-select', 'font-remove', 'reading-save'].includes(action)) return changeConnectionPreferences(target, action, request.input);
    if (action === 'recover') return manageConnection(target, action, { fingerprint: request.fingerprint });
    if (action === 'install') return manageConnection(target, action, { bundled: request.bundled === true });
    if (['repair', 'remove'].includes(action)) return manageConnection(target, action);
    if (action === 'core-check') { const { manifest } = await checkConnection('manager'); return { version: manifest.agentVersion }; }
    if (action === 'core-update') return downloadManagerUpdate();
    if (action === 'core-install') return installManagerUpdate(request.managerApp, request.parentPid);
    if (action === 'remove-connections') return removeConnections();
    if (action === 'remove-data') {
        if (scanConnections().some(item => item.installed)) throw Error('Remove Rasta from each app in Library before deleting its local data.');
        if (savedConnectionStates().length) throw Error('A previous Rasta installation still needs removal. Open its recovery Setup and finish removal before clearing Rasta data.');
        fs.rmSync(managerPaths().support, { recursive: true, force: true });
        return { removeSelf: true, message: 'Rasta settings and downloaded packages have been deleted. The Rasta app will now move to Trash.' };
    }
    throw Error('Unknown Rasta operation.');
};
main().then(value => process.stdout.write(JSON.stringify({ ok: true, value }))).catch(error => { process.stdout.write(JSON.stringify({ ok: false, ...connectionFailure(error) })); process.exitCode = 1; });
