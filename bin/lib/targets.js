/** Stable identities shared by discovery, state ownership and package verification. */
export const targets = Object.freeze({
    codex: Object.freeze({ id: 'codex', name: 'Codex', packageName: 'openai-codex-electron', support: 'Rasta', setup: 'Rasta Setup.app', feed: 'rasta-release.json' }),
    t3: Object.freeze({ id: 't3', name: 'T3 Code', packageName: 't3code', support: 'Rasta T3', setup: 'Rasta T3 Setup.app', feed: 'rasta-t3-release.json' }),
    antigravity: Object.freeze({ id: 'antigravity', name: 'Antigravity', packageName: 'antigravity', bundleId: 'com.google.antigravity', support: 'Rasta Antigravity', setup: 'Rasta Antigravity Setup.app', feed: 'rasta-antigravity-release.json' }),
    claude: Object.freeze({ id: 'claude', name: 'Claude', packageName: '@ant/desktop', bundleId: 'com.anthropic.claudefordesktop', support: 'Rasta Claude', setup: 'Rasta Claude Setup.app', feed: 'rasta-claude-release.json' }),
    opencode: Object.freeze({ id: 'opencode', name: 'OpenCode', packageName: '@opencode-ai/desktop', alternatePackageName: '@opencode/desktop', bundleId: 'ai.opencode.desktop', support: 'Rasta OpenCode', setup: 'Rasta OpenCode Setup.app', feed: 'rasta-opencode-release.json' }),
    zcode: Object.freeze({ id: 'zcode', name: 'ZCode', packageName: '@zcode/desktop', bundleId: 'dev.zcode.app', support: 'Rasta ZCode', setup: 'Rasta ZCode Setup.app', feed: 'rasta-zcode-release.json' }),
    grokbot: Object.freeze({ id: 'grokbot', name: 'Grok Bot', packageName: 'sand', bundleId: 'com.anysphere.sand', support: 'Rasta Grok Bot', setup: 'Rasta Grok Bot Setup.app', feed: 'rasta-grokbot-release.json' }),
    gemini: Object.freeze({ id: 'gemini', name: 'Gemini', bundleId: 'com.google.GeminiMacOS', support: 'Rasta Gemini', setup: 'Rasta Gemini Setup.app', feed: 'rasta-gemini-release.json' }),
});

/** Reject unknown targets rather than silently operating on Codex. */
export function targetDefinition(id) {
    if (!Object.hasOwn(targets, id)) throw Error('Unknown connection.');
    return targets[id];
}

export function matchesPackageName(target, name) {
    return name === target.packageName || Boolean(target.alternatePackageName && name === target.alternatePackageName);
}

/** Bind a runtime to its own feed; an unpublished adapter has no fallback feed. */
export function targetReleaseConfiguration(config, id) {
    const target = targetDefinition(id);
    if (target.available === false) throw Error(target.reason);
    if ((config.target || 'codex') === id) return config;
    const prefix = id === 't3' ? 'T3' : target.name.replaceAll(' ', '');
    return { ...config, target: id, feedUrl: config[`${id}FeedUrl`] || null,
        supportedAppVersions: config[`supported${prefix}Versions`] || [], blockedAppVersions: config[`blocked${prefix}Versions`] || [] };
}
