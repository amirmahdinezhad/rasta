import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options });
for (const args of [[], ['--prefix', 'ui/manager']]) {
    run('npm', [...args, 'audit', '--audit-level=low'], {
        env: { ...process.env, npm_config_omit: '', npm_config_include: 'dev' },
    });
}
run('gitleaks', ['version']);

const scan = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-secret-scan-'));
try {
    const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', stdio: 'pipe' });
    for (const file of new Set(files.split('\0').filter(Boolean))) {
        const source = path.join(root, file);
        if (!fs.lstatSync(source, { throwIfNoEntry: false })?.isFile()) continue;
        const destination = path.join(scan, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
    }
    const options = ['--config', path.join(root, '.gitleaks.toml'), '--redact=100', '--no-banner'];
    run('gitleaks', ['dir', ...options, scan]);
    run('gitleaks', ['git', ...options, '--gitleaks-ignore-path', path.join(root, '.gitleaksignore'), '--log-opts=--all', root]);
} finally {
    fs.rmSync(scan, { recursive: true, force: true });
}
