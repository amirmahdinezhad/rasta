import { compareVersions } from './update-feed.js';
import { agentVersion } from './gui-runtime.js';

/** Plan installation for the installed host and the authenticated release. */
export function planInstallation(config, appVersion, appUpdate, release, releaseConfig) {
    const baseline = config.agentVersion || agentVersion;
    const canOfferRelease = !config.initialInstall && !config.setupInstall;
    const available = canOfferRelease && release && (compareVersions(release.agentVersion, baseline) > 0 || (config.patchMissing && config.verifiedReleaseVersion !== release.agentVersion && compareVersions(release.agentVersion, baseline) === 0)) ? release : null;
    const versions = available?.supportedAppVersions || releaseConfig?.supportedAppVersions || [];
    const interactive = ['download-install', 'download-launch'].includes(config.flow);
    if (interactive) {
        // A verified newer engine may repair an adapter the current engine cannot understand.
        // It must repeat all local checks before staging or requesting quit.
        const supported = config.compatibility?.compatible === true || Boolean(available);
        return { release: available, available: Boolean(available), supported, targetVersion: appVersion, requiresAppUpdate: false,
            compatibility: config.compatibility || { compatible: false, status: 'unchecked', message: 'Local compatibility checks are required.' },
            phase: !supported ? 'needs-compatible-release' : available ? 'available' : 'up-to-date' };
    }
    const targetVersion = appUpdate?.version || appVersion;
    const supported = versions.includes(targetVersion);
    const hasUpdate = Boolean(appUpdate || available);
    return { release: available, available: hasUpdate, supported, targetVersion, requiresAppUpdate: false,
        phase: !supported ? 'needs-compatible-release' : hasUpdate ? 'available' : 'up-to-date' };
}
