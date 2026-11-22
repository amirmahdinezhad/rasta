import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { targetDefinition, targetReleaseConfiguration } from '../bin/lib/targets.js';
import { verifyReleaseEnvelope, releaseNotes as validateReleaseNotes } from '../bin/lib/update-feed.js';

// Release metadata is authenticated by the key pinned in the installed UI,
// independently of GitHub's transport and the local app code signature.
export function signedManifest({ artifact, library, repository, platform, packages = { [platform]: { artifact, library } }, version, supportedAppVersions, blockedAppVersions = [], privateKey, releaseNotes = [], target = 'codex', tag = `v${version}` }) {
    const entries = Object.entries(packages);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !entries.length || entries.some(([id]) => !/^darwin-(arm64|x64)$/.test(id)))
        throw new Error('Invalid release repository or platform.');
    if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`)
        throw new Error('Invalid release tag for this version.');
    const download = file => {
        const bytes = fs.readFileSync(file);
        return { url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(path.basename(file))}`,
            size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    };
    if (targetDefinition(target).available === false) throw new Error('Invalid target.');
    const compact = entries.filter(([, item]) => item.library);
    const manifest = { schema: 1, ...(target !== 'codex' ? { target } : {}), agentVersion: version, supportedAppVersions, ...(blockedAppVersions.length ? { blockedAppVersions } : {}), releaseNotes: validateReleaseNotes(releaseNotes),
        downloads: Object.fromEntries(entries.map(([id, item]) => [id, download(item.artifact)])),
        ...(compact.length ? { libraryDownloads: Object.fromEntries(compact.map(([id, item]) => [id, {
            ...download(item.library.file), engine: item.library.engine,
        }])) } : {}) };
    const payload = Buffer.from(JSON.stringify(manifest));
    const key = createPrivateKey(privateKey);
    const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') };
    const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    for (const [id] of entries) verifyReleaseEnvelope(envelope, publicKey, id, target);
    return { envelope, publicKey };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
    if (!args.includes('--artifact') || !process.env.ARTL_RELEASE_PRIVATE_KEY_FILE) throw new Error('Provide --artifact and ARTL_RELEASE_PRIVATE_KEY_FILE. Never put a private key in command arguments.');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
    const config = JSON.parse(fs.readFileSync(new URL('../bin/release-config.json', import.meta.url)));
    const target = args.includes('--target') ? arg('--target') : 'codex';
    const targetConfig = targetReleaseConfiguration(config, target);
    const result = signedManifest({ artifact: path.resolve(arg('--artifact')), repository: arg('--repo'), platform: arg('--platform'),
        releaseNotes: args.includes('--notes') ? JSON.parse(fs.readFileSync(path.resolve(arg('--notes')), 'utf8')) : [],
        target,
        blockedAppVersions: targetConfig.blockedAppVersions || [],
        version: pkg.version, tag: args.includes('--tag') ? arg('--tag') : undefined, supportedAppVersions: targetConfig.supportedAppVersions, privateKey: fs.readFileSync(process.env.ARTL_RELEASE_PRIVATE_KEY_FILE) });
    if (process.env.ARTL_RELEASE_PUBLIC_KEY !== result.publicKey) throw new Error('The release signing key does not match the key embedded in the setup build.');
    const output = path.resolve(args.includes('--output') ? arg('--output') : `dist/${targetDefinition(target).feed}`);
    fs.writeFileSync(output, JSON.stringify(result.envelope, null, 2) + '\n'); console.log(output);
}
