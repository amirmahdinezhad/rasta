const pending = new Map(); let sequence = 0;
window.rastaReply = ({ id, response }) => { const waiter = pending.get(id); if (!waiter) return; pending.delete(id); response.ok ? waiter.resolve(response.value) : waiter.reject(Error(response.error)); };
const rpc = window.rastaPreview || (input => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); window.webkit.messageHandlers.rasta.postMessage({ ...input, id }); }));
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value; };
const newer = (a, b) => a?.split('.').map(Number).reduce((result, value, index) => result || Math.sign(value - (Number(b?.split('.')[index]) || 0)), 0) > 0;
const catalog = [
    { id: 'codex', name: 'Codex', description: 'A familiar font. A natural direction. More comfortable conversations.' },
    { id: 't3', name: 'T3 Code', description: 'Your reading preferences, right inside your coding workspace.' },
    { id: 'antigravity', name: 'Antigravity', description: 'A comfortable reading direction for your agent workspace.' },
    { id: 'claude', name: 'Claude', description: 'Your preferred font and reading direction, inside Claude.' },
    { id: 'opencode', name: 'OpenCode', description: 'Read conversations comfortably in your coding workspace.' },
    { id: 'zcode', name: 'ZCode', description: 'Keep mixed-language conversations clear in ZCode.' },
    { id: 'gemini', name: 'Gemini', available: false, description: 'A dedicated reading connection for the native macOS app is still needed.' },
    { id: 'grokbot', name: 'Grok Bot', available: false, description: 'A dedicated reading adapter for Grok Bot is not available yet.' },
];
const activePhases = new Set(['starting', 'checking', 'downloading-agent', 'downloading-app', 'verifying', 'preparing', 'ready-to-install', 'quitting', 'waiting-for-quit', 'installing', 'reopening']);
const glyphs = { chevron: 'm9 5 7 7-7 7', check: 'm5 12 4 4L19 6', close: 'M6 6l12 12M18 6 6 18', repair: 'M14.7 6.3a5.5 5.5 0 0 0-7 7L3 18a2.1 2.1 0 0 0 3 3l4.7-4.7a5.5 5.5 0 0 0 7-7l-3 3-3-3 3-3Z', remove: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', download: 'M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4', add: 'M12 5v14M5 12h14' };
let state = { apps: [] }, selected = 'codex', busy = false, refreshing = false, polling = false, detailKey = '', animation = null;
const updates = new Map(), preferences = new Map(), tabs = new Map();
let preferenceRequest = 0, lastStatus = 0;
function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', glyphs[name]); svg.append(path); return svg; }
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function appFor(id = selected) { return { ...catalog.find(app => app.id === id), ...state.apps.find(app => app.id === id) }; }
function running(app) { return activePhases.has(app.operation?.phase); }
function button(label, action, className = '', symbol) {
    const value = node('button', symbol ? undefined : label, className); value.type = 'button'; value.disabled = busy;
    if (symbol) { value.classList.add('icon-button'); value.setAttribute('aria-label', label); value.title = label; value.append(icon(symbol)); }
    value.onclick = action; return value;
}
let expanded = false;
function buildTabs() {
    for (const app of catalog) {
        const card = node('article', undefined, 'provider-card'); card.classList.toggle('soon', Boolean(app.soon)); card.classList.toggle('unavailable', app.available === false); card.id = `card-${app.id}`;
        const head = node('div', undefined, 'provider-head');
        const tab = button('', () => select(app.id, false), 'provider-open'); tab.id = `tab-${app.id}`; tab.setAttribute('aria-controls', 'detail'); tab.setAttribute('aria-expanded', 'false');
        const logo = node('img'); logo.src = `icons/${app.id}.png`; logo.alt = ''; const well = node('span', undefined, 'provider-logo'); well.append(logo); tab.append(well);
        const copy = node('div', undefined, 'provider-copy'); copy.append(node('span', app.name, 'provider-name'), node('small', '', 'provider-status')); tab.append(copy);
        const description = node('span', app.description, 'provider-description'); tab.append(description);
        const disclosure = node('span', undefined, 'provider-disclosure'); disclosure.append(node('span', '', 'provider-action')); const chevron = icon('chevron'); chevron.classList.add('chevron'); disclosure.append(chevron); tab.append(disclosure);
        const controls = node('div', undefined, 'provider-controls');
        if (!app.soon && app.available !== false) {
            const toggle = button('', async () => { select(app.id); if (appFor().installed) await remove(); else await perform('connect'); }, 'switch connection-toggle');
            toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', `${app.name} connection`); toggle.setAttribute('aria-checked', 'false');
            const trash = button(`Remove ${app.name} connection`, () => { select(app.id); return remove(); }, 'danger', 'remove'); trash.classList.add('card-remove'); controls.append(trash, toggle);
        }
        head.append(tab, controls); card.append(head); tabs.set(app.id, tab); $('app-list').append(card);
        tab.onkeydown = event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); const index = catalog.findIndex(item => item.id === app.id);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? catalog.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + catalog.length) % catalog.length;
            tabs.get(catalog[next].id).focus();
        };
    }
}
function renderTabs() {
    for (const app of catalog) {
        const value = appFor(app.id), tab = tabs.get(app.id), chosen = selected === app.id && expanded;
        tab.disabled = false; tab.setAttribute('aria-expanded', String(chosen));
        const status = app.soon ? 'Coming soon' : app.available === false ? (value.app ? 'Detected · Connection unavailable' : 'Connection unavailable') : busy?.target === app.id && ['connect', 'download'].includes(busy.action) ? 'Downloading connection' : value.operation?.phase === 'failed' ? 'Connection needs attention' : value.operation?.phase === 'ready-to-install' ? 'Ready to install' : running(value) ? 'Working on connection' : value.installed ? (newer(updates.get(app.id), value.version) ? 'Update available' : 'Connected') : value.app ? 'Ready to connect' : 'App not installed';
        tab.querySelector('small').textContent = status;
        tab.querySelector('.provider-action').textContent = chosen ? 'Close details' : app.soon ? 'What’s next' : app.available === false ? 'View compatibility' : value.installed ? 'Reading preferences' : 'Set up connection';
        tab.closest('article').classList.toggle('expanded', chosen);
        tab.closest('article').dataset.state = app.soon ? 'soon' : value.operation?.phase === 'failed' ? 'attention' : running(value) || busy?.target === app.id ? 'working' : value.installed ? newer(updates.get(app.id), value.version) ? 'update' : 'connected' : 'available';
        tab.closest('article').classList.toggle('connected', Boolean(value.installed));
        const toggle = tab.parentElement.querySelector('[role=switch]'), trash = tab.parentElement.querySelector('.card-remove');
        if (toggle) { toggle.setAttribute('aria-checked', String(Boolean(value.installed))); toggle.disabled = Boolean(busy) || running(value) || !value.app; trash.hidden = !value.installed; trash.disabled = Boolean(busy) || running(value); }
        if (chosen) {
            const index = catalog.findIndex(item => item.id === app.id);
            const narrow = matchMedia('(max-width:740px)').matches;
            const anchor = tabs.get(catalog[narrow ? index : Math.min(index + (index % 2 === 0 ? 1 : 0), catalog.length - 1)].id).closest('article');
            if (anchor.nextElementSibling !== $('detail')) anchor.after($('detail'));
            $('detail').hidden = false;
        }
    }
    if (!expanded) $('detail').hidden = true;
}
async function refresh(force = false) {
    if (polling) return; polling = true;
    try {
        state = await rpc({ action: 'status' }); window.rastaLoaded = true;
        lastStatus = Date.now(); renderCoreOperation();
        $('core-version').textContent = `Rasta ${state.version || ''}`; $('count').textContent = `${state.apps.filter(app => app.installed).length} connected · ${state.apps.filter(app => app.app).length} on this Mac`;
        renderTabs(); render(force);
    } catch (error) { notice(error.message); } finally { polling = false; }
}
function render(force = false) {
    renderTabs();
    const app = appFor(), pref = preferences.get(selected);
    const key = JSON.stringify([selected, app.installed, app.app, app.hostVersion, app.version, app.cachedVersion, app.error, app.operation?.id, app.operation?.phase, app.operation?.error, busy, updates.get(selected), pref?.selected, pref?.reading, pref?.fonts]);
    if (force || key !== detailKey) {
        detailKey = key; const focused = document.activeElement?.id; const detail = $('detail'); detail.replaceChildren(); detail.setAttribute('aria-labelledby', `tab-${selected}`);
        if (app.available === false) {
            detail.append(node('h2', 'Gemini connection is not available yet'), node('p', app.reason || 'Gemini is a native macOS app and needs a dedicated reading adapter.'));
            if (app.app) detail.append(node('p', `Detected version: ${app.hostVersion}. Your app has not been changed.`));
            return;
        }
        const top = node('div', undefined, 'detail-top'); top.append(node('h2', app.installed ? `${app.name}, your way.` : `Connect ${app.name}`), node('span', app.installed ? 'Connected' : app.app ? 'Ready to connect' : 'Not installed', `pill ${app.installed ? 'connected' : ''}`)); if (expanded) { const close = button('Close preferences', () => { expanded = false; renderTabs(); tabs.get(selected).focus({ preventScroll: true }); }, 'detail-close', 'close'); top.append(close); } detail.append(top);
        detail.append(node('p', app.installed ? `Changes appear in ${app.name} automatically. Make it feel like you.` : app.app ? 'Add right-to-left reading and your preferred font.' : `Install ${app.name} on this Mac, then check for updates.`));
        let connectionInfo = null;
        if (app.app) {
            const versions = node('div', undefined, 'versions');
            for (const [title, value] of [['App version', app.hostVersion || 'Unavailable'], ['Connection', app.version || (app.cachedVersion ? `${app.cachedVersion} downloaded` : 'Not downloaded')]]) { const field = node('div'); field.append(node('span', title), node('strong', value)); versions.append(field); } connectionInfo = node('details', undefined, 'connection-info'); connectionInfo.append(node('summary', 'Connection details'), versions);
            const actions = node('div', undefined, 'actions');
            if (!running(app)) {
                if (!app.installed || newer(updates.get(selected), app.version)) actions.append(button(app.installed ? 'Update connection' : 'Install connection', () => perform('connect'), 'primary'));
                if (app.installed) { const repair = button('Repair connection', () => perform('repair'), 'maintenance'); repair.prepend(icon('repair')); connectionInfo.append(repair); }
                if (app.cachedVersion) { const download = button('Download again', () => perform('download'), 'maintenance'); download.prepend(icon('download')); connectionInfo.append(download); }

            }
            detail.append(actions);
        }
        if (app.error) detail.append(node('p', app.error));
        if (app.app && (!app.installed || running(app) || busy?.target === app.id)) { const steps = node('ol', undefined, 'connection-steps'); steps.setAttribute('aria-label', 'Connection stages'); for (const title of ['Download', 'Verify', 'Prepare', 'Install']) { const step = node('li'); step.append(icon('check'), node('span', title)); steps.append(step); } detail.append(steps); }
        const operation = node('div', undefined, 'operation'); operation.id = 'operation'; operation.hidden = true; operation.setAttribute('role', 'status'); detail.append(operation);
        if (app.installed) renderPreferences(detail, pref);
        if (connectionInfo) detail.append(connectionInfo);
        if (focused && $(focused)) $(focused).focus({ preventScroll: true });
    }
    renderOperation(app);
}
function renderOperation(app) {
    const region = $('operation'); if (!region) return;
    const downloading = busy && busy.target === app.id && ['connect', 'download'].includes(busy.action);
    const current = downloading ? app.download || { phase: 'checking' } : app.operation;
    const restoring = current?.action === 'restore' || current?.action === 'remove' || current?.restored;
    const stageTitles = restoring ? ['Close app', 'Restore', 'Complete'] : ['Download', 'Verify', 'Prepare', 'Install'];
    const stageIndex = restoring ? current.phase === 'complete' ? 3 : current.phase === 'installing' ? 1 : 0 : !current ? -1 : ['checking', 'downloading', 'downloading-agent', 'downloading-app'].includes(current.phase) ? 0 : current.phase === 'verifying' ? 1 : ['starting', 'preparing', 'ready-to-install'].includes(current.phase) ? 2 : ['quitting', 'waiting-for-quit', 'installing', 'reopening'].includes(current.phase) ? 3 : current.phase === 'complete' ? 4 : -1;
    document.querySelectorAll('.connection-steps li').forEach((step, index) => {
        const title = stageTitles[index];
        step.style.display = title ? '' : 'none';
        step.querySelector('span').textContent = title || '';
        step.classList.toggle('done', index < stageIndex);
        step.classList.toggle('current', index === stageIndex);
        if (index === stageIndex) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    if (!current || (!downloading && !running(app) && !['failed', 'complete', 'cancelled'].includes(current.phase))) { region.hidden = true; return; }
    region.hidden = false;
    const labels = { checking: 'Checking connection', downloading: 'Downloading connection', 'downloading-agent': 'Downloading connection', verifying: 'Verifying download', preparing: 'Preparing connection', starting: 'Preparing connection', 'ready-to-install': 'Ready to install', quitting: `Closing ${app.name}`, 'waiting-for-quit': `Waiting for ${app.name} to close`, installing: restoring ? 'Restoring original app' : 'Installing connection', reopening: `Opening ${app.name}`, complete: current.restored ? 'Connection removed' : 'Connection installed', failed: 'Couldn’t finish', cancelled: 'Cancelled', downloaded: 'Download verified' };
    const phaseKey = `${current.id || ''}:${current.phase}`;
    if (region.dataset.phase !== phaseKey) {
        region.dataset.phase = phaseKey; region.replaceChildren(); const copy = node('div', undefined, 'operation-copy'); copy.append(node('span', labels[current.phase] || 'Working'), node('span', '', 'progress-value')); region.append(copy);
        const track = node('div', undefined, 'progress-track'); track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', 'Connection progress'); const fill = node('div', undefined, 'progress-fill'); track.append(fill); region.append(track);
        if (current.phase === 'ready-to-install') {
            region.append(node('p', `${app.name} will close, install the connection and reopen when you choose Launch.`));
            const actions = node('div', undefined, 'actions'); actions.append(button('Launch', () => launch(current.id), 'primary'), button('Cancel installation', () => cancel(current.id), '', 'close')); region.append(actions);
        }
        if (current.phase === 'waiting-for-quit' && app.id === 'codex' && !restoring) region.append(node('p', 'If Codex stays open, switch to Codex and press Command-Q. Rasta will reopen it after installation.'));
        if (current.error) region.append(node('p', current.error));
    }
    const fraction = Number.isFinite(current.progress) ? Math.max(0, Math.min(1, current.progress)) : null;
    region.querySelector('.progress-fill').style.transform = `scaleX(${fraction ?? 0})`;
    const bar = region.querySelector('[role=progressbar]'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuetext', labels[current.phase] || 'Working'); if (fraction === null) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    region.querySelector('.progress-value').textContent = current.total > 0 ? `${Math.round((current.downloaded || 0) / current.total * 100)}% · ${((current.downloaded || 0) / 1048576).toFixed(1)} / ${(current.total / 1048576).toFixed(1)} MB` : current.phase === 'downloading' ? 'Downloading…' : '';
}
function renderPreferences(detail, pref) {
    const section = node('section', undefined, 'preferences');
    const heading = node('div', undefined, 'preferences-heading'); heading.append(node('h3', 'Make it comfortable'), node('span', 'Auto-saved')); section.append(heading); detail.append(section);
    if (!pref) { section.append(node('p', 'Loading reading preferences…')); return; }
    const row = (label, control, parent = section) => { const value = node('div', undefined, 'setting-row'), text = node('label', label); text.htmlFor = control.id; value.append(text, control); parent.append(value); return value; };
    const select = (id, choices, selectedValue, save) => {
        const value = node('select'); value.id = id; value.disabled = Boolean(busy) || running(appFor());
        for (const [id, label] of choices) { const option = node('option', label); option.value = id; option.selected = id === selectedValue; value.append(option); }
        value.onchange = () => save(value.value); return value;
    };
    const controls = node('div', undefined, 'font-select');
    const family = select('font-family', [...(pref.vazirRemoved ? [] : [['vazir', 'Vazir']]), ...pref.fonts.map(font => [font.id, font.label === 'Vazir' ? 'Vazir (custom)' : font.label])], pref.selected, id => savePreference('font-select', { id }));
    controls.append(family, button('Add font', () => { $('font-file').value = ''; $('font-file').click(); }, '', 'add'));
    const fontRow = node('div', undefined, 'setting-row'), label = node('label', 'Font'); label.htmlFor = family.id; fontRow.append(label, controls); section.append(fontRow);
    const sizes = node('div', undefined, 'type-controls'); section.append(sizes);
    row('Text size', select('text-size', ['14', '16', '18'].map(n => [n, `${n} px`]), pref.reading.fs, fs => savePreference('reading-save', { fs })), sizes);
    row('Line height', select('line-height', ['1.4', '1.6', '1.8'].map(n => [n, n]), pref.reading.lh, lh => savePreference('reading-save', { lh })), sizes);
    const typography = node('div', undefined, 'typography-controls');
    for (const child of [...section.children]) if (child !== heading) typography.append(child);
    section.append(typography);
    const sample = node('div', undefined, 'sample'); sample.id = 'reading-sample';
    // This is reading content, not interface copy.
    const persian = node('p', readingPreviewText); persian.dir = 'auto';
    const sampleLabel = node('div', 'READING PREVIEW', 'sample-label'); const english = node('p', 'A little more room to read.'); english.dir = 'ltr'; sample.append(sampleLabel, persian, english); section.append(sample); applyPreview(pref);
    const reading = node('div', undefined, 'reading-controls'); section.append(reading);
    for (const [key, title] of [['isRTL', 'Enable right-to-left reading'], ['forceRTL', 'Force right-to-left text'], ['fixAtSign', 'Type @ with Shift+2']]) {
        const control = button('', () => savePreference('reading-save', { [key]: !pref.reading[key] }), 'switch'); control.id = `reading-${key}`; control.setAttribute('role', 'switch'); control.setAttribute('aria-label', title); control.setAttribute('aria-checked', String(pref.reading[key])); control.disabled ||= running(appFor()); row(title, control, reading);
    }
}
const readingPreviewText = 'خواندن باید ساده باشد. با فونت و فاصله‌ای که دوست دارید، روی آنچه مهم است تمرکز کنید.';
let previewFace = null, previewSequence = 0;
async function applyPreview(pref) {
    const generation = ++previewSequence; const sample = $('reading-sample'); if (!sample) return;
    sample.style.fontSize = pref.reading.fs + 'px'; sample.style.lineHeight = pref.reading.lh; sample.dir = pref.reading.isRTL ? 'rtl' : 'auto';
    for (const child of sample.querySelectorAll('p')) { child.style.fontSize = 'inherit'; child.style.lineHeight = 'inherit'; }
    if (!pref.active) { sample.style.fontFamily = 'Vazir,system-ui,sans-serif'; return; }
    try {
        const family = 'Preview_' + pref.active.id, face = new FontFace(family, `url("data:font/ttf;base64,${pref.active.data}")`); await face.load();
        if (generation !== previewSequence) return;
        if (previewFace) document.fonts.delete(previewFace); previewFace = face; document.fonts.add(face); sample.style.fontFamily = `"${family}",Vazir,sans-serif`;
    } catch { notice('Couldn’t preview this font. Choose another font.'); }
}
async function loadPreferences() {
    if (appFor().available === false || !appFor().installed) return; const target = selected, generation = ++preferenceRequest;
    try { const value = await rpc({ action: 'preferences', target }); preferences.set(target, value); if (selected === target && generation === preferenceRequest) render(); } catch (error) { notice(error.message); }
}
async function savePreference(action, input) {
    if (busy) return; const target = selected, focusId = action === 'font-import' ? 'font-family' : document.activeElement?.id; busy = { target, action }; render(); notice('');
    try { preferences.set(target, await rpc({ action, target, input })); } catch (error) { notice(error.message); }
    finally { busy = false; render(true); if (target === selected && focusId) $(focusId)?.focus({ preventScroll: true }); }
}
function select(id, open = true) {
    if (!catalog.some(app => app.id === id)) return;
    expanded = open || selected !== id || !expanded;
    const current = animation?.playState === 'running' ? getComputedStyle($('detail')) : null;
    const from = { opacity: current?.opacity || .45, transform: current?.transform || 'translateY(4px)' };
    animation?.cancel(); selected = id; renderTabs(); render(true); loadPreferences();
    if (!document.body.classList.contains('keyboard') && !matchMedia('(prefers-reduced-motion: reduce)').matches) animation = $('detail').animate([from, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.23,1,.32,1)' });
}
window.rastaOpenConnection = id => { showSettings(false); select(id); };
async function confirm(title, copy, label) {
    $('confirm-title').textContent = title; $('confirm-copy').textContent = copy; $('confirm-ok').textContent = label;
    const dialog = $('confirm'); dialog.returnValue = ''; dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
async function perform(action) {
    if (busy || running(appFor()) || appFor().available === false || appFor().soon) return; const target = selected, app = appFor(); busy = { target, action }; notice(''); render(true);
    try {
        if (action === 'download' || (action === 'connect' && (!app.cachedVersion || newer(updates.get(target), app.cachedVersion)))) {
            state.apps.find(app => app.id === target).download = { phase: 'checking', progress: 0 }; renderOperation(appFor(target));
            await rpc({ action: 'download', target });
        }
        if (action !== 'download') await rpc({ action: action === 'connect' ? 'install' : action, target });
        else notice('Connection downloaded and verified. Choose Install connection when you are ready.');
    } catch (error) { notice(error.message); }
    finally { busy = false; await refresh(true); await loadPreferences(); }
}
async function launch(job) {
    if (busy) return; const target = selected; busy = { target, action: 'launch' }; render(true);
    try { await rpc({ action: 'launch', target, job }); } catch (error) { notice(error.message); }
    finally { busy = false; await refresh(true); await loadPreferences(); }
}
async function cancel(job) {
    if (busy) return;
    try { await rpc({ action: 'cancel', target: selected, job }); await refresh(true); } catch (error) { notice(error.message); }
}
async function remove() { if (await confirm('Remove this connection?', `${appFor().name} will close while Rasta restores its original files and removes its Rasta reading settings. The app will stay closed after removal.`, 'Remove connection')) await perform('remove'); }
async function check() {
    if (refreshing) return; refreshing = true; $('refresh').disabled = true; $('refresh').setAttribute('aria-busy', 'true'); $('refresh').title = 'Checking for updates…'; notice('Checking for updates…');
    try {
        await refresh();
        const results = await Promise.allSettled(state.apps.filter(app => app.app && app.available !== false).map(async app => { const result = await rpc({ action: 'check', target: app.id }); updates.set(app.id, result.version); }));
        const failed = results.find(result => result.status === 'rejected');
        notice(failed ? failed.reason.message : state.apps.some(app => app.installed && newer(updates.get(app.id), app.version)) ? 'A connection update is ready.' : 'Your connections are up to date.');
        renderTabs(); render();
    } catch (error) { notice(error.message); }
    finally { refreshing = false; $('refresh').disabled = false; $('refresh').setAttribute('aria-busy', 'false'); $('refresh').title = 'Check for updates'; }
}
$('refresh').onclick = check;
$('back-apps').onclick = () => showSettings(false);
$('apps-nav').onclick = () => showSettings(false); $('settings-nav').onclick = () => showSettings($('settings-view').hidden);
function showSettings(value) { $('settings-view').hidden = !value; $('apps-view').hidden = value; $('settings-nav').setAttribute('aria-pressed', String(value)); }
$('font-file').onchange = async () => {
    const file = $('font-file').files?.[0]; if (!file || busy) return;
    if (!/\.(ttf|otf)$/i.test(file.name) || !file.size || file.size > 2 * 1024 * 1024) { notice('Choose a TTF or OTF font up to 2 MB.'); return; }
    const target = selected; const bytes = new Uint8Array(await file.arrayBuffer()); if (target !== selected) return;
    let binary = ''; for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    await savePreference('font-import', { name: file.name, data: btoa(binary) });
};
$('core-update').onclick = async () => {
    if (busy) return; busy = { target: 'manager', action: 'update' }; $('core-update').disabled = true; notice('Checking for a Rasta update…');
    try { const result = await rpc({ action: 'core-check' }); if (!newer(result.version, state.version)) notice('Rasta is up to date.');
        else if (await confirm('Update Rasta?', `Rasta ${result.version} is available. Your connections stay installed.`, 'Download update')) { const result = await rpc({ action: 'core-update' }); notice(result.message); }
    } catch (error) { notice(error.message); } finally { busy = false; $('core-update').disabled = false; renderCoreOperation(); }
};
function renderCoreOperation() {
    const current = state.coreUpdate, region = $('core-operation'); region.hidden = !current; if (!current) return;
    const key = JSON.stringify([current.phase, current.version, current.error, Boolean(busy)]);
    if (region.dataset.phase === key) {
        region.querySelector('.progress-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, current.progress || 0))})`;
        if (current.total > 0) region.querySelector('.core-percent').textContent = `${Math.round((current.downloaded || 0) / current.total * 100)}% downloaded`;
        return;
    }
    region.dataset.phase = key; region.className = 'operation'; region.replaceChildren();
    const labels = { downloading: 'Downloading Rasta', verifying: 'Verifying Rasta update', ready: 'Ready to update', installing: 'Updating Rasta', complete: 'Rasta updated', failed: 'Couldn’t update Rasta' };
    region.append(node('div', labels[current.phase] || 'Preparing update', 'operation-copy'));
    const track = node('div', undefined, 'progress-track'), fill = node('div', undefined, 'progress-fill'); fill.style.transform = `scaleX(${Math.max(0, Math.min(1, current.progress || 0))})`; track.append(fill); region.append(track);
    const percent = node('p', '', 'core-percent'); percent.hidden = !current.total; if (current.total > 0) percent.textContent = `${Math.round((current.downloaded || 0) / current.total * 100)}% downloaded`; region.append(percent);
    if (current.error) region.append(node('p', current.error));
    if (current.phase === 'ready') { const actions = node('div', undefined, 'actions'); actions.append(button('Restart and update', async () => { try { await rpc({ action: 'core-install' }); } catch (error) { notice(error.message); } }, 'primary')); region.append(actions); }
}
$('remove-all').onclick = async () => {
    if (busy) return;
    if (!await confirm('Remove Rasta completely?', 'Remove each connection here first. Rasta restores the original app and removes its reading settings. Then remove Rasta and its downloaded packages.', 'Continue')) return;
    await refresh(); const app = state.apps.find(item => item.installed);
    if (app) { showSettings(false); select(app.id); await perform('remove'); }
    else { try { const result = await rpc({ action: 'remove-data' }); notice(result.message); } catch (error) { notice(error.message); } }
};
document.addEventListener('keydown', () => { document.body.classList.add('keyboard'); animation?.cancel(); }, { capture: true });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches) animation?.cancel(); }); document.addEventListener('pointerdown', () => document.body.classList.remove('keyboard'));
window.addEventListener('focus', () => { refresh(); loadPreferences(); });
window.addEventListener('resize', () => { if (expanded) renderTabs(); });
buildTabs();
refresh(true).then(loadPreferences);
setInterval(() => { if (!document.hidden && (busy || state.apps.some(running) || Date.now() - lastStatus > 5000)) refresh(); }, 500);
