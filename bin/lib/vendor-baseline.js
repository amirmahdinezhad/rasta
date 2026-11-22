import { execFileSync } from 'node:child_process';
import path from 'node:path';

const archiveResource = 'Resources/app.asar';
const requirement = '=identifier "dev.zcode.app" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "8A5X4JJ39T"';

export function verifyZCodeVendorArchive(bundle, { run = execFileSync } = {}) {
    if (bundle.target !== 'zcode' || bundle.archive !== path.join(bundle.app, 'Contents', archiveResource))
        throw Error('Unexpected ZCode archive location.');
    const resources = path.join(bundle.app, 'Contents/_CodeSignature/CodeResources');
    const seal = run('/usr/bin/plutil', ['-extract', 'files2.Resources/app\\.asar.hash2', 'raw', '-expect', 'data', '-o', '-', resources], { encoding: 'utf8', stdio: 'pipe' });
    if (!/^[A-Za-z0-9+/]{43}=$/.test(seal.trim())) throw Error('ZCode does not have a SHA-256 resource seal for app.asar.');
    // Strict verification authenticates the resource envelope and the full ASAR it seals.
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, bundle.app], { stdio: 'pipe' });
}

/** Use the signed archive as the baseline when ZCode ships stale header metadata. */
export function verifyArchiveBaseline(bundle, dictionary, headerHash, slots, { run = execFileSync } = {}) {
    const metadata = dictionary?.[archiveResource];
    if (metadata?.algorithm !== 'SHA256' || !/^[a-f0-9]{64}$/i.test(metadata.hash)) throw Error('Missing or unsupported ASAR integrity metadata.');
    if (metadata.hash === headerHash) return { vendorMetadataReconciled: false };
    if (bundle.target !== 'zcode' || slots.length !== 0) throw Error('Archive integrity does not match.');
    verifyZCodeVendorArchive(bundle, { run });
    return { vendorMetadataReconciled: true };
}
