import { resolveCodexApp } from './codex.js';
import { resolveT3App } from './t3.js';
import { resolveGoogleApp } from './google-apps.js';
import { targetDefinition } from './targets.js';
import { resolveDesktopApp } from './desktop-apps.js';
import { desktopTargets } from './desktop-adapters.js';

/** Discover only the selected host, never another installed connection. */
export function resolveConnectionApp(id, { discoverOnly = false } = {}) {
    targetDefinition(id);
    return id === 'codex' ? resolveCodexApp() : id === 't3' ? resolveT3App() : desktopTargets.includes(id) ? resolveDesktopApp(id, null, { discoverOnly }) : resolveGoogleApp(id);
}
