// Probe a trusted candidate's own installation policy without changing app or saved GUI state.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [runtime, app] = process.argv.slice(2);
const load = file => import(pathToFileURL(path.join(runtime, 'bin/lib', file)).href);
try {
    const { resolveGUIApp, updatePlan, releaseConfiguration } = await load('gui-updates.js');
    const bundle = resolveGUIApp(app), catalog = releaseConfiguration();
    // Older T3 engines use a tested-version policy; ask that policy rather than
    // assuming that a newer manager's adapter describes the older engine.
    let compatibility;
    if (fs.existsSync(path.join(runtime, 'bin/lib/host-compatibility.js'))) {
        const { hostCompatibility } = await load('host-compatibility.js');
        compatibility = hostCompatibility(bundle, { testedVersions: catalog.supportedAppVersions, blockedVersions: catalog.blockedAppVersions });
    } else if ((catalog.target || 'codex') === 'codex') {
        const { codexCompatibility } = await load('codex-compatibility.js');
        compatibility = codexCompatibility(bundle, { testedVersions: catalog.supportedAppVersions, blockedVersions: catalog.blockedAppVersions });
    }
    const plan = updatePlan({ flow: 'download-launch', setupInstall: true, initialInstall: true, compatibility }, bundle.version, null, null, catalog);
    console.log(JSON.stringify({ supported: plan.supported === true && !plan.requiresAppUpdate, requiresAppUpdate: plan.requiresAppUpdate === true,
        targetVersion: plan.targetVersion, compatibility: plan.compatibility || compatibility,
        agentVersion: JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'))).version }));
} catch (error) {
    console.log(JSON.stringify({ supported: false, code: 'compatibility-check-failed', error: error.message }));
    process.exitCode = 1;
}
