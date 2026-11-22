// Exercise the shared panel's file chooser, native IPC and persistence in an
// owned Electron app using the selected host protocol and restrictive font policy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { buildCodexPayload } from '../bin/lib/codex.js';
const t3 = process.env.ARTL_TEST_TARGET === 't3';
const require = createRequire(import.meta.url), electron = require('electron');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-font-electron-'));
const host = path.join(folder, 'rasta'), runtime = path.join(folder, 'runtime');
fs.mkdirSync(host); fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
const result = path.join(folder, 'result.json');
try {
    for (const name of ['main.cjs', 'bridge.cjs', 'preload.cjs']) fs.copyFileSync(new URL(`../bin/host/${name}`, import.meta.url), path.join(host, name));
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'rasta-font-fixture', version: '1.0.0', main: 'rasta/main.cjs' }));
    fs.writeFileSync(path.join(host, 'host.json'), JSON.stringify({ app: '/Applications/Rasta Font Fixture.app', runtime, target: t3 ? 't3' : 'codex', originalMain: 'fixture.cjs' }));
    fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
    const preferencesModule = new URL('../bin/lib/font-preferences.js', import.meta.url).href;
    fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `
const action=process.argv[process.argv.indexOf('--rpc')+1];
(async()=>{
 const fonts=await import(${JSON.stringify(preferencesModule)});
 let value={};
 if(action==='preferences')value={...fonts.fontPreferences(),reading:null};
 if(action==='font-import'||action==='font-select'||action==='font-remove'){
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  const input=JSON.parse(Buffer.concat(chunks).toString());
  if(action==='font-import') value=fonts.importFont(input);
  else if(action==='font-remove') value=fonts.removeFont(input.id);
  else value=fonts.selectFont(input.id);
 }
 console.log(JSON.stringify({ok:true,value}));
})().catch(error=>{console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});`);
    fs.writeFileSync(path.join(folder, 'payload.js'), buildCodexPayload());
    const fontFile = process.env.ARTL_TEST_FONT || new URL('../bin/assets/Vazir-Bold.ttf', import.meta.url).pathname;
    const brokenFont = path.join(folder, 'Broken.ttf');
    fs.writeFileSync(brokenFont, 'broken');
    const bundledFixture = !process.env.ARTL_TEST_FONT;
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><textarea data-codex-composer data-chat-composer-main-surface></textarea><aside id="sidebar">گفتگوها</aside><div data-markdown-text-style><p id="message">سلام دنیا Hello world</p></div><script src="app://-/payload.js"></script></body></html>';
    let fixtureCode = `
const {app,BrowserWindow,dialog,protocol}=require('electron');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setPath('userData',path.join(__dirname,'profile'));app.dock?.hide();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 protocol.handle('app',request=>new Response(new URL(request.url).pathname==='/payload.js'?fs.readFileSync(path.join(__dirname,'payload.js')):${JSON.stringify(html)},{headers:{'Content-Type':new URL(request.url).pathname==='/payload.js'?'text/javascript':'text/html','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"}}));
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
 let completeChooser;
 dialog.showOpenDialog = async (parent, options) => {
  assert.equal(parent,win);
  assert.deepEqual(options.filters.map(filter=>filter.extensions),[['ttf','otf']]);
  assert.deepEqual(options.properties,['openFile','multiSelections']);
  return await new Promise(resolve=>{completeChooser=resolve});
 };
 const waitForChooser=async()=>{
  for(let i=0;i<100&&!completeChooser;i++)await pause(30);
  assert.ok(completeChooser,'Add font opens the restricted native chooser.');
  const complete=completeChooser;completeChooser=undefined;return complete;
 };
 await win.loadURL('app://-/index.html');
 const evaluate=code=>win.webContents.executeJavaScript(code,true).catch(error=>{
  throw Error(error.message+' In expression '+code);
 });
 for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('.artl-widget-container')"))break;await pause(30)}
 assert.equal(await evaluate("document.querySelectorAll('#artl-font-add,#artl-app-font,input[type=file]').length"),0,'font controls stay inside the Rasta panel');
 win.webContents.debugger.attach('1.3');
 await evaluate("document.querySelector('.artl-widget-trigger').click()");
 await pause(250);
 await evaluate("Array.from(document.querySelector('.artl-widget-container div').shadowRoot.querySelectorAll('button')).find(el=>el.textContent.trim()==='Typography').click()");
 await pause(250);
 await evaluate("document.querySelector('.artl-widget-container div').shadowRoot.querySelector('#font-family').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 await pause(250);
 const addFont=()=>evaluate("Array.from(document.querySelector('.artl-widget-container div').shadowRoot.querySelectorAll('[role=menuitem]')).find(el=>el.textContent.trim()==='Add font').click()");
 await addFont();
 const completeSelection=await waitForChooser();
 // Native picker return can deliver an outside interaction and restore host focus.
 await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));document.querySelector('#sidebar').tabIndex=0;document.querySelector('#sidebar').focus()");
 await pause(250);
 assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').getAttribute('aria-expanded')"),'true','Host focus restoration keeps the panel open during native selection.');
 assert.equal(await evaluate("document.querySelector('.artl-widget-container div').shadowRoot.querySelector('input[type=file]')"),null);
 completeSelection({canceled:false,filePaths:[${JSON.stringify(fontFile)}]});
 const shadow="document.querySelector('.artl-widget-container div').shadowRoot";
 for(let i=0;i<150;i++){if(await evaluate("rastaNative.preferences().then(value=>value.fonts.length===1)"))break;await pause(30)}
 const imported=await evaluate("rastaNative.preferences()");
 assert.equal(imported.fonts.length,1,'The panel file chooser must import and select the font.');
 for(let i=0;i<150;i++){if(await evaluate("getComputedStyle(document.querySelector('#sidebar')).fontFamily.includes('RastaUser_')"))break;await pause(30)}
 const state=await evaluate("({font:getComputedStyle(document.querySelector('#sidebar')).fontFamily})");
 assert.match(state.font,/RastaUser_/,JSON.stringify(state));
 const saved=await evaluate("rastaNative.preferences().then(value=>({selected:value.selected,count:value.fonts.length,label:value.fonts.find(font=>font.id===value.selected)?.label}))");
 assert.equal(saved.selected,imported.selected);assert.equal(saved.count,1);
 const {root}=await win.webContents.debugger.sendCommand('DOM.getDocument');
 await win.webContents.debugger.sendCommand('CSS.enable');
 const {nodeId:sidebarNode}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'#sidebar'});
 const {fonts:renderedFonts}=await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode',{nodeId:sidebarNode});
 assert.ok(renderedFonts.some(font=>font.isCustomFont&&font.glyphCount>0),'The selected face must actually render the Persian glyphs.');
 if(${bundledFixture}) {
  assert.equal(saved.label,'Vazir Bold');
  assert.ok(renderedFonts.some(font=>font.isCustomFont&&font.glyphCount>0&&font.postScriptName==='Vazir-Bold'));
 }
 // Successful import updates the visible catalog as well as persisted state.
 assert.equal(await evaluate("document.querySelector('.artl-widget-container div').shadowRoot.querySelector('#font-family').textContent.includes("+JSON.stringify(saved.label)+")"),true);
 await evaluate("document.querySelector('.artl-widget-container div').shadowRoot.querySelector('#font-family').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 await pause(250);
 await addFont();
 const cancelSelection=await waitForChooser();
 cancelSelection({canceled:true,filePaths:[]});
 await pause(250);
 await evaluate("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}))");
 await pause(250);
 assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').getAttribute('aria-expanded')"),'false','Cancelling the chooser must restore normal panel dismissal.');
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
 for(let i=0;i<150;i++){if(await evaluate("!!document.querySelector('#sidebar') && getComputedStyle(document.querySelector('#sidebar')).fontFamily.includes('RastaUser_')"))break;await pause(30)}
 assert.match(await evaluate("getComputedStyle(document.querySelector('#sidebar')).fontFamily"),/RastaUser_/);
 await evaluate("document.querySelector('.artl-widget-trigger').click()");
 await evaluate("Array.from("+shadow+".querySelectorAll('button')).find(el=>el.textContent.trim()==='Typography').click()");
 await evaluate(shadow+".querySelector('#font-family').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 await evaluate("Array.from("+shadow+".querySelectorAll('[role=menuitem]')).find(el=>el.getAttribute('aria-label')==="+JSON.stringify('Remove '+saved.label)+").click()");
 await evaluate("Array.from("+shadow+".querySelectorAll('[role=alertdialog] button')).find(el=>el.textContent.trim()==='Remove font').click()");
 for(let i=0;i<150;i++){if(await evaluate(shadow+".activeElement?.id==='font-family' && "+shadow+".querySelector('#current-reading-font')?.textContent==='Vazir'"))break;await pause(30)}
 assert.equal(await evaluate(shadow+".activeElement?.id"),'font-family','Removing from the panel returns focus to Font.');
 assert.equal(await evaluate("document.querySelector('.artl-widget-trigger').getAttribute('aria-expanded')"),'true','Removing a font keeps the panel open.');
 const restored=await evaluate("rastaNative.preferences()");
 assert.equal(restored.selected,'vazir');
 assert.deepEqual(restored.fonts,[]);
 for(let i=0;i<150;i++){if(await evaluate("!getComputedStyle(document.querySelector('#sidebar')).fontFamily.includes('RastaUser_')"))break;await pause(30)}
 assert.doesNotMatch(await evaluate("getComputedStyle(document.querySelector('#sidebar')).fontFamily"),/RastaUser_/);
 await evaluate("rastaNative.importFont('Reading.ttf',"+JSON.stringify(imported.active.data)+")");
 await evaluate("rastaNative.selectFont('vazir')");
 const remaining=await evaluate("rastaNative.removeFont('vazir')");
 assert.equal(remaining.vazirRemoved,true);
 assert.equal(remaining.selected,imported.selected);
 await assert.rejects(evaluate("rastaNative.removeFont("+JSON.stringify(imported.selected)+")"),/Keep at least one font/);
 assert.equal(await evaluate("rastaNative.preferences().then(value=>value.selected)"),imported.selected);
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
 for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('.artl-widget-trigger[data-panel]')"))break;await pause(30)}
 await evaluate("document.querySelector('.artl-widget-trigger').click()");
 await pause(250);
 await evaluate("Array.from("+shadow+".querySelectorAll('button')).find(el=>el.textContent.trim()==='Typography').click()");
 await pause(250);
 await evaluate(shadow+".querySelector('#font-family').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 await pause(250);
 await addFont();
 const completeInvalidSelection=await waitForChooser();
 completeInvalidSelection({canceled:false,filePaths:[${JSON.stringify(brokenFont)}]});
 const errorDescription=shadow+".querySelector('[data-sonner-toast][data-type=error] [data-description]')";
 for(let i=0;i<100;i++){if(await evaluate(errorDescription+"?.textContent.includes('Broken.ttf')"))break;await pause(30)}
 assert.equal(await evaluate(errorDescription+"?.textContent"),'Broken.ttf: Choose a valid TTF or OTF font (up to 2 MB).');
 assert.equal(await evaluate(shadow+".querySelector('[data-slot=alert]')"),null);
 assert.equal(await evaluate("rastaNative.preferences().then(value=>value.selected)"),imported.selected);
 fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:true,state}));app.exit(0);
}).catch(error=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:false,error:error.stack}));app.exit(1)});`;
    if (t3) fixtureCode = fixtureCode.replaceAll("scheme:'app'", "scheme:'t3code'").replaceAll("protocol.handle('app'", "protocol.handle('t3code'").replaceAll('app://-', 't3code://app');
    fs.writeFileSync(path.join(folder, 'fixture.cjs'), fixtureCode);
    const env = { ...process.env, ARTL_CODEX_STATE_HOME: folder, ARTL_TARGET: t3 ? 't3' : 'codex' }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [folder], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stderr.on('data', bytes => { log = (log + bytes).slice(-2500); }); child.stdout.resume();
    const timeout = setTimeout(() => child.kill('SIGTERM'), 20000);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); clearTimeout(timeout);
    const value = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result)) : null;
    assert.equal(code, 0, JSON.stringify(value) + log);
    console.log('PASS: Electron panel font import and removal, dismissal protection, cancellation, native font IPC, custom glyphs and reload persistence.');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
