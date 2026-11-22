import { targetId } from './app-target.js';
import { targetDefinition } from './targets.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Locate the retired recovery app for migration and removal. */
export function recoverySetupPath(home = process.env.ARTL_CODEX_STATE_HOME || os.homedir(), target = targetId()) {
    return path.join(home, 'Applications', targetDefinition(target).setup);
}
/** Remove only the recovery entry point installed by Rasta. */
export function removeRecoverySetup(destination = recoverySetupPath(), target = targetId()) {
    const file = path.join(destination, 'Contents/Resources/rasta-recovery');
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === `dev.rasta.${target}.recovery`) fs.rmSync(destination, { recursive: true, force: true });
}
