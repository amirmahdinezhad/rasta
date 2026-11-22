import { resolveGoogleApp } from '../bin/lib/google-apps.js';
import { hostCompatibility } from '../bin/lib/host-compatibility.js';

// Read-only diagnosis: no app launch, install, data adoption or network access.
const report = ['antigravity', 'gemini'].map(target => {
    const bundle = resolveGoogleApp(target);
    return bundle ? { target, app: bundle.app, version: bundle.version, build: bundle.build,
        adapter: bundle.native ? 'native-core-text' : bundle.injection, compatibility: hostCompatibility(bundle) }
        : { target, installed: false };
});
console.log(JSON.stringify(report, null, 2));
