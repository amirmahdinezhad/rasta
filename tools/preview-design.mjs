// Preview the host panel using synthetic data.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.slice(2).some(argument => argument !== '--open')) throw new Error('Usage: npm run preview:design -- [--open]');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/design-preview');
execFileSync(process.execPath, [path.join(root, 'tools/build-design-preview.mjs')], { cwd: root, stdio: 'inherit' });
console.log("Review light/dark themes, narrow layouts, controls, focus, text wrapping and response direction.");
if (process.argv.includes('--open')) execFileSync('/usr/bin/open', [path.join(output, 'review.html')]);
