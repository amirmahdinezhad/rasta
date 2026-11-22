// Remove reproducible previews and intermediates while preserving candidates and QA evidence.
import fs from 'node:fs';

for (const path of ['dist/design-preview', 'dist/manager-ui', 'bin/assets/rasta-ui']) {
    fs.rmSync(new URL('../' + path, import.meta.url), { recursive: true, force: true });
}
console.log('Removed rebuildable previews and the generated helper.');
