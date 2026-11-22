// Run an isolated Hub fixture, never the installed Antigravity app or its services.
import assert from 'node:assert/strict';
import { checkReadingDependency } from './helpers/reading-dependency.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { buildCodexPayload } from '../bin/lib/codex.js';

const require = createRequire(import.meta.url), electron = require('electron');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-antigravity-electron-')));
const hostApp = path.join(root, 'Antigravity.app'), archive = path.join(hostApp, 'Contents/Resources/app.asar');
const host = path.join(root, 'rasta'), runtime = path.join(root, 'runtime');
const result = path.join(root, 'result.json'), calls = path.join(root, 'calls.jsonl'), updateFile = path.join(root, 'update-available');
const readingFile = path.join(root, 'reading.json');
try {
    fs.mkdirSync(host); fs.mkdirSync(path.join(archive, 'dist'), { recursive: true }); fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
    for (const name of ['main.cjs', 'bridge.cjs', 'antigravity-bridge.cjs', 'antigravity-preload.cjs']) fs.copyFileSync(new URL(`../bin/host/${name}`, import.meta.url), path.join(host, name));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'rasta-antigravity-fixture', version: '1.0.0', main: 'rasta/main.cjs' }));
    fs.writeFileSync(path.join(host, 'host.json'), JSON.stringify({ app: hostApp, runtime, target: 'antigravity', originalMain: 'vendor.cjs' }));
    fs.writeFileSync(path.join(host, 'rasta-payload.js'), buildCodexPayload({ all: [], fa: [], en: [] }, { target: 'antigravity' }));
    fs.writeFileSync(path.join(archive, 'dist/preload.js'), "require('electron').contextBridge.exposeInMainWorld('vendorPreloadSentinel', 'unchanged');");
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist/utils.js'), 'const hubs = []; exports.hubs = hubs; exports.getHubWindows = () => hubs; exports.getHubWebContents = win => win.webContents;');
    fs.writeFileSync(path.join(root, 'guest.cjs'), '// guest preload');
    fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
    fs.writeFileSync(readingFile, JSON.stringify({ fs: '18', lh: '1.8', isRTL: true, forceRTL: false, fixAtSign: true }));
    fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `const fs=require('fs');const action=process.argv[process.argv.indexOf('--rpc')+1];
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({action,target:process.env.ARTL_TARGET,view:process.argv.includes('--view')?process.argv[process.argv.indexOf('--view')+1]:null})+'\\n');
const update=fs.existsSync(${JSON.stringify(updateFile)})?{available:true,release:{agentVersion:'9.0.0'}}:{available:false};
const reading=JSON.parse(fs.readFileSync(${JSON.stringify(readingFile)}));
if(action==='reading-save'){const value=process.argv[process.argv.indexOf('--reading-value')+1];reading[process.argv[process.argv.indexOf('--reading-key')+1]]=value==='true'?true:value==='false'?false:value;fs.writeFileSync(${JSON.stringify(readingFile)},JSON.stringify(reading));}
console.log(JSON.stringify({ok:true,value:action==='status'?{update}:action==='check'?update:action==='reading-save'?reading:action==='preferences'?{selected:'vazir',fonts:[],active:null,reading}:{}}));`);
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root, 'key.pem'), '-out', path.join(root, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'pipe' });
    const sample = String.fromCodePoint(0x633, 0x644, 0x627, 0x645);
    // Content markers come from the installed 2.31.0 Hub renderer, not the legacy IDE.
    const html = `<html><body><p id="chrome">Navigation</p><div data-testid="agent-response"><p id="reading">${sample}</p><p id="latin">English paragraph</p><pre><code id="code">const untouched = true;</code></pre></div><div data-testid="user-message-content"><p id="user">${sample}</p></div><div contenteditable="true" id="composer">${sample}</div><iframe src="/embedded"></iframe></body></html>`;
    const vendor = `const {app,BrowserWindow,session}=require('electron');const vendorRegistry=require('./dist/utils.js');const fs=require('fs'),path=require('path'),https=require('https'),assert=require('assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));app.dock?.hide();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
session.defaultSession.setCertificateVerifyProc((_request,done)=>done(0));
const server=https.createServer({key:fs.readFileSync(path.join(__dirname,'key.pem')),cert:fs.readFileSync(path.join(__dirname,'cert.pem'))},(_request,response)=>{response.setHeader('content-type','text/html; charset=utf-8');response.end(_request.url==='/embedded'?'<html><body>Embedded content</body></html>':${JSON.stringify(html)})});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='https://127.0.0.1:'+server.address().port+'/';
const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:${JSON.stringify(path.join(archive, 'dist/preload.js'))}}});
vendorRegistry.hubs.push(win);
const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
await win.loadURL(url);const evaluate=code=>win.webContents.executeJavaScript(code,true);
for(let n=0;n<100;n++){if(await evaluate("getComputedStyle(document.getElementById('reading')).direction === 'rtl' && getComputedStyle(document.getElementById('reading')).fontSize === '18px'"))break;await pause(50)}
assert.equal(await evaluate('vendorPreloadSentinel'),'unchanged');
assert.equal(await evaluate('typeof rastaNative'),'undefined','main world has no Rasta bridge');
assert.equal(await evaluate('typeof __rastaPro'),'undefined','payload state is private');
assert.equal(await evaluate("getComputedStyle(document.getElementById('reading')).direction"),'rtl', JSON.stringify(await evaluate("({html:document.body.innerHTML,text:document.getElementById('reading').textContent})")) + JSON.stringify(errors));
assert.equal(await evaluate("getComputedStyle(document.getElementById('reading')).fontSize"),'18px');
assert.equal(await evaluate("getComputedStyle(document.getElementById('composer')).direction"),'rtl');
const alignment=()=>evaluate("getComputedStyle(document.getElementById('reading')).textAlign");
assert.equal(await evaluate("document.querySelectorAll('.artl-message-direction-control button').length"),1);
const toggleDirection=()=>evaluate("document.querySelector('.artl-message-direction-control button').click()");
await toggleDirection();
for(let n=0;n<20&&await alignment()!=='left';n++)await pause(25);
assert.equal(await alignment(),'left');
assert.equal(await evaluate("getComputedStyle(document.getElementById('user')).direction"),'rtl');
await evaluate("document.getElementById('reading').textContent += ' extended'");
await pause(100);
assert.equal(await alignment(),'left');
await toggleDirection();
for(let n=0;n<20&&await alignment()!=='right';n++)await pause(25);
assert.equal(await alignment(),'right');
await evaluate("window.fixtureResponseText = document.getElementById('reading').textContent; document.getElementById('reading').textContent = 'A different response'");
for(let n=0;n<20&&await alignment()!=='left';n++)await pause(25);
assert.equal(await alignment(),'left','a recycled response starts with automatic alignment');
await evaluate("document.getElementById('reading').textContent = window.fixtureResponseText");
for(let n=0;n<20&&await alignment()!=='right';n++)await pause(25);
await toggleDirection();
for(let n=0;n<20&&await alignment()!=='left';n++)await pause(25);
assert.equal(await alignment(),'left');
assert.notEqual(await evaluate("getComputedStyle(document.getElementById('code')).direction"),'rtl');
assert.equal(await evaluate("document.querySelector('iframe').contentDocument.querySelector('.artl-widget-trigger')"),null);
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').hidden"),false,'an up-to-date installation keeps the Rasta shortcut visible');
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').hasAttribute('data-panel')"),true);
await evaluate("document.getElementById('composer').dataset.testid = 'agent-input-box'; document.querySelectorAll('[data-testid]:not(#composer)').forEach(element => element.hidden = true)");
await pause(100);
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').getClientRects().length"),1,'a new chat needs only the composer');
await evaluate("document.body.append(Object.assign(document.createElement('div'), {id:'settings', className:'settings-modal-container', textContent:'Appearance'}))");
await pause(100);
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').getClientRects().length"),0,'the Settings modal can cover a still-mounted chat');
await evaluate("document.getElementById('settings').remove(); document.querySelectorAll('[data-testid]').forEach(element => element.hidden = false)");
await pause(100);
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').getClientRects().length"),1);
assert.equal(await evaluate("document.querySelector('.artl-update-badge').hidden"),true);
const panelVisible=()=>evaluate("!!document.querySelector('.artl-widget-container div')?.shadowRoot?.querySelector('[role=dialog]')");
await evaluate("document.querySelector('.artl-widget-trigger').click()");
for(let n=0;n<100;n++){if(await panelVisible())break;await pause(50)}
assert.equal(await panelVisible(),true,'the trigger opens the in-app panel');
const shadow="document.querySelector('.artl-widget-container div').shadowRoot";
assert.deepEqual(await evaluate("Array.from("+shadow+".querySelectorAll('[data-slot=accordion-trigger]'), button => button.textContent.trim())"), ['Reading', 'Typography']);
await evaluate(shadow+".querySelectorAll('[data-slot=accordion-trigger]')[1].click()");
const sizeValue=()=>evaluate(shadow+".querySelector('#text-size [data-slot=select-value]')?.textContent.trim()");
for(let n=0;n<100;n++){if(await sizeValue()==='18 px')break;await pause(25)}
assert.equal(await sizeValue(), '18 px');
await evaluate(shadow+".querySelectorAll('[data-slot=accordion-trigger]')[0].click()");

const nextReading=JSON.parse(fs.readFileSync(${JSON.stringify(readingFile)}));
const setForce=async active=>{
    nextReading.forceRTL=active;
    fs.writeFileSync(${JSON.stringify(readingFile)},JSON.stringify(nextReading));
    await evaluate("window.dispatchEvent(new Event('focus'))");
};
nextReading.fs='16';nextReading.lh='1.4';
await setForce(true);
for(let n=0;n<100;n++){if(await evaluate("getComputedStyle(document.getElementById('latin')).direction === 'rtl' && getComputedStyle(document.getElementById('reading')).fontSize === '16px'"))break;await pause(50)}
assert.equal(await evaluate("getComputedStyle(document.getElementById('latin')).direction"),'rtl');
assert.equal(await alignment(),'right','Force RTL takes precedence over the saved left alignment');
assert.equal(await evaluate("document.querySelectorAll('.artl-message-direction-control button').length"),0);
assert.equal(await evaluate("getComputedStyle(document.getElementById('reading')).fontSize"),'16px');
assert.equal(await evaluate("getComputedStyle(document.getElementById('reading')).lineHeight"),'22.4px');
assert.equal(await evaluate("getComputedStyle(document.getElementById('user')).fontSize"),'16px');
assert.equal(await evaluate("getComputedStyle(document.getElementById('chrome')).direction"),'ltr');
assert.equal(await evaluate("document.getElementById('code').hasAttribute('dir')"),false);
await (${checkReadingDependency})({
    evaluate, assert, pause, textSelector: '#latin', inputSelector: '#composer',
    setEnabled: async isRTL => {
        nextReading.isRTL = isRTL;
        await setForce(true);
    },
});
await setForce(false);
for(let n=0;n<100&&await alignment()!=='left';n++)await pause(25);
assert.equal(await alignment(),'left','Turning Force RTL off restores the saved left alignment');
assert.equal(await evaluate("document.querySelector('.artl-message-direction-control.has-override button')?.dataset.direction"),'ltr');
const readingSwitch="document.querySelector('.artl-widget-container div').shadowRoot.querySelector('[role=switch]')";
for(const enabled of [false,true]){
await evaluate(readingSwitch+".click()");
for(let n=0;n<100;n++){if(await evaluate("document.querySelector('.artl-widget-trigger').dataset.active")===String(enabled))break;await pause(50)}
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').dataset.active"),String(enabled),'the launcher updates while its panel stays open');
assert.equal(await panelVisible(),true);
}
for(let n=0;n<100;n++){if(fs.existsSync(${JSON.stringify(calls)})&&fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('ready'))break;await pause(50)}
const actions=fs.readFileSync(${JSON.stringify(calls)},'utf8').trim().split('\\n').map(line=>JSON.parse(line));
assert.ok(actions.some(value=>value.action==='ready'));assert.ok(!actions.some(value=>value.action==='manager-open'));assert.ok(actions.every(value=>value.target==='antigravity'));
const badgeHidden=()=>evaluate("document.querySelector('.artl-update-badge').hidden");
for(const available of [true,false]){
if(available)fs.writeFileSync(${JSON.stringify(updateFile)},'');else fs.unlinkSync(${JSON.stringify(updateFile)});
await evaluate("window.dispatchEvent(new Event('focus'))");
for(let n=0;n<100;n++){if(await badgeHidden()===!available)break;await pause(50)}
assert.equal(await badgeHidden(),!available,'the update badge follows availability');
assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').hidden"),false);
}
const guest=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(__dirname,'guest.cjs')}});await guest.loadURL(url);await pause(300);
assert.equal(await guest.webContents.executeJavaScript("document.querySelector('.artl-widget-trigger')"),null);
await win.loadURL(url+'navigation');await pause(600);
assert.equal(await evaluate("document.querySelectorAll('.artl-widget-trigger').length"),1,'navigation remounts exactly once');
fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:true,errors}));server.close();app.exit(0);
}).catch(error=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:false,error:error.stack}));app.exit(1)});`;
    fs.writeFileSync(path.join(root, 'vendor.cjs'), vendor);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stderr.on('data', bytes => { log = (log + bytes).slice(-5000); }); child.stdout.resume();
    const timeout = setTimeout(() => child.kill('SIGTERM'), 25000);
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); clearTimeout(timeout);
    const value = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result)) : null;
    assert.equal(exit, 0, JSON.stringify(value) + log); assert.equal(value.ok, true); assert.deepEqual(value.errors, []);
    assert.deepEqual(fs.readFileSync(path.join(root, 'vendor.cjs'), 'utf8'), vendor);
    console.log('PASS: Antigravity per-response direction, Force RTL precedence and restoration, recycling, private-world RTL, live reading preferences, vendor preload, guest/frame isolation, panel, readiness and navigation.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
