import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { save } from './development-release.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [mode, reportFile] = process.argv[2] === '--local' ? ['local', process.argv[3]] : ['release', process.argv[2]];
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options });
const checks = [
    ['npm', 'run', 'security:check'],
    ['npm', 'run', 'test:language'],
    ['node', '--test', '--test-concurrency=1', 'test/*.test.js'],
    ['npm', 'run', 'test:security'],
    ['npm', '--prefix', 'ui/manager', 'run', 'typecheck'],
    ['npm', 'run', 'test:manager-production'],
    ['npm', 'run', 'build:panel-ui'],
    ...(mode === 'release' ? [['git', 'diff', '--exit-code', 'HEAD', '--', 'bin/panel/panel.js']] : []),
    ['npm', 'run', 'test:gui'],
    ['node', 'test/gui-electron-smoke.mjs'],
    ['npm', 'run', 'test:desktop'],
    ['npm', 'run', 'test:antigravity'],
    ['npm', 'run', 'test:gemini'],
];
for (const [command, ...args] of checks) {
    const t3 = args[0] === 'test/gui-electron-smoke.mjs';
    run(command, args, { env: { ...process.env, ARTL_TARGET: 'codex', ARTL_TEST_TARGET: t3 ? 't3' : 'codex' } });
}
if (reportFile) {
    const capture = (file, args) => run(file, args, { encoding: 'utf8', stdio: 'pipe' }).trim();
    save(reportFile, {
        sourceCommit: capture('git', ['rev-parse', 'HEAD']),
        checkedAt: new Date().toISOString(),
        node: process.version,
        npm: capture('npm', ['--version']),
        gitleaks: capture('gitleaks', ['version']),
        checks: checks.map(check => check.join(' ')),
        result: 'passed',
    });
}
