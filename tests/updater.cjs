"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../extension/updater.js'), 'utf8');
const tick = () => new Promise(r => setImmediate(r));
function setup(initial = {}, granted = true, response = {protocol:1,status:'current'}) {
  const state = {enabled:false,...initial}, listeners = {}, calls = [], alarms = [];
  let reloads = 0;
  const event = key => ({addListener(fn){listeners[key] = fn;}});
  const chrome = {
    runtime:{id:'abcdefghijklmnopabcdefghijklmnop',lastError:null,getURL:p=>`chrome-extension://abcdefghijklmnopabcdefghijklmnop/${p}`,
      onMessage:event('message'),onStartup:event('startup'),onInstalled:event('installed'),
      reload(){reloads++;},sendNativeMessage(host,msg,cb){calls.push({host,msg});if(response instanceof Error) chrome.runtime.lastError={message:response.message};cb(response);chrome.runtime.lastError=null;}},
    permissions:{contains(_,cb){cb(granted);}},
    storage:{local:{get(defaults,cb){cb({...defaults,...state});},set(values,cb){Object.assign(state,values);cb();}}},
    alarms:{create(name,opts){alarms.push({name,...opts});},clear(_,cb){cb(true);},onAlarm:event('alarm')}
  };
  vm.runInNewContext(source,{chrome,Date,Object,Promise,Error});
  const sender={id:chrome.runtime.id,url:chrome.runtime.getURL('popup.html')};
  const message=(m,s=sender)=>new Promise(resolve=>{const handled=listeners.message(m,s,resolve);if(!handled)resolve(null);});
  return {state,listeners,calls,alarms,message,chrome,get reloads(){return reloads;}};
}
function popupSetup(granted = true, initial = {}) {
  const state = {updaterEnabled:false,updaterStatus:'off',enabled:false,...initial};
  const nodes = {}, messages = [], requests = [];
  for (const id of ['auto-update','update-now','update-status','update-label','update-help'])
    nodes[id] = {disabled:true,checked:false,textContent:'',addEventListener(event,fn){this[event]=fn;}};
  const chrome = {
    runtime:{lastError:null,sendMessage(msg,cb){messages.push(msg);cb({status:'current'});}},
    permissions:{request(permissions,cb){requests.push(permissions);cb(granted);}},
    storage:{local:{get(defaults,cb){cb({...defaults,...state});}},onChanged:{addListener(){}}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/updater-popup.js'),'utf8'),
    {chrome,navigator:{language:'en-US'},document:{getElementById:id=>nodes[id]}});
  return {nodes,messages,requests,state};
}
let passed=0;
async function test(name,fn){await fn();console.log(`PASS ${++passed}: ${name}`);}
(async()=>{
  await test('startup default off does not invoke native host',async()=>{const t=setup();await t.listeners.startup();assert.equal(t.calls.length,0);assert.equal(t.state.enabled,false);});
  await test('opt in checks host and creates daily alarm, preserves main setting',async()=>{const t=setup();assert.equal((await t.message({action:'configure-updater',enabled:true})).status,'current');assert.equal(t.state.updaterEnabled,true);assert.equal(t.calls.length,1);assert.equal(t.alarms[0].periodInMinutes,1440);assert.equal(t.state.enabled,false);assert.equal(JSON.stringify(t.calls[0]),JSON.stringify({host:'com.searchclean.updater',msg:{protocol:1,action:'update'}}));});
  await test('denied permission cannot opt in or call native host',async()=>{const t=setup({},false);assert.equal((await t.message({action:'configure-updater',enabled:true})).status,'denied');assert.equal(t.calls.length,0);assert.notEqual(t.state.updaterEnabled,true);});
  await test('manual request without permission is inert',async()=>{const t=setup({},false);assert.equal((await t.message({action:'update-now'})).status,'off');assert.equal(t.calls.length,0);});
  await test('missing helper reports error without reload',async()=>{const t=setup({},true,new Error('host missing'));assert.equal((await t.message({action:'update-now'})).status,'error');assert.equal(t.reloads,0);assert.equal(t.state.updaterStatus,'error');});
  await test('valid updated reply reloads once, persisted timestamp prevents loop',async()=>{const t=setup({updaterEnabled:true},true,{protocol:1,status:'updated'});await t.listeners.startup();assert.equal(t.reloads,1);await t.listeners.installed();assert.equal(t.calls.length,1);assert.equal(t.reloads,1);});
  await test('committed update reloads even if status persistence fails',async()=>{const t=setup({},true,{protocol:1,status:'updated'});const set=t.chrome.storage.local.set;t.chrome.storage.local.set=(values,cb)=>{if(values.updaterStatus==='updated'){t.chrome.runtime.lastError={message:'write failed'};cb();t.chrome.runtime.lastError=null;}else set(values,cb);};assert.equal((await t.message({action:'update-now'})).status,'updated');assert.equal(t.reloads,1);assert.ok(t.state.updaterLastAttempt>0);});
  await test('invalid protocol and unexpected fields never reload',async()=>{for(const r of [{protocol:2,status:'updated'},{protocol:1,status:'updated',path:'x'},null,{protocol:1,status:'updated',code:5}]){const t=setup({},true,r);assert.equal((await t.message({action:'update-now'})).status,'error');assert.equal(t.reloads,0);}});
  await test('content scripts and external/wrong popup senders cannot update',async()=>{const t=setup();for(const s of [{id:t.chrome.runtime.id,url:'https://www.google.com/search'},{id:'other',url:t.chrome.runtime.getURL('popup.html')},{id:t.chrome.runtime.id,url:t.chrome.runtime.getURL('popup.html'),tab:{id:1}}])assert.equal(await t.message({action:'update-now'},s),null);assert.equal(t.calls.length,0);});
  await test('arbitrary command/path inputs rejected',async()=>{const t=setup();for(const m of [{action:'update-now',path:'C:\\x'},{action:'exec'},{action:'configure-updater',enabled:'yes'}])assert.equal(await t.message(m),null);assert.equal(t.calls.length,0);});
  await test('disable stops automatic calls but leaves hiding preference untouched',async()=>{const t=setup({updaterEnabled:true});await t.message({action:'configure-updater',enabled:false});t.listeners.alarm({name:'search-clean-update'});await tick();assert.equal(t.calls.length,0);assert.equal(t.state.enabled,false);assert.equal(t.state.updaterEnabled,false);});
  await test('rapid repeated requests invoke host once',async()=>{const t=setup();const results=await Promise.all([t.message({action:'update-now'}),t.message({action:'update-now'})]);assert.equal(t.calls.length,1);assert.ok(results.some(r=>r.status==='busy'));assert.equal((await t.message({action:'update-now'})).status,'recent');});
  await test('popup default off, English helper disclosure and no permission request at load',async()=>{const t=popupSetup();assert.equal(t.nodes['auto-update'].checked,false);assert.match(t.nodes['update-help'].textContent,/separately installed/);assert.equal(t.requests.length,0);assert.equal(t.messages.length,0);});
  await test('popup denied permission sends no updater request and restores stored toggle',async()=>{const t=popupSetup(false);t.nodes['auto-update'].checked=true;t.nodes['auto-update'].change();assert.equal(t.messages.length,0);assert.equal(t.nodes['auto-update'].checked,false);assert.match(t.nodes['update-status'].textContent,/not granted/);assert.equal(t.nodes['update-now'].disabled,false);});
  await test('popup granted gesture sends only narrow manual action and displays result',async()=>{const t=popupSetup();t.nodes['update-now'].click();assert.equal(t.requests.length,1);assert.equal(JSON.stringify(t.messages),JSON.stringify([{action:'update-now'}]));assert.match(t.nodes['update-status'].textContent,/up to date/);assert.equal(t.state.enabled,false);});
  await test('popup disabling updater does not ask permission',async()=>{const t=popupSetup(false,{updaterEnabled:true});t.nodes['auto-update'].checked=false;t.nodes['auto-update'].change();assert.equal(t.requests.length,0);assert.equal(JSON.stringify(t.messages),JSON.stringify([{action:'configure-updater',enabled:false}]));});
  console.log(`${passed} updater tests passed (mock APIs, not browser/Windows).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
