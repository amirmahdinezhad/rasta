// Browser-only fixtures. No native bridge, service, host files or release feed is used.
import { inspectFont } from '../../bin/lib/font-names.js';
import readingDefaults from '../../bin/assets/reading-defaults.json';
export { readingDefaults };

(() => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const preview = new URLSearchParams(location.search).get('preview');
    const claudeRecovery = preview === 'claude-recovery';
    const zcodeRecovery = preview === 'zcode-recovery';
    const previewLoading = preview === 'loading';
    const localTest = preview === 'local-test';
    let firstStatus = true;
    const storageKey = 'rasta-manager-preview-v6' + (claudeRecovery || zcodeRecovery || localTest ? '-' + preview : '');
    const coreCandidate = '1.1.38';
    const initial = () => ({
        version: '1.1.37', localTest,
        apps: [
            {
                id: 'codex', name: 'Codex', app: '/Preview/Codex.app', hostVersion: '26.1103.41825', installed: true, version: '1.1.36',
                compatibility: { compatible: true, tested: false, status: 'unverified', message: 'This Codex version has not been fully tested. Local compatibility checks passed; reading support still needs to be checked inside the app.' },
            },
            { id: 'antigravity', name: 'Antigravity', app: '/Preview/Antigravity.app', hostVersion: '2.29.1', installed: false, version: null },
            {
                id: 'claude', name: 'Claude', app: '/Preview/Claude.app', hostVersion: claudeRecovery ? '6.28899.2' : '4.4212.0', installed: false, version: null,
                ...(claudeRecovery && { cachedVersion: '1.1.37', recovery: { version: '1.1.37', fingerprint: crypto.randomUUID() }, autoRecovery: true }),
            },
            { id: 'opencode', name: 'OpenCode', app: '/Preview/OpenCode.app', hostVersion: '1.19.5', installed: false, version: null },
            {
                id: 'zcode', name: 'ZCode', app: '/Preview/ZCode.app', hostVersion: zcodeRecovery ? '3.18.2' : '3.17.2', installed: false, version: null,
                ...(zcodeRecovery && { cachedVersion: '1.1.37', recovery: { version: '1.1.37', fingerprint: crypto.randomUUID() }, autoRecovery: true }),
            },
            { id: 'gemini', name: 'Gemini', app: '/Preview/Gemini.app', hostVersion: '1.141.3.1394', installed: false, version: null,
                compatibility: { compatible: true, tested: false, status: 'unverified', message: 'Local native compatibility checks passed. Reading support still needs to be checked inside Gemini after Launch.' } },
            { id: 'grokbot', name: 'Grok Bot', app: '/Preview/Grok Bot.app', hostVersion: '0.79.3', installed: false, version: null },
            { id: 't3', name: 'T3 Code', app: '/Preview/T3 Code.app', hostVersion: '0.1.8', installed: false, version: null, compatibility: { compatible: true, tested: false, status: 'unverified' } },
        ].map(app => localTest ? {
            ...app,
            ...(app.id === 'claude' && { installed: true, version: '1.1.37' }),
            localTestBuildAvailable: true,
        } : app),
        preferences: Object.fromEntries(['codex', 't3', 'antigravity', 'claude', 'opencode', 'zcode', 'grokbot', 'gemini'].map(id => [id, { selected: 'vazir', fonts: [], active: null, reading: { ...readingDefaults } }])),
        failDownload: false,
        scenario: 'normal',
    });
    let state; try { state = JSON.parse(sessionStorage.getItem(storageKey)) || initial(); } catch { state = initial(); }
    // A reloaded preview cannot keep a timer-driven operation in progress.
    for (const app of state.apps) { if (app.operation && !['complete', 'failed', 'cancelled'].includes(app.operation.phase)) delete app.operation; if (app.download?.phase !== 'failed') delete app.download; }
    if (state.removal?.phase === 'removing') delete state.removal;
    if (['downloading', 'verifying', 'installing'].includes(state.coreUpdate?.phase)) delete state.coreUpdate;
    const save = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch {} };
    const readingKey = id => 'rasta-preview-reading-' + id;
    const previewReading = id => ({ ...readingDefaults, ...JSON.parse(localStorage.getItem(readingKey(id)) || '{}') });
    for (const [id, preferences] of Object.entries(state.preferences)) preferences.reading = previewReading(id);
    const fontKey = id => `${storageKey}-fonts-${id}`;
    const selectPreviewFont = (pref, selected) => {
        pref.active = pref.fonts.find(font => font.id === selected) || (pref.vazirRemoved ? pref.fonts[0] : null) || null;
        pref.selected = pref.active?.id || 'vazir';
    };
    const savePreviewFonts = (id, pref) => {
        localStorage.setItem(fontKey(id), JSON.stringify({ selected: pref.selected, fonts: pref.fonts, vazirRemoved: pref.vazirRemoved }));
        return copy(pref);
    };
    const copy = value => structuredClone(value);
    const job = () => ({ id: crypto.randomUUID(), phase: 'preparing', progress: 0, action: 'install', startedAt: Date.now() });
    const removable = app => app.installed || (!app.recovery && app.operation?.phase === 'ready-to-install');
    window.rastaPreview = async request => {
        const app = state.apps.find(app => app.id === request.target), pref = state.preferences[request.target];
        if (request.action === 'status') {
            if (previewLoading && firstStatus) await delay(3000);
            firstStatus = false;
            return copy(state);
        }
        if (app?.available === false) throw Error(`Rasta installation is not available for ${app.name} yet.`);
        if (request.action === 'core-check') {
            await delay(500);
            return { version: state.offerCoreUpdate ? coreCandidate : state.version };
        }
        if (request.action === 'core-update') {
            const update = { phase: 'downloading', version: coreCandidate, progress: 0 };
            state.coreUpdate = update;
            for (let step = 0; step <= 20; step++) {
                update.progress = step / 20;
                await delay(180);
                if (state.failDownload && step === 7) {
                    update.phase = 'failed';
                    save();
                    throw Error('Simulated download interrupted.');
                }
            }
            update.phase = 'verifying';
            await delay(900);
            update.phase = 'ready';
            save();
            return { ready: true };
        }
        if (request.action === 'core-install') {
            const update = state.coreUpdate;
            if (update?.phase !== 'ready') throw Error('Download a simulated update first.');
            update.phase = 'installing';
            await delay(650);
            state.version = update.version;
            update.phase = 'complete';
            state.offerCoreUpdate = false;
            save();
            return { restarting: true };
        }
        if (request.action === 'check') {
            await delay(900);
            if (app?.id === 't3' && state.scenario === 'offline') throw Object.assign(Error('Simulated update check failed.'), { code: 'release-check-failed' });
            return { version: '1.1.37' };
        }
        if (pref) {
            pref.reading = previewReading(request.target);
            const savedFonts = JSON.parse(localStorage.getItem(fontKey(request.target)) || 'null');
            if (savedFonts) {
                pref.fonts = savedFonts.fonts;
                pref.vazirRemoved = savedFonts.vazirRemoved === true && pref.fonts.length > 0;
                selectPreviewFont(pref, savedFonts.selected);
            }
        }
        if (request.action === 'preferences') {
            if (previewLoading) await delay(3000);
            return copy(state.preferences[request.target]);
        }
        if (request.action === 'reading-save') { Object.assign(pref.reading, request.input); localStorage.setItem(readingKey(request.target), JSON.stringify(pref.reading)); save(); return copy(pref); }
        if (request.action === 'font-import') {
            const bytes = Uint8Array.from(atob(request.input.data), character => character.charCodeAt(0));
            const { label } = inspectFont(bytes);
            const existing = pref.fonts.find(font => font.data === request.input.data);
            const id = existing?.id ?? crypto.randomUUID().replaceAll('-', '');
            try { await new FontFace('RastaUser_' + id, bytes).load(); }
            catch { throw Error('Choose a valid TTF or OTF font (up to 2 MB).'); }
            const font = { id, label, data: request.input.data };
            if (existing) existing.label = label;
            else pref.fonts.push(font);
            selectPreviewFont(pref, id);
            return savePreviewFonts(request.target, pref);
        }
        if (request.action === 'font-remove') {
            const id = request.input?.id;
            if (typeof id !== 'string' || !/^(vazir|[a-f0-9]{32})$/.test(id)) throw Error('Choose a font to remove.');
            const fonts = pref.fonts.filter(font => font.id !== id);
            const vazirRemoved = pref.vazirRemoved || id === 'vazir';
            if (vazirRemoved && !fonts.length) throw Error('Keep at least one font. Add another font first.');
            pref.vazirRemoved = vazirRemoved;
            pref.fonts = fonts;
            selectPreviewFont(pref, pref.selected);
            return savePreviewFonts(request.target, pref);
        }
        if (request.action === 'font-select') {
            const id = request.input?.id;
            if (id === 'vazir' ? pref.vazirRemoved : !pref.fonts.some(font => font.id === id))
                throw Error('This font is unavailable. Add it again.');
            selectPreviewFont(pref, request.input.id);
            return savePreviewFonts(request.target, pref);
        }
        if (request.action === 'download') {
            const startedAt = Date.now();
            app.download = { phase: 'checking', progress: 0, startedAt }; await delay(750);
            const bundled = !state.failDownload && state.scenario !== 'verification';
            if (!bundled) {
                const total = 680000;
                for (let n = 0; n <= 20; n++) {
                    app.download = { phase: 'downloading', total, downloaded: total * n / 20, progress: n / 20, startedAt }; await delay(180);
                    if (state.failDownload && n === 7) { app.download = { phase: 'failed', startedAt, code: 'download-failed', error: 'Simulated download interrupted. Turn off Download error in preview tools to retry.' }; throw Object.assign(Error(app.download.error), { code: app.download.code }); }
                }
            }
            app.download = { phase: 'verifying', progress: 1, startedAt }; await delay(650);
            if (app.id === 't3' && state.scenario === 'verification') {
                app.download = { phase: 'failed', code: 'verification-failed', error: 'Simulated invalid package signature.' };
                throw Object.assign(Error(app.download.error), { code: app.download.code });
            }
            app.cachedVersion = '1.1.37'; app.download = { phase: 'downloaded', progress: 1, startedAt }; save(); return { version: '1.1.37' };
        }
        if (request.action === 'install' || request.action === 'repair' || request.action === 'recover') {
            if (request.action === 'recover') {
                if (app.recovery?.fingerprint !== request.fingerprint) throw Error('The simulated app changed.');
                app.autoRecovery = false;
            }
            if (app.id === 't3' && ['app-update', 'rasta-update', 'offline'].includes(state.scenario)) {
                const failed = scenarios[state.scenario];
                app.download = { phase: 'failed', ...failed };
                throw Object.assign(Error(failed.error), { code: failed.code });
            }
            if (!app.cachedVersion || app.cachedVersion === '1.1.16' || state.failDownload) await window.rastaPreview({ action: 'download', target: app.id });
            const operation = job();
            app.operation = operation;
            void (async () => {
                for (const step of ['verifying-app', 'preparing-files', 'signing-app', 'verifying-copy']) {
                    if (app.operation !== operation) return;
                    operation.preparationStep = step;
                    await delay(650);
                }
                if (app.operation === operation) Object.assign(operation, { phase: 'ready-to-install', progress: 1 });
            })();
            return { id: operation.id, inline: true };
        }
        if (request.action === 'cancel') { if (app.operation?.id !== request.job) throw Error('This demo job is no longer active.'); app.operation.phase = 'cancelled'; save(); return {}; }
        if (request.action === 'launch') {
            if (app.operation?.id !== request.job || app.operation.phase !== 'ready-to-install') throw Error('Prepare the simulated Rasta installation first.');
            const operation = app.operation;
            const phases = ['quitting', 'waiting-for-quit', 'installing', 'reopening'];
            if (['t3', 'claude', 'zcode'].includes(app.id)) phases.unshift('authorizing-keychain');
            for (const phase of phases) {
                if (app.operation !== operation || operation.phase === 'cancelled') return {};
                operation.phase = phase;
                await delay(phase === 'waiting-for-quit' ? 1800 : 700);
            }
            if (app.operation !== operation || operation.phase === 'cancelled') return {};
            app.installed = true; app.version = '1.1.37'; delete app.recovery;
            if (localTest) app.localTestBuildAvailable = false;
            app.operation.phase = 'complete'; save(); return {};
        }
        if (request.action === 'remove') {
            if (!removable(app)) throw Error('There is no simulated installation to remove.');
            const phases = app.installed ? ['quitting', 'waiting-for-quit', 'installing'] : ['installing'];
            app.operation = { id: crypto.randomUUID(), action: 'restore', phase: phases[0], progress: 1, startedAt: Date.now() };
            for (const phase of phases) { app.operation.phase = phase; await delay(600); }
            app.installed = false; app.version = null;
            delete app.cachedVersion; delete app.download;
            if (localTest) app.localTestBuildAvailable = true;
            app.operation = { ...app.operation, phase: 'complete', restored: true }; localStorage.removeItem(readingKey(app.id)); state.preferences[app.id] = initial().preferences[app.id]; save(); return { id: app.operation.id };
        }
        if (request.action === 'remove-connections') {
            const removal = { startedAt: Date.now(), phase: 'removing', apps: state.apps.filter(removable).map(({ id, name }) => ({ id, name, phase: 'queued' })) };
            state.removal = removal;
            for (const item of removal.apps) {
                item.phase = 'removing';
                await window.rastaPreview({ action: 'remove', target: item.id });
                item.phase = 'complete';
            }
            removal.phase = 'complete'; save(); return copy(removal);
        }
        if (request.action === 'remove-data') { for (const id of Object.keys(state.preferences)) localStorage.removeItem(readingKey(id)); state = initial(); save(); return { message: 'Demo data reset. No installed applications were changed.' }; }
        throw Error('This action is not available in the browser preview.');
    };
    const scenarios = {
        'app-update': { code: 'app-update-required', error: 'Update T3 Code to 0.1.8 using its own updater, then return to Rasta and check again.' },
        'rasta-update': { code: 'rasta-update-required', checkedVersion: '1.1.37', error: 'The available Rasta package does not support this simulated app version.' },
        offline: { code: 'release-check-failed', error: 'Simulated update check failed.' },
        verification: { code: 'verification-failed', error: 'Simulated invalid package signature.' },
    };
    if (window.rastaModernUI) {
        window.rastaPreviewControl = {
            reset: () => { for (const id of Object.keys(state.preferences)) localStorage.removeItem(readingKey(id)); state = initial(); save(); location.reload(); },
            setFailure: value => { state.failDownload = value; save(); },
            failure: () => state.failDownload,
            setCoreOffer: value => { state.offerCoreUpdate = value; save(); },
            coreOffer: () => Boolean(state.offerCoreUpdate),
            setScenario: value => {
                const app = state.apps.find(app => app.id === 't3');
                Object.assign(app, initial().apps.find(app => app.id === 't3'));
                delete app.operation; delete app.download; delete app.cachedVersion; delete app.recovery; delete app.autoRecovery;
                state.scenario = value;
                if (value === 'host-recovery') {
                    app.cachedVersion = '1.1.37';
                    app.recovery = { version: app.cachedVersion, fingerprint: crypto.randomUUID() };
                    app.autoRecovery = true;
                }
                if (value === 'old-runtime') app.cachedVersion = '1.1.16';
                if (value === 'disk-space') {
                    app.hostVersion = '0.1.11';
                    app.operation = { phase: 'failed', action: 'repair', code: 'insufficient-disk-space', installed: false };
                }
                if (scenarios[value]) {
                    app.cachedVersion = '1.1.37';
                    app.download = { phase: 'failed', action: 'install', ...scenarios[value] };
                    if (value === 'app-update') app.hostVersion = '0.1.5';
                    if (value === 'rasta-update') { app.hostVersion = '0.2.0'; app.cachedVersion = '1.1.16'; }
                }
                save();
            },
            scenario: () => state.scenario,
        };
        return;
    }
    const tools = document.createElement('details'); tools.className = 'preview-tools';
    tools.innerHTML = '<summary>UI preview · Simulated connections</summary><div class="preview-controls"><label><input type="checkbox" id="preview-error"> Download error</label><button type="button" id="preview-reset">Reset demo</button></div>';
    document.body.append(tools);
    tools.querySelector('#preview-error').checked = state.failDownload;
    tools.querySelector('#preview-error').onchange = event => { state.failDownload = event.target.checked; save(); };
    tools.querySelector('#preview-reset').onclick = () => { for (const id of Object.keys(state.preferences)) localStorage.removeItem(readingKey(id)); state = initial(); save(); location.reload(); };
    new EventSource('/__preview/events').onmessage = () => { save(); location.reload(); };
})();
