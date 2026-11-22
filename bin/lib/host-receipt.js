import fs from 'node:fs';
import path from 'node:path';
import * as asar from '@electron/asar';

/** Read the receipt from the selected host's own integration format. */
export function hostReceipt(bundle) {
    if (bundle.target === 'gemini') return JSON.parse(fs.readFileSync(path.join(bundle.app, 'Contents/Resources/rasta/host.json'), 'utf8'));
    const archive = bundle.archive || path.join(bundle.app, 'Contents/Resources/app.asar');
    asar.uncache(archive);
    return JSON.parse(asar.extractFile(archive, 'rasta/host.json'));
}
