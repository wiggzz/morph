import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Library} from '../src/library.mjs';
import {PluginPackages} from '../src/plugin-packages.mjs';
import {installSystemChat,CHAT_APP_ID} from '../src/system-chat.mjs';
import {bundle} from '../src/bundle.mjs';
import {validateTree} from '../../mobile/src/nativeTree.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morph-system-chat-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const packages=new PluginPackages({directory:new URL('../../plugins/',import.meta.url).pathname,dataDir:dir});return {dir,packages,library:new Library(dir,packages)};}

test('system chat has editable versioned source but never consumes or resurrects ordinary app slots',t=>{
  const {dir,packages,library}=setup(t),primary=library.chat().primary;
  installSystemChat(library);const w=library.workspace(CHAT_APP_ID);
  assert.equal(library.state.apps.length,1);assert.equal(library.chat().primary,primary);assert.equal(library.state.activeApp,'my-app');
  assert.equal(library.view().systemApps[0].id,CHAT_APP_ID);assert.ok(library.fileList().includes('/apps/morph-chat/App.tsx'));
  assert.equal(w.state.live.version,1);assert.equal(w.state.live.chatUI,true);
  assert.throws(()=>library.trashApp(CHAT_APP_ID),/System apps/);
  assert.throws(()=>library.create('app',CHAT_APP_ID),/reserved/);
  const original=w.read('/App.tsx');library.files('write','/apps/morph-chat/App.tsx',original+'\n// user customization');
  const restarted=new Library(dir,packages);installSystemChat(restarted);
  assert.match(restarted.workspace(CHAT_APP_ID).read('/App.tsx'),/user customization/);
  assert.equal(restarted.workspace(CHAT_APP_ID).state.live.files['/App.tsx'],original,'restart never publishes a draft');
  const edited={...w.snapshot(),appID:CHAT_APP_ID,chatUI:true};w.promote(edited,'Edited UI');w.rollback();
  assert.equal(w.state.live.version,1);assert.match(w.read('/App.tsx'),/user customization/,'rollback keeps editable draft');
  library.trashApp('my-app');library.purgeApp('my-app');assert.equal(library.view().apps.length,0);assert.equal(library.view().systemApps.length,1);
  assert.ok(!fs.existsSync(path.join(dir,'workspace.json')));assert.ok(fs.existsSync(path.join(dir,'system-apps',CHAT_APP_ID,'workspace.json')));
});

test('system chat renders readonly conversation data but never receives the draft or credentials, and ordinary projects cannot import its API',async t=>{
  const {library}=setup(t);installSystemChat(library);const release=library.workspace(CHAT_APP_ID).state.live;
  const messages=[],context=vm.createContext({console,setTimeout,clearTimeout,TextEncoder,TextDecoder,AbortController,window:{ReactNativeWebView:{postMessage:raw=>messages.push(JSON.parse(raw))}}});
  const code=await bundle(release);vm.runInContext(code,context,{timeout:2000});await wait(80);
  assert.equal(messages.some(m=>m.type==='error'),false,JSON.stringify(messages));
  const latest=()=>messages.filter(m=>m.type==='tree').at(-1).tree;
  validateTree(latest(),{chatUI:true});assert.throws(()=>validateTree(latest()),/Unsupported/);
  context.window.__morphSetChatState({title:'Research workspace',busy:true,connected:true,messageCount:5,mode:'full',messages:[{role:'assistant',content:[{type:'text',text:'READONLY-TRANSCRIPT'}]}],draft:'PRIVATE-DRAFT',token:'PRIVATE-KEY'});
  await wait(80);assert.match(JSON.stringify(latest()),/Research workspace/);assert.match(JSON.stringify(latest()),/READONLY-TRANSCRIPT/);assert.doesNotMatch(JSON.stringify(messages),/PRIVATE-/);
  assert.equal(context.window.__morphSetChatState.constructor===Function,false,'separate JS realm');
  await assert.rejects(bundle({...release,appID:'ordinary',chatUI:false}),/reserved/);
  await assert.rejects(bundle({...release,appID:CHAT_APP_ID,chatUI:false}),/reserved/);
  await assert.rejects(bundle({...release,files:{'/App.tsx':`import tools from 'virtual:Tools';export default tools;`}}),/Internal entry/);
  await assert.rejects(bundle({...release,dependencies:{p:{files:{'/index.js':`import App from 'virtual:App';export default App;`}}},files:{'/App.tsx':`import App from '@plugins/p';export default App;`}}),/Internal entry/);
});

test('custom chat layouts need no fixed widgets but native defaults still require explicit host scope',()=>{
  const widget=(id,type,props={})=>({id:String(id),type,props,children:[]});
  const tree=[widget(1,'ChatMessages',{userStyle:{backgroundColor:'#123',unknown:'no'},messages:'forged'}),widget(2,'ChatComposer',{value:'forged',onSubmit:'forged'})];
  assert.throws(()=>validateTree(tree),/Unsupported/);
  const valid=validateTree(tree,{chatUI:true});assert.deepEqual(valid[0].props.userStyle,{backgroundColor:'#123'});assert.equal(valid[0].props.messages,undefined);assert.equal(valid[1].props.onSubmit,undefined);
  assert.deepEqual(validateTree([],{chatUI:true}),[],'fully custom layouts are allowed');
  assert.throws(()=>validateTree([...tree,widget(3,'ChatComposer')],{chatUI:true}),/one host-bound composer/);
});
