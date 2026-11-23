import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PluginManager} from '../src/plugins.mjs';
import {PluginInstances} from '../src/plugin-instances.mjs';
const directory=new URL('../../plugins',import.meta.url).pathname;
function setup(t,transport){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morph-instances-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const plugins=new PluginManager({directory,dataDir:dir,transport,trusted:true});const bindings=[];const instances=new PluginInstances({dataDir:dir,plugins,callbackBase:'http://127.0.0.1:9999',saveBinding:(...args)=>bindings.push(args)});t.after(()=>instances.close());return {dir,plugins,instances,bindings};}
test('multiple keyed instances isolate configuration/credentials and pin recipes across publication/restart',async t=>{
  const calls=[];const {dir,plugins,instances,bindings}=setup(t,async(url,options)=>{calls.push({url,...options});return {echo:options.headers.Authorization};});
  const a=instances.open('bearer-http',{slot:'personal',origins:['https://personal.example']},'app-a');
  const b=instances.open('bearer-http',{slot:'work',origins:['https://work.example']},'app-a');
  assert.notEqual(a.id,b.id);assert.equal(instances.open('bearer-http',{slot:'personal'},'app-a').id,a.id);assert.ok(bindings.some(row=>row[3]===a.id));
  assert.throws(()=>instances.open('bearer-http',{slot:'bad',key:'DO-NOT-ACCEPT'},'app-a'),/protected setup/);
  await assert.rejects(instances.call(a.id,'request',{url:'https://personal.example'},{surface:'preview'}),/Connect plugin instance/);
  instances.configure(a.id,{key:'PERSONAL-PRIVATE'});instances.configure(b.id,{key:'WORK-PRIVATE'});
  const ra=await instances.call(a.id,'request',{url:'https://personal.example/a'},{surface:'preview'});const rb=await instances.call(b.id,'request',{url:'https://work.example/b'},{surface:'agent'});
  assert.equal(calls[0].headers.Authorization,'Bearer PERSONAL-PRIVATE');assert.equal(calls[1].headers.Authorization,'Bearer WORK-PRIVATE');assert.match(ra.echo,/redacted/);assert.match(rb.echo,/redacted/);
  await assert.rejects(instances.call(a.id,'request',{url:'https://work.example/b'},{surface:'live'}),/Origin not approved/);
  const manifest=JSON.parse(plugins.packages.read('bearer-http','/manifest.json'));manifest.name+=' v2';plugins.packages.write('bearer-http','/manifest.json',JSON.stringify(manifest));const published=plugins.packages.publish('bearer-http',plugins.packages.validate('bearer-http').id);plugins.reload();
  assert.equal(instances.metadata(a.id).version,1);assert.equal(instances.metadata(a.id).connected,true);
  const c=instances.open('bearer-http',{slot:'new-version',origins:['https://personal.example']},'app-a');assert.equal(c.version,published.version);assert.equal(c.connected,false,'new instance never inherits another account credential');
  instances.disconnect(a.id);assert.equal(instances.metadata(a.id).connected,false);assert.equal(instances.metadata(b.id).connected,true);
  const restarted=new PluginInstances({dataDir:dir,plugins,callbackBase:'http://127.0.0.1:9999'});t.after(()=>restarted.close());assert.equal(restarted.metadata(b.id).connected,true);assert.equal(restarted.metadata(a.id).connected,false);
  assert.equal(JSON.stringify(restarted.list()).includes('WORK-PRIVATE'),false);assert.equal(fs.statSync(path.join(dir,'plugin-instances',b.id,'plugin-secrets.json')).mode&0o777,0o600);
});
test('two OAuth accounts reuse only protected registration and exchange/refresh/disconnect independently',async t=>{
  const requests=[];const {instances}=setup(t,async(url,options)=>{
    requests.push({url,...options});if(url.includes('/token')){const body=new URLSearchParams(options.body),account=body.get('code')||body.get('refresh_token').slice('REFRESH-'.length);return {access_token:'ACCESS-'+account,refresh_token:'REFRESH-'+account,expires_in:3600,token_type:'Bearer'};}
    return {echo:options.headers.Authorization};
  });
  const a=instances.open('gmail',{slot:'personal'},'mail'),b=instances.open('gmail',{slot:'work'},'mail');
  instances.configure(a.id,{clientID:'registration',clientSecret:'CLIENT-SECRET'});instances.copyRegistration(a.id,b.id);
  assert.equal(instances.metadata(b.id).configured,true);assert.equal(instances.metadata(b.id).connected,false);
  const ua=new URL(instances.connect(a.id)),ub=new URL(instances.connect(b.id));assert.notEqual(ua.searchParams.get('state'),ub.searchParams.get('state'));assert.equal(ua.searchParams.get('redirect_uri'),'http://127.0.0.1:9999/oauth/instances/callback');
  await instances.finish(new URLSearchParams({state:ub.searchParams.get('state'),code:'B'}));await instances.finish(new URLSearchParams({state:ua.searchParams.get('state'),code:'A'}));
  await assert.rejects(instances.finish(new URLSearchParams({state:ua.searchParams.get('state'),code:'A'})),/expired/);
  await instances.call(a.id,'listMessages',{}, {surface:'agent'});await instances.call(b.id,'listMessages',{}, {surface:'preview'});
  const api=requests.filter(r=>!r.url.includes('/token'));assert.equal(api[0].headers.Authorization,'Bearer ACCESS-A');assert.equal(api[1].headers.Authorization,'Bearer ACCESS-B');
  assert.equal(JSON.stringify(instances.list()).includes('CLIENT-SECRET'),false);assert.equal(JSON.stringify(instances.list()).includes('ACCESS-'),false);
  instances.manager(a.id).secrets.gmail.tokens.expires=Date.now()-1000;await instances.call(a.id,'listMessages',{}, {surface:'agent'});assert.equal(requests.filter(r=>r.url.includes('/token')).length,3,'only the expired account refreshes');
  instances.disconnect(a.id);assert.equal(instances.metadata(a.id).connected,false);assert.equal(instances.metadata(b.id).connected,true);
});
test('one-time account import creates a canonical instance and preserves the original private backup',async t=>{
  const {dir,plugins}=setup(t,async(_url,options)=>({echo:options.headers.Authorization}));
  const pkg=plugins.get('bearer-http');plugins.approve(pkg.id,{hash:pkg.hash,origins:['https://old.example'],preview:false,agent:false});plugins.configure(pkg.id,{key:'LEGACY-PRIVATE'});
  const before=fs.readFileSync(path.join(dir,'plugin-secrets.json'),'utf8'), instances=new PluginInstances({dataDir:dir,plugins});t.after(()=>instances.close());const imported=instances.list().find(r=>r.importedFrom==='bearer-http');assert.ok(imported.connected);assert.match(imported.id,/^i-/);assert.equal(fs.readFileSync(path.join(dir,'plugin-secrets.json'),'utf8'),before);
  const manifest=JSON.parse(plugins.packages.read(pkg.id,'/manifest.json'));manifest.name='Updated package';plugins.packages.write(pkg.id,'/manifest.json',JSON.stringify(manifest));plugins.packages.publish(pkg.id,plugins.packages.validate(pkg.id).id);plugins.reload();
  const result=await instances.call(imported.id,'request',{url:'https://old.example'},{surface:'agent'});assert.match(result.echo,/redacted/);assert.equal(instances.metadata(imported.id).version,1);
});
