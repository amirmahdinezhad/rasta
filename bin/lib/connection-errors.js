/** Stable recovery reasons let every interface name the action that can resolve a failure. */
const codes = new Set(['app-update-required', 'rasta-update-required', 'release-check-failed', 'download-failed', 'verification-failed',
    'release-verification-failed', 'app-verification-failed', 'manager-update-required', 'app-not-found', 'app-quit-failed',
    'startup-unconfirmed', 'runtime-unavailable', 'compatibility-check-failed', 'recovery-unavailable', 'keychain-authorization-failed', 'insufficient-disk-space', 'installation-failed', 'removal-failed']);

export const isConnectionError = error => codes.has(error.code);

export function connectionError(code, message, cause) {
    return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

export function connectionFailure(error, fallback = 'installation-failed') {
    // Native tools such as codesign report ENOSPC in stderr and exit with a numeric status.
    const diskFull = error.code === 'ENOSPC' || /\bNo space left on device[ \t]*$/im.test(error.message || '');
    const code = diskFull ? 'insufficient-disk-space' : isConnectionError(error) ? error.code : fallback;
    return { error: error.message, code, ...(error.checkedVersion ? { checkedVersion: error.checkedVersion } : {}) };
}
