// Run only disposable apps generated here, never vendor apps or their user data.
import assert from 'node:assert/strict';
import { checkReadingDependency } from './helpers/reading-dependency.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as asar from '@electron/asar';
import { buildCodexPayload } from '../bin/lib/codex.js';
import { createCodexArchive } from '../bin/lib/codex-native.js';
import { desktopAdapter } from '../bin/lib/desktop-adapters.js';

const require = createRequire(import.meta.url), electron = require('electron');
for (const target of ['claude', 'opencode', 'zcode', 'grokbot']) {
    const grok = target === 'grokbot';
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `rasta-${target}-electron-`)));
    const appRoot = path.join(root, 'Fixture.app'), app = path.join(appRoot, 'Contents/Resources/app.asar');
    const source = path.join(root, 'source'), runtime = path.join(root, 'runtime');
    const result = path.join(root, 'result.json'), calls = path.join(root, 'calls.jsonl'), preferences = path.join(root, 'reading.json');
    try {
        for (const folder of ['.vite/build', 'out/main', 'out/preload', 'out/renderer', 'dist/electron-main', 'dist/electron-preload', 'dist/renderer/assets']) fs.mkdirSync(path.join(source, folder), { recursive: true });
        fs.mkdirSync(path.dirname(app), { recursive: true }); fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
        fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
        const fontId = 'a'.repeat(32), data = fs.readFileSync(new URL('../bin/assets/Vazir-Bold.ttf', import.meta.url)).toString('base64');
        fs.writeFileSync(preferences, JSON.stringify({ selected: fontId, active: { id: fontId, data }, fonts: [], reading: { fs: '18', lh: '1.8', isRTL: true, forceRTL: false, fixAtSign: true } }));
        fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `const fs=require('fs'),action=process.argv[process.argv.indexOf('--rpc')+1];fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({action,target:process.env.ARTL_TARGET})+'\\n');const update={available:false};console.log(JSON.stringify({ok:true,value:action==='preferences'?JSON.parse(fs.readFileSync(${JSON.stringify(preferences)})):action==='status'?{update}:action==='check'?update:{}}));`);
        const sample = String.fromCodePoint(0x633, 0x644, 0x627, 0x645);
        const response = (id, content) => ({
            claude: `<div data-turn-key="${id}" data-cds="AssistantMessage"><div data-testid="assistant-message">${content}</div></div>`,
            opencode: `<div data-message-id="${id}"><div data-timeline-part-id="${id}-part" data-component="text-part"><div data-slot="text-part-body"><div data-component="markdown">${content}</div></div></div></div>`,
            zcode: `<section data-turn-id="${id}" data-turn-key="${id}"><div class="group/assistant-row" data-row-id="${id}-row"><div data-conversation-selectable>${content}</div></div></section>`,
            grokbot: `<div id="${id}" class="sand-message-prose">${content}</div>`,
        })[target];
        const composer = target === 'opencode' ? 'data-component="session-composer-dock"' : '';
        const html = `<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="font-src 'none'"></head><body><p id="chrome">${sample}</p><main>${response('first', `<p id="reading">${sample} Wmix001</p><p id="latin">English text</p><pre><code id="code">const keep = true;</code></pre>`)}${response('second', '<p id="other">Separate answer</p>')}<div ${composer} contenteditable="true" id="composer">${sample}</div></main><iframe src="embedded.html"></iframe></body></html>`;
        fs.writeFileSync(path.join(source, 'out/renderer/index.html'), html);
        fs.writeFileSync(path.join(source, 'out/renderer/embedded.html'), '<html><body>Embedded</body></html>');
        fs.writeFileSync(path.join(source, 'out/renderer/other.html'), html.replace('<iframe src="embedded.html"></iframe>', ''));
        if (grok) {
            fs.writeFileSync(path.join(source, 'dist/renderer/index.html'), html.replace('</head>', '<script src="./assets/index-fixture.js" type="module"></script></head>'));
            fs.writeFileSync(path.join(source, 'dist/renderer/embedded.html'), '<html><body>Embedded</body></html>');
            fs.writeFileSync(path.join(source, 'dist/renderer/assets/index-fixture.js'), 'import {ready} from "./index.eager-app-fixture.js";');
            fs.writeFileSync(path.join(source, 'dist/renderer/assets/index.eager-app-fixture.js'), 'export const ready = "sand-message-prose sand-chat-input-dock";');
            fs.writeFileSync(path.join(source, 'dist/electron-main/main-core.cjs'), 'const renderer="../renderer/index.html";const preferences={contextIsolation:!0,nodeIntegration:!1};');
        }
        const preload = "require('electron').contextBridge.exposeInMainWorld('vendorPreloadSentinel','unchanged');";
        const preloadPath = target === 'claude' ? '.vite/build/mainView.js' : grok ? 'dist/electron-preload/preload.cjs' : 'out/preload/index.cjs';
        fs.writeFileSync(path.join(source, preloadPath), preload);
        if (target === 'opencode') fs.writeFileSync(path.join(source, 'out/preload/index.js'), '// vendor ESM preload identity');
        const registryPath = '.vite/build/index.chunk-fixture.js';
        fs.writeFileSync(path.join(source, registryPath), 'const e={r:x=>x};let V;var bo=e.r({mainView:()=>V,mainWindow:()=>V});const origin="app://localhost";const registry={mainView:null};Object.defineProperty(exports,"registry",{enumerable:!0,get:function(){return bo}});Object.defineProperty(bo,"mainView",{get:()=>registry.mainView});exports.setView=view=>registry.mainView=view;');
        const esm = target !== 'claude', main = grok ? 'dist/electron-main/main.cjs' : esm ? 'out/main/index.js' : '.vite/build/launcher.js';
        const pkg = { name: 'fixture', version: '1.0.0', ...(esm ? { type: 'module' } : {}), main };
        const prefix = esm && !grok ? `import electron from 'electron';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';const {app,BrowserWindow,WebContentsView,protocol}=electron;const archive=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');`
            : `const {app,BrowserWindow,WebContentsView,protocol}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');const archive=path.resolve(__dirname,'../..');const vendorRegistry=${grok ? 'null' : "require('./index.chunk-fixture.js')"};`;
        const scheme = target === 'claude' ? 'app' : 'oc', hostName = target === 'claude' ? 'localhost' : 'renderer';
        const viewUrl = target === 'claude' ? 'https://claude.ai/chat/fixture' : `${scheme}://${hostName}/index.html`;
        let vendor = `${prefix}
const target=${JSON.stringify(target)},root=${JSON.stringify(root)};app.setPath('userData',path.join(root,'profile'));app.dock?.hide();
if(target==='claude')assert.equal(globalThis.vendorLauncherRan,true);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(target!=='zcode')protocol.registerSchemesAsPrivileged([{scheme:${JSON.stringify(scheme)},privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
const serveFixture=request=>new Response(new URL(request.url).pathname.endsWith('embedded.html')?'<html><body>Embedded</body></html>':${JSON.stringify(html)},{headers:{'content-type':'text/html; charset=utf-8'}});
if(target!=='zcode')protocol.handle(${JSON.stringify(scheme)},serveFixture);
if(target==='claude')protocol.handle('https',serveFixture);
const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(archive,${JSON.stringify(preloadPath)})}});
let view=win;
${target === 'claude' ? `view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(archive,${JSON.stringify(preloadPath)})}});win.contentView.addChildView(view);view.setBounds({x:0,y:0,width:800,height:600});view.webContents.once('dom-ready',()=>setTimeout(()=>vendorRegistry.setView(view),650));` : ''}
const errors=[];view.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
const renderer=path.join(archive,target==='grokbot'?'dist/renderer/index.html':'out/renderer/index.html');
const load=()=>['zcode','grokbot'].includes(target)?view.webContents.loadFile(renderer,target==='zcode'?{query:{restoreSession:'true',supportsSettings:'true'}}:{}):view.webContents.loadURL(${JSON.stringify(viewUrl)});
await load();const evaluate=code=>view.webContents.executeJavaScript(code,true);
for(let n=0;n<120;n++){if(await evaluate("getComputedStyle(document.getElementById('reading')).fontSize === '18px' && getComputedStyle(document.getElementById('reading')).direction === 'rtl'"))break;await pause(50)}
assert.equal(await evaluate('vendorPreloadSentinel'),'unchanged');assert.equal(await evaluate('typeof rastaNative'),'undefined');assert.equal(await evaluate('typeof __rastaPro'),'undefined');
assert.equal(await evaluate("getComputedStyle(document.getElementById('reading')).direction"),'rtl',JSON.stringify(errors));
assert.equal(await evaluate("getComputedStyle(document.getElementById('reading')).fontSize"),'18px');
assert.equal(await evaluate("getComputedStyle(document.getElementById('composer')).direction"),'rtl');
assert.equal(await evaluate("getComputedStyle(document.getElementById('latin')).direction"),'ltr');
assert.equal(await evaluate("getComputedStyle(document.getElementById('chrome')).direction"),'ltr');
assert.notEqual(await evaluate("getComputedStyle(document.getElementById('code')).direction"),'rtl');
const alignment=()=>evaluate("getComputedStyle(document.getElementById('reading')).textAlign");
assert.equal(await evaluate("document.querySelectorAll('.artl-message-direction-control button').length"),2);
if(target==='zcode'){
    const controlIsBelow=()=>evaluate(\`(() => {
        const body = document.getElementById('reading').closest('[data-conversation-selectable]');
        const row = body.parentElement;
        const control = row.querySelector(':scope > .artl-message-direction-control');
        return control === row.lastElementChild
            && control.getBoundingClientRect().top >= control.previousElementSibling.getBoundingClientRect().bottom
            && Math.abs(control.getBoundingClientRect().right - body.getBoundingClientRect().right) < 1;
    })()\`);
    assert.equal(await controlIsBelow(),true,'ZCode places the control below the response at the right edge');
    await evaluate(\`(() => {
        const button = document.querySelector('.artl-message-direction-control button');
        button.focus();
        const actions = document.createElement('div');
        actions.textContent = 'Host response actions';
        button.parentElement.parentElement.appendChild(actions);
    })()\`);
    for(let n=0;n<40&&!await controlIsBelow();n++)await pause(50);
    assert.equal(await controlIsBelow(),true,'ZCode keeps the control below actions added after streaming');
    assert.equal(await evaluate("document.activeElement === document.querySelector('.artl-message-direction-control button')"),true);
}
const toggleDirection=()=>evaluate("document.querySelector('.artl-message-direction-control button').click()");
await toggleDirection();
for(let n=0;n<20&&await alignment()!=='left';n++)await pause(25);
assert.equal(await alignment(),'left');
assert.equal(await evaluate("getComputedStyle(document.getElementById('other')).direction"),'ltr');
assert.equal(await evaluate("document.getElementById('code').hasAttribute('dir')"),false);
await load();
for(let n=0;n<120;n++){if(await evaluate("!!document.querySelector('.artl-message-direction-control.has-override') && getComputedStyle(document.getElementById('reading')).fontFamily.includes('RastaUser_')")&&await alignment()==='left')break;await pause(50)}
assert.equal(await evaluate("document.querySelector('.artl-message-direction-control button').dataset.direction"),'ltr');
assert.equal(await alignment(),'left');
await toggleDirection();
for(let n=0;n<20&&await alignment()!=='right';n++)await pause(25);
assert.equal(await alignment(),'right');
assert.equal(await evaluate("getComputedStyle(document.getElementById('latin')).direction"),'rtl');
assert.match(await evaluate("getComputedStyle(document.getElementById('reading')).fontFamily"),/RastaUser_/);
const fontWidth=()=>evaluate("(()=>{const range=document.createRange();range.selectNodeContents(document.getElementById('reading'));return range.getBoundingClientRect().width})()");
const selectedWidth=await fontWidth();
const platformWidth=await evaluate("(()=>{const el=document.getElementById('reading');el.style.setProperty('font-family','ui-sans-serif, system-ui, sans-serif','important');const range=document.createRange();range.selectNodeContents(el);const width=range.getBoundingClientRect().width;el.style.removeProperty('font-family');return width})()");
assert.notEqual(selectedWidth,platformWidth,'the selected face must change the measured Persian glyphs under restrictive font-src');
assert.doesNotMatch(await evaluate("getComputedStyle(document.getElementById('code')).fontFamily"),/RastaUser_/);
assert.equal(await evaluate("document.querySelector('iframe').contentDocument.querySelector('.artl-widget-trigger')"),null);
await toggleDirection();
for(let n=0;n<20&&await alignment()!=='left';n++)await pause(25);
assert.equal(await alignment(),'left');
const pref=JSON.parse(fs.readFileSync(${JSON.stringify(preferences)}));
const setForce=async active=>{
    pref.reading.forceRTL=active;
    fs.writeFileSync(${JSON.stringify(preferences)},JSON.stringify(pref));
    await evaluate("window.dispatchEvent(new Event('focus'))");
};
pref.reading.fs='16';
await setForce(true);
for(let n=0;n<100;n++){if(await evaluate("getComputedStyle(document.getElementById('latin')).direction === 'rtl' && getComputedStyle(document.getElementById('reading')).fontSize === '16px'"))break;await pause(50)}
assert.equal(await evaluate("getComputedStyle(document.getElementById('latin')).direction"),'rtl');assert.equal(await evaluate("getComputedStyle(document.getElementById('reading')).fontSize"),'16px');
assert.equal(await alignment(),'right','Force RTL takes precedence over the saved left alignment');
assert.equal(await evaluate("getComputedStyle(document.getElementById('other')).direction"),'rtl');
assert.equal(await evaluate("document.querySelectorAll('.artl-message-direction-control button').length"),0);
assert.equal(await evaluate("getComputedStyle(document.getElementById('chrome')).direction"),'ltr');
assert.equal(await evaluate("document.getElementById('code').hasAttribute('dir')"),false);
await (${checkReadingDependency})({
    evaluate, assert, pause, textSelector: '#latin', inputSelector: '#composer',
    setEnabled: async isRTL => {
        pref.reading.isRTL = isRTL;
        await setForce(true);
    },
});
await setForce(false);
for(let n=0;n<100&&await alignment()!=='left';n++)await pause(25);
assert.equal(await alignment(),'left','Turning Force RTL off restores the saved left alignment');
assert.equal(await evaluate("getComputedStyle(document.getElementById('other')).direction"),'ltr');
assert.equal(await evaluate("document.querySelector('.artl-message-direction-control.has-override button')?.dataset.direction"),'ltr');
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger[data-panel]').hidden"),false);
await evaluate("document.querySelector('.artl-widget-trigger').click()");
const panelVisible=()=>evaluate("!!document.querySelector('.artl-widget-container div')?.shadowRoot?.querySelector('[role=dialog]')");
for(let n=0;n<100;n++){if(await panelVisible())break;await pause(50)}
assert.equal(await panelVisible(),true);
const triggerVisible=()=>evaluate("document.querySelector('.artl-widget-trigger').getClientRects().length > 0");
const panelOpen=()=>evaluate("document.querySelector('.artl-widget-trigger').getAttribute('aria-expanded') === 'true'");
await evaluate("document.querySelector('main').hidden = true; document.body.appendChild(Object.assign(document.createElement('textarea'), {value:'Settings input'}))");
for(let n=0;n<40;n++){if(!await triggerVisible()&&!await panelOpen())break;await pause(50)}
assert.equal(await triggerVisible(),false,'the launcher is hidden when chat is left mounted but invisible');
assert.equal(await panelOpen(),false,'leaving chat closes an open Rasta panel');
await evaluate("document.querySelector('main').hidden = false");
for(let n=0;n<40;n++){if(await triggerVisible())break;await pause(50)}
assert.equal(await triggerVisible(),true,'returning to chat restores the launcher');
assert.equal(await panelOpen(),false,'returning to chat keeps the panel closed');
if(target==='claude'){
    await evaluate("history.pushState(null,'','/settings/appearance')");
    assert.equal(await triggerVisible(),false,'a settings route hides a stale Claude chat');
    await evaluate("history.pushState(null,'','/')");
    assert.equal(await triggerVisible(),true);
}
const importedWidthBeforeReset=await fontWidth();
const defaultPref=JSON.parse(fs.readFileSync(${JSON.stringify(preferences)}));defaultPref.selected='vazir';defaultPref.active=null;fs.writeFileSync(${JSON.stringify(preferences)},JSON.stringify(defaultPref));await evaluate("window.dispatchEvent(new Event('focus'))");
for(let n=0;n<100;n++){if(await evaluate("getComputedStyle(document.getElementById('reading')).fontFamily.startsWith('Vazir')"))break;await pause(50)}
assert.match(await evaluate("getComputedStyle(document.getElementById('reading')).fontFamily"),/^Vazir/);
const defaultWidth=await fontWidth();
assert.notEqual(defaultWidth,importedWidthBeforeReset,'switching from the imported face to the bundled face changes the actual layout');
for(let n=0;n<100;n++){if(fs.existsSync(${JSON.stringify(calls)})&&fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('ready'))break;await pause(50)}
const actions=fs.readFileSync(${JSON.stringify(calls)},'utf8').trim().split('\\n').map(line=>JSON.parse(line));assert.ok(actions.some(value=>value.action==='ready'));assert.ok(!actions.some(value=>value.action==='manager-open'));assert.ok(actions.every(value=>value.target===target));
const guest=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
if(['zcode','grokbot'].includes(target))await guest.loadFile(path.join(archive,'out/renderer/other.html'));else await guest.loadURL(${JSON.stringify(target === 'claude' ? viewUrl : `${scheme}://${hostName}/other.html`)});
await pause(200);assert.equal(await guest.webContents.executeJavaScript("document.querySelector('.artl-widget-trigger')"),null);
if(target==='zcode'){
    const updater=new BrowserWindow({show:false,parent:win,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(archive,${JSON.stringify(preloadPath)})}});
    await updater.loadFile(renderer,{query:{restoreSession:'false',supportsSettings:'false',windowKind:'update-status',locale:'en'}});
    await pause(350);
    assert.equal(await updater.webContents.executeJavaScript('vendorPreloadSentinel'),'unchanged');
    assert.equal(await updater.webContents.executeJavaScript("document.querySelectorAll('.artl-widget-trigger').length"),0,'the ZCode updater shares index.html but must have no Rasta trigger');
    assert.equal(await evaluate("document.querySelectorAll('.artl-widget-trigger').length"),1);
}
if(target==='claude'){
    await view.webContents.loadURL('https://claude.ai/login');
    await pause(200);assert.equal(await evaluate("document.querySelector('.artl-widget-trigger')"),null);
    await view.webContents.loadURL('app://localhost/chat/fixture');
    await pause(600);assert.equal(await evaluate("document.querySelectorAll('.artl-widget-trigger').length"),1);
}
await load();await pause(600);assert.equal(await evaluate("document.querySelectorAll('.artl-widget-trigger').length"),1);
fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:true,errors}));app.exit(0);
}).catch(error=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:false,error:error.stack}));app.exit(1)});`;
        // Keep the adapter-identification shape present in the fixture vendor startup.
        vendor += target === 'opencode' ? '\nconst rendererProtocol="oc";const rendererHost="renderer";const prefs={contextIsolation:true,nodeIntegration:false};'
            : target === 'zcode' ? '\nconst preload="../preload/index.cjs";const prefs={contextIsolation:true,nodeIntegration:false};const loadWindow=(win,name)=>win.loadFile(`../renderer/${name}.html`);' : '';
        const launcher = "globalThis.vendorLauncherRan = true; require('./index.pre.js');";
        if (target === 'claude') fs.writeFileSync(path.join(source, '.vite/build/index.pre.js'), vendor);
        fs.writeFileSync(path.join(source, main), target === 'claude' ? launcher : vendor);
        fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(pkg));
        const original = path.join(root, 'original.asar'); await asar.createPackage(source, original);
        const adapter = desktopAdapter(original, target, pkg);
        createCodexArchive(original, app, buildCodexPayload(undefined, { target }), { htmlPaths: [], host: { target, app: appRoot, runtime, desktopAdapter: adapter, agentVersion: '1.0.5' } });
        assert.equal(asar.extractFile(app, main).toString(), target === 'claude' ? launcher : vendor);
        if (target === 'claude') assert.equal(asar.extractFile(app, '.vite/build/index.pre.js').toString(), vendor);
        const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(electron, [app], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = ''; child.stderr.on('data', bytes => { log = (log + bytes).slice(-5000); }); child.stdout.resume();
        const timeout = setTimeout(() => child.kill('SIGTERM'), 25000);
        const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); clearTimeout(timeout);
        const value = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result)) : null;
        assert.equal(exit, 0, JSON.stringify(value) + log); assert.equal(value.ok, true); assert.deepEqual(value.errors, []);
        console.log(`PASS: ${target} real ASAR startup, per-response direction and reload, Force RTL precedence and restoration, live fonts, guest/frame isolation, readiness and in-app panel.`);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
