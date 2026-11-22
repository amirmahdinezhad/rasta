import { resolveDesktopApp } from '../bin/lib/desktop-apps.js';
import { hostCompatibility } from '../bin/lib/host-compatibility.js';
import { desktopTargets } from '../bin/lib/desktop-adapters.js';

// Optional TARGET=/absolute/App.app arguments select read-only extracted bundles.
const overrides = Object.fromEntries(process.argv.slice(2).map(argument => {
    const split = argument.indexOf('='), target = argument.slice(0, split), app = argument.slice(split + 1);
    if (split < 0 || !desktopTargets.includes(target) || !app.startsWith('/')) throw Error('Use TARGET=/absolute/App.app for a supported desktop target.');
    return [target, app];
}));
console.log(JSON.stringify(desktopTargets.map(target => {
    const bundle = resolveDesktopApp(target, overrides[target]);
    return bundle ? { target, app: bundle.app, version: bundle.version, build: bundle.build,
        adapter: bundle.desktopAdapter, compatibility: hostCompatibility(bundle) } : { target, installed: false };
}), null, 2));
