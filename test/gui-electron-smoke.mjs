// Runs OUR minimal Electron fixture. Never launches or controls installed Codex.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { buildCodexPayload } from '../bin/lib/codex.js';
import { checkReadingDependency } from './helpers/reading-dependency.js';
const t3 = process.env.ARTL_TEST_TARGET === 't3';
const require = createRequire(import.meta.url), electron = require('electron');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-own-electron-'));
const host = path.join(folder, 'rasta'), runtime = path.join(folder, 'runtime');
fs.mkdirSync(host); fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
const result = path.join(folder, 'result.json'), calls = path.join(folder, 'calls.jsonl');
const sentinel = path.join(folder, 'original-main.cjs');
try {
    for (const name of ['main.cjs', 'bridge.cjs', 'preload.cjs']) fs.copyFileSync(new URL(`../bin/host/${name}`, import.meta.url), path.join(host, name));
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'rasta-fixture', version: '1.0.0', main: 'rasta/main.cjs' }));
    fs.writeFileSync(path.join(host, 'host.json'), JSON.stringify({ app: '/Applications/Rasta Fixture.app', runtime, target: t3 ? 't3' : 'codex', originalMain: 'original-main.cjs' }));
    fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
    fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `const fs=require('fs');const action=process.argv[process.argv.indexOf('--rpc')+1];fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(action)+String.fromCharCode(10));
const operation=fs.existsSync(${JSON.stringify(calls + '.prepared')})?{phase:'ready-to-install',progress:1}:null;
const release=fs.existsSync(${JSON.stringify(calls + '.release')})?JSON.parse(fs.readFileSync(${JSON.stringify(calls + '.release')},'utf8')):{available:true,supported:true,phase:'available',releaseConfigured:true,release:{agentVersion:'2.1.0'}};
if(action==='check'&&fs.existsSync(${JSON.stringify(calls + '.delay')}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
if(action==='check'&&fs.existsSync(${JSON.stringify(calls + '.reject')})){console.error('Fixture network error');process.exit(1);}
if(action==='prepare')fs.writeFileSync(${JSON.stringify(calls + '.prepared')},'yes');
const readingFile=${JSON.stringify(calls + '.reading')};
if(action==='reading-save'){
 const key=process.argv[process.argv.indexOf('--reading-key')+1];
 const value=JSON.parse(process.argv[process.argv.indexOf('--reading-value')+1]);
 const baseline=JSON.parse(process.argv[process.argv.indexOf('--reading-baseline')+1]);
 fs.writeFileSync(readingFile,JSON.stringify({...baseline,[key]:value}));
}
const reading=fs.existsSync(readingFile)?JSON.parse(fs.readFileSync(readingFile,'utf8')):null;
console.log(JSON.stringify({ok:true,value:action==='status'?{running:!!operation,operation,update:release}:action==='check'?release:action==='preferences'?{selected:'vazir',fonts:[],active:null,reading}:action==='reading-save'?reading:{id:'fixture'}}));`);
    fs.writeFileSync(path.join(folder, 'vendor-preload.cjs'), `require('electron').contextBridge.exposeInMainWorld('vendorPreloadSentinel','unchanged');`);
    fs.writeFileSync(path.join(folder, 'payload.js'), buildCodexPayload({ all: [], fa: [], en: [] }));
    let html = '<!doctype html><html><head><meta charset="utf-8"></head><body><textarea data-codex-composer data-chat-composer-main-surface></textarea><div data-markdown-text-style="assistant-message"><p>متن آزمایشی فارسی</p></div><script src="app://-/payload.js"></script></body></html>';
    if (t3) html = html.replace('<div data-markdown-text-style="assistant-message"><p>', '<div class="messages-timeline-scroll"><div data-timeline-row-kind="message" data-message-role="assistant" data-message-id="reply-1"><div class="chat-markdown"><p>').replace('</p></div><script', '</p></div></div></div><script');
    let fixtureCode = `const {app,BrowserWindow,protocol}=require('electron');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setPath('userData',path.join(__dirname,'profile'));app.dock?.hide();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
protocol.handle('app',request=>new Response(new URL(request.url).pathname==='/payload.js'?fs.readFileSync(path.join(__dirname,'payload.js')):${JSON.stringify(html)},{headers:{'content-type':new URL(request.url).pathname==='/payload.js'?'text/javascript':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"}}));
const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(__dirname,'vendor-preload.cjs')}});
const errors=[];win.webContents.on('console-message',(_event,details)=>{if(details?.level==='error')errors.push(details.message)});
await win.loadURL('app://-/index.html');
const evaluate=code=>win.webContents.executeJavaScript(code,true);
for(let n=0;n<100;n++){if(await evaluate("!!document.querySelector('.artl-widget-trigger') && !document.querySelector('.artl-widget-trigger').hidden"))break;await pause(50)}
assert.equal(await evaluate('vendorPreloadSentinel'),'unchanged');
assert.deepEqual(await evaluate('Object.keys(rastaNative).sort()'),['check','chooseFonts','importFont','openManager','preferences','removeFont','saveReading','selectFont','status']);
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').hidden"),false);
for(let n=0;n<100;n++){if(await evaluate("document.querySelector('.artl-update-badge').getBoundingClientRect().width > 0"))break;await pause(50)}
assert.equal(await evaluate("document.querySelector('.artl-update-badge').getBoundingClientRect().width > 0"),true);
assert.equal(await evaluate("document.querySelectorAll('.artl-widget-panel,.artl-version,.artl-accent-swatch,#artl-font-add,#artl-update-check,#artl-update-restore').length"),0);
await evaluate("document.querySelector('.artl-widget-trigger').click()");
for(let n=0;n<100;n++){if(await evaluate("document.querySelector('.artl-widget-container div').shadowRoot?.activeElement?.dataset.slot==='dialog-close'"))break;await pause(50)}
fs.writeFileSync(${JSON.stringify(calls + '.delay')}, '');
await evaluate("(() => { const refresh = [...document.querySelector('.artl-widget-container div').shadowRoot.querySelectorAll('button')].find(button=>button.textContent.trim()==='Refresh'); refresh.focus(); refresh.click(); })()");
await pause(150);
assert.equal(await evaluate("document.querySelector('.artl-widget-container div').shadowRoot.activeElement?.getAttribute('aria-busy')"),'true','checking keeps focus on the refresh button');
for(let n=0;n<150;n++){if(await evaluate("[...document.querySelector('.artl-widget-container div').shadowRoot.querySelectorAll('button')].some(button=>button.textContent.trim()==='Open Rasta')"))break;await pause(50)}
assert.equal(await evaluate("!!document.querySelector('.artl-widget-container div').shadowRoot.querySelector('[role=dialog] [data-sonner-toast]')"),true,'the update result stays inside the open panel');
fs.rmSync(${JSON.stringify(calls + '.delay')});
await evaluate("[...document.querySelector('.artl-widget-container div').shadowRoot.querySelectorAll('button')].find(button=>button.textContent.trim()==='Open Rasta').click()");
for(let n=0;n<100;n++){if(fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('"manager-open"'))break;await pause(50)}
assert.ok(fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('"manager-open"'));
assert.ok(!fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('"prepare"'));
for(let n=0;n<50;n++){if(fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('"ready"'))break;await pause(50)}
assert.ok(fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('"ready"'));
const setRelease=async value=>{
 fs.writeFileSync(${JSON.stringify(calls + '.release')},JSON.stringify(value));
 await evaluate("window.dispatchEvent(new Event('focus'))");await pause(200);
};
await setRelease({available:false,releaseError:'offline'});
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').hidden"),false,'a transient failure retains the known update');
await setRelease({available:false,release:null});
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').hidden"),false,'Both hosts keep their compact panel without an update');
await setRelease({available:true,release:{agentVersion:'2.1.0'}});
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').hidden"),false);
if(${JSON.stringify(t3)}) {
 assert.equal(await evaluate("document.querySelectorAll('.artl-message-direction-control').length"),1);
 const directionOpacity=()=>evaluate("getComputedStyle(document.querySelector('.artl-message-direction-control')).opacity");
 assert.equal(await directionOpacity(),'0','T3 direction control starts hidden');
 assert.equal(await evaluate("document.querySelector('[data-message-id=reply-1]').lastElementChild.className"),'artl-message-direction-control');
 await evaluate("document.querySelector('.artl-message-direction-control button').click()");await pause(100);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.chat-markdown p')).direction"),'ltr');
 assert.equal(await directionOpacity(),'0','Saving a direction does not reveal the button at rest');
 await evaluate("history.pushState(null, '', '#/local/thread-2')");
 assert.equal(await evaluate("document.querySelector('.artl-message-direction-control button').getAttribute('data-direction')"),'rtl');
 await evaluate("history.pushState(null, '', '#/settings/appearance')");
 assert.equal(await evaluate("document.querySelectorAll('.artl-message-direction-control').length"),0);
 await evaluate("history.pushState(null, '', '#/local/thread-1')");
 assert.equal(await evaluate("document.querySelector('.artl-message-direction-control button').getAttribute('data-direction')"),'ltr');
 await win.reload();await pause(300);
 assert.equal(await evaluate("document.querySelector('.artl-message-direction-control button').getAttribute('data-direction')"),'ltr');
 assert.equal(await directionOpacity(),'0','The saved direction stays hidden on reload');
 const toggleForce=async active=>{
  await evaluate("document.querySelector('.artl-widget-trigger').click()");
  const findSwitch="const root = document.querySelector('.artl-widget-container div').shadowRoot; const label = [...root.querySelectorAll('label')].find(el => el.textContent === 'Enable force RTL'); const control = label && root.getElementById(label.htmlFor);";
  for(let n=0;n<100;n++){if(await evaluate("(() => {"+findSwitch+" return !!control; })()"))break;await pause(25)}
  await evaluate("(() => {"+findSwitch+" control.click(); })()");
  for(let n=0;n<100;n++){if(await evaluate("(() => {"+findSwitch+" return control.getAttribute('aria-checked') === '"+active+"' && !control.hasAttribute('aria-disabled'); })()"))break;await pause(25)}
  assert.equal(JSON.parse(fs.readFileSync(${JSON.stringify(calls + '.reading')},'utf8')).forceRTL,active);
  await evaluate("document.querySelector('.artl-widget-container div').shadowRoot.querySelector('[data-slot=dialog-close]').click()");
 };
 await toggleForce(true);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.chat-markdown p')).direction"),'rtl','Force RTL takes precedence over the saved LTR choice');
 assert.equal(await evaluate("document.querySelectorAll('.artl-message-direction-control').length"),0);
 await toggleForce(false);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.chat-markdown p')).direction"),'ltr','Turning Force RTL off restores the saved LTR choice');
 await evaluate("document.querySelector('.artl-message-direction-control button').click()");await pause(100);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.chat-markdown p')).direction"),'rtl');
}
await (${checkReadingDependency})({
 evaluate, assert, pause, textSelector: 'p', inputSelector: 'textarea',
 setEnabled: async isRTL => {
  fs.writeFileSync(${JSON.stringify(calls + '.reading')}, JSON.stringify({isRTL, forceRTL: true, fixAtSign: true}));
  await evaluate("window.dispatchEvent(new Event('focus'))");
 },
});
const embedded=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});await embedded.loadURL('app://-/document.html');
assert.equal(await embedded.webContents.executeJavaScript('typeof window.rastaNative'),'undefined');
await embedded.loadURL('app://-/index.html?initialRoute=/spotlight');
assert.equal(await embedded.webContents.executeJavaScript('typeof window.rastaNative'),'undefined');
fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:true,errors}));app.exit(0);
}).catch(error=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:false,error:error.stack}));app.exit(1)});`;
    if (t3) fixtureCode = fixtureCode.replaceAll("scheme:'app'", "scheme:'t3code'").replaceAll("protocol.handle('app'", "protocol.handle('t3code'").replaceAll('app://-', 't3code://app').replace("win.loadURL('t3code://app/index.html')", "win.loadURL('t3code://app/#/local/thread-1')").replace("t3code://app/index.html?initialRoute=/spotlight", "t3code://embed/index.html");
    fs.writeFileSync(sentinel, fixtureCode);
    const original = fs.readFileSync(sentinel);
    const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [folder], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stderr.on('data', bytes => { log = (log + bytes).slice(-5000); }); child.stdout.resume();
    const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
    const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); clearTimeout(timeout);
    const value = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result)) : null;
    assert.equal(exit, 0, JSON.stringify(value) + log);
    assert.equal(value.ok, true); assert.deepEqual(fs.readFileSync(sentinel), original);
    assert.ok(fs.readFileSync(calls, 'utf8').includes('"manager-open"'));
    console.log('PASS: Electron 42 registered preload, vendor preload and main preserved, fixed IPC, compact panel with manager shortcut and bounded reading controls and auxiliary-window isolation.');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
