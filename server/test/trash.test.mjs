import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Library} from '../src/library.mjs';
import {PluginManager} from '../src/plugins.mjs';
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morph-trash-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const plugins=new PluginManager({directory:new URL('../../plugins/',import.meta.url).pathname,dataDir:dir,trusted:true});t.after(()=>plugins.close());
  return {dir,plugins,lib:new Library(dir,plugins.packages)};
}
test('Trash persists, hides project access, and restores exact source/releases/data/chat associations',t=>{
  const {dir,plugins,lib}=setup(t);lib.create('app','second','Second','✦');const chat=lib.createChat('app:second');
  const w=lib.workspace('second');w.write('/saved.json','{"original":true}');const release=w.promote(w.snapshot(),'Keep release');lib.data('second','set','selectedAccount','i-public-link');
  lib.state.activeApp='second';lib.trashApp('second');assert.equal(lib.state.activeApp,'my-app');
  assert.equal(lib.view().apps.some(a=>a.id==='second'),false);assert.equal(lib.view().trash[0].id,'second');assert.equal(lib.fileList().some(f=>f.startsWith('/apps/second/')),false);
  assert.throws(()=>lib.workspace('second'),/Trash/);assert.throws(()=>lib.data('second','get','selectedAccount'),/Trash/);assert.throws(()=>lib.files('read','/apps/second/saved.json'),/Trash/);assert.throws(()=>lib.create('app','second'),/exists/);
  const restarted=new Library(dir,plugins.packages);assert.equal(restarted.view().trash.length,1);restarted.restoreApp('second');
  assert.equal(restarted.workspace('second').read('/saved.json'),'{"original":true}');assert.equal(restarted.workspace('second').state.live.id,release.id);assert.equal(restarted.data('second','get','selectedAccount'),'i-public-link');assert.equal(restarted.chat(chat.id).primary,'app:second');assert.equal(restarted.view().trash.length,0);
  assert.throws(()=>restarted.purgeApp('second'),/Trash/);
  restarted.trashApp('second');restarted.purgeApp('second');assert.equal(fs.existsSync(path.join(dir,'apps','second')),false);assert.equal(fs.existsSync(path.join(dir,'app-data','second.json')),false);assert.equal(restarted.chat(chat.id).primary,null);assert.equal(restarted.chat(chat.id).projects.includes('app:second'),false);
  assert.throws(()=>restarted.restoreApp('second'),/not in Trash/);assert.throws(()=>restarted.create('app','second'),/new ID/);assert.equal(restarted.workspace('my-app').list().includes('/App.tsx'),true);
});
test('deleting the final imported app never deletes shared credentials/plugins/chats, and an empty library stays empty',t=>{
  const {dir,plugins,lib}=setup(t), w=lib.workspace();w.promote(w.snapshot(),'Imported release');lib.data('my-app','set','privateSelection',{id:1});
  const untouched=['auth.json','pairing-token','plugin-secrets.json','plugin-instances/example/plugin-secrets.json','sessions/example.jsonl'];
  for(const f of untouched){fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.writeFileSync(path.join(dir,f),'KEEP-'+f);}
  const chatID=lib.chat().id;lib.trashApp('my-app');assert.equal(lib.state.activeApp,null);assert.equal(lib.view().apps.length,0);assert.equal(lib.view().trash.length,1);
  let next=new Library(dir,plugins.packages);assert.equal(next.view().apps.length,0);next.restoreApp('my-app');assert.equal(next.state.activeApp,'my-app');assert.equal(next.data('my-app','get','privateSelection').id,1);
  next.trashApp('my-app');next.purgeApp('my-app');assert.equal(fs.existsSync(path.join(dir,'workspace.json')),false);assert.equal(fs.existsSync(path.join(dir,'releases/app')),false);
  for(const f of untouched)assert.equal(fs.readFileSync(path.join(dir,f),'utf8'),'KEEP-'+f);
  assert.ok(plugins.packages.list().length);next=new Library(dir,plugins.packages);assert.equal(next.view().apps.length,0);assert.equal(next.view().trash.length,0);assert.equal(next.chat(chatID).primary,null);
  next.create('app','fresh','My app','◇');assert.equal(next.state.activeApp,'fresh');assert.equal(next.chat().primary,'app:fresh');assert.equal(next.workspace().state.live,null);assert.equal(next.data('fresh','get','privateSelection'),null);
});
test('a chat can build a fresh project after its primary app is trashed without losing restorable links',t=>{
  const {lib}=setup(t);const id=lib.chat().id;lib.trashApp('my-app');lib.create('app','new-app');assert.equal(lib.chat().primary,'app:new-app');assert.ok(lib.chat().projects.includes('app:my-app'));lib.restoreApp('my-app');assert.equal(lib.chat(id).primary,'app:new-app');
  for(const bad of ['../escape','my-app/../../','',null]){assert.throws(()=>lib.trashApp(bad));assert.throws(()=>lib.restoreApp(bad));assert.throws(()=>lib.purgeApp(bad));}
});
