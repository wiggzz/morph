import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PluginManager} from '../src/plugins.mjs';
import {PluginInstances} from '../src/plugin-instances.mjs';
import {validateAuth, exchangeTokens, publicHeaders} from '../src/plugin-auth.mjs';
import {secureJSON} from '../src/plugin-network.mjs';
const directory = new URL('../../plugins/', import.meta.url).pathname;
const id = 'garmin-personal', base = 'https://personal.connectapi.garmin.com';
const tokenURL = base + '/personalapitoken-service/personal-api/personal-api-key/token';
const jwt = (name = 'private-access', exp = Math.floor(Date.now()/1000)+3600) => 'eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp,private:name})).toString('base64url')+'.signature';
function setup(t,transport) {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'morph-exchange-'));
  const plugins=new PluginManager({directory,dataDir,transport,trusted:true});
  const instances=new PluginInstances({dataDir,plugins});
  t.after(()=>{instances.close();plugins.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  return {plugins,instances,dataDir};
}
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('Garmin recipe uses protected text-JWT exchange; only instance status and redacted API data escape', async t=>{
  const calls=[], token=jwt();
  const {instances,dataDir,plugins}=setup(t,async(url,options)=>{calls.push({url,...options});return url===tokenURL?' \n'+token+'\n':{echo:options.headers.Authorization};});
  const a=instances.open(id,{slot:'personal'},'fitness');
  instances.configure(a.id,{key:'PRIVATE-API-KEY'});
  assert.equal(instances.metadata(a.id).configured,true);
  assert.equal(instances.metadata(a.id).connected,false);
  await assert.rejects(instances.call(a.id,'request',{url:base+'/data'},{surface:'agent'}),/protected account setup/);
  assert.equal(calls.length,0,'saving a key does not silently connect');
  assert.deepEqual(await instances.exchange(a.id),{id:a.id,connected:true});
  assert.equal(calls[0].url,tokenURL);assert.equal(calls[0].method,'POST');
  assert.equal(calls[0].headers.Authorization,'ApiKey PRIVATE-API-KEY');
  assert.equal(calls[0].body,undefined);assert.equal(calls[0].responseType,'text');
  const result=await instances.call(a.id,'request',{url:base+'/data'},{surface:'agent'});
  assert.equal(calls[1].headers.Authorization,'Bearer '+token);
  assert.equal(calls[1].responseType,undefined,'ordinary app calls remain JSON-only');
  assert.equal(result.echo,'Bearer [credential redacted]');
  for(const secret of ['PRIVATE-API-KEY',token]) assert.equal(JSON.stringify([instances.list(),plugins.docs(id),result]).includes(secret),false);
  assert.equal(fs.statSync(path.join(dataDir,'plugin-instances',a.id,'plugin-secrets.json')).mode&0o777,0o600);
  const restarted=new PluginInstances({dataDir,plugins});t.after(()=>restarted.close());
  assert.equal(restarted.metadata(a.id).connected,true);
  await restarted.call(a.id,'request',{url:base+'/data'},{surface:'preview'});
  assert.equal(calls.filter(c=>c.url===tokenURL).length,1,'cached token survives restart');
});

test('expiry re-exchanges the saved key once for concurrent callers; accounts remain independent', async t=>{
  const calls=[], gate=deferred();let exchanges=0;
  const {instances}=setup(t,async(url,options)=>{
    calls.push({url,...options});if(url!==tokenURL)return {ok:true};
    exchanges++;if(exchanges===3)await gate.promise;
    return jwt('private-'+options.headers.Authorization+'-'+exchanges);
  });
  const a=instances.open(id,{slot:'a'},'fitness'),b=instances.open(id,{slot:'b'},'fitness');
  instances.configure(a.id,{key:'KEY-A'});instances.configure(b.id,{key:'KEY-B'});
  await instances.exchange(a.id);await instances.exchange(b.id);
  instances.manager(a.id).secrets[id].tokens.expires=0;
  const requests=[1,2,3].map(()=>instances.call(a.id,'request',{url:base+'/data'},{surface:'live'}));
  await new Promise(r=>setImmediate(r));assert.equal(exchanges,3);
  gate.resolve();await Promise.all(requests);
  assert.equal(exchanges,3,'one exchange shared within an instance');
  await instances.call(b.id,'request',{url:base+'/data'},{surface:'preview'});
  assert.equal(exchanges,3,'other account keeps its cached token');
  assert.deepEqual(calls.filter(c=>c.url===tokenURL).map(c=>c.headers.Authorization),['ApiKey KEY-A','ApiKey KEY-B','ApiKey KEY-A']);
  instances.disconnect(a.id);assert.equal(instances.metadata(a.id).configured,false);
  assert.equal(instances.metadata(b.id).connected,true);
  assert.throws(()=>instances.copyRegistration(b.id,a.id),/OAuth/);
});

test('reconfiguration/disconnect cancel exchanges and stale completions cannot overwrite a new binding', async t=>{
  const old=deferred(),fresh=deferred();
  const {instances}=setup(t,async(_url,options)=>{await (options.headers.Authorization==='ApiKey OLD-KEY'?old.promise:fresh.promise);return jwt(options.headers.Authorization);});
  const a=instances.open(id,{},'fitness');instances.configure(a.id,{key:'OLD-KEY'});
  const stale=instances.exchange(a.id);const rejected=assert.rejects(stale,/exchange failed or cancelled/);
  await new Promise(r=>setImmediate(r));instances.configure(a.id,{key:'NEW-KEY'});
  const active=instances.exchange(a.id);await new Promise(r=>setImmediate(r));old.resolve();await rejected;
  assert.equal(instances.manager(a.id).exchanges.size,1,'old cleanup must not erase new exchange');
  fresh.resolve();await active;
  assert.equal(JSON.parse(Buffer.from(instances.manager(a.id).secrets[id].tokens.access.split('.')[1],'base64url')).private,'ApiKey NEW-KEY');
  instances.disconnect(a.id);assert.equal(instances.metadata(a.id).connected,false);
  const gate=deferred();instances.manager(a.id).transport=async()=>{await gate.promise;return jwt('disconnected');};
  instances.configure(a.id,{key:'THIRD-KEY'});const pending=instances.exchange(a.id);const cancelled=assert.rejects(pending,/exchange failed or cancelled/);
  await new Promise(r=>setImmediate(r));instances.disconnect(a.id);gate.resolve();await cancelled;
  assert.equal(instances.manager(a.id).secrets[id],undefined,'disconnect cannot be resurrected');
});

test('token endpoints, header overrides and unapproved origins are not ordinary app capabilities', async t=>{
  let calls=0;const {instances}=setup(t,async()=>{calls++;return jwt();});
  const a=instances.open(id,{},'fitness');instances.configure(a.id,{key:'PRIVATE-KEY'});await instances.exchange(a.id);
  for(const url of [tokenURL,tokenURL+'?ignored=1',tokenURL+'/',tokenURL.replace('/token','/%74oken')]) await assert.rejects(instances.call(a.id,'request',{url},{surface:'agent'}),/reserved/);
  for(const header of ['Authorization','Cookie','Host']) await assert.rejects(instances.call(a.id,'request',{url:base+'/data',headers:{[header]:'override'}},{surface:'live'}),/header/);
  await assert.rejects(instances.call(a.id,'request',{url:'https://elsewhere.example/data'},{surface:'live'}),/Origin/);
  await assert.rejects(instances.call(a.id,'request',{url:base+'/data',responseType:'text'},{surface:'live'}),/Unknown argument/);
  assert.equal(calls,1,'blocked requests never reach network');
  for(const url of ['https://127.0.0.1/token','https://[::1]/token']) await assert.rejects(secureJSON(url,{responseType:'text'}),/Private/);
});

test('exchange failures/invalid responses never expose private response bodies and remain retryable', async t=>{
  let response='PRIVATE-RESPONSE-CONTAINING-KEY';const {instances}=setup(t,()=>{if(response instanceof Error)throw response;return response;});
  const a=instances.open(id,{},'fitness');instances.configure(a.id,{key:'PRIVATE-KEY'});
  for(const invalid of ['PRIVATE-RESPONSE-CONTAINING-KEY',jwt('expired',1),new Error('PRIVATE-RESPONSE '+jwt()),{access_token:jwt()},'x'.repeat(16001)]) {
    response=invalid;await assert.rejects(instances.exchange(a.id),e=>!e.message.includes('PRIVATE')&&/exchange failed/.test(e.message));
    assert.equal(instances.metadata(a.id).connected,false);assert.equal(instances.manager(a.id).exchanges.size,0);
  }
  response=jwt('recovered');await instances.exchange(a.id);assert.equal(instances.metadata(a.id).connected,true);
  response=jwt('source-key');instances.configure(a.id,{key:response});
  await assert.rejects(instances.exchange(a.id),/exchange failed/);assert.equal(instances.metadata(a.id).connected,false,'source key cannot be accepted as its own derived token');
});

test('generic mapped JSON exchange validates own fields and bounds token cache lifetime', ()=>{
  const auth={type:'token-exchange',exchange:{url:'https://auth.example/token',header:'X-Private-Key',prefix:'Key ',response:{format:'json',expiry:'expires-in',tokenField:'token',expiresInField:'ttl'},maxTTLSeconds:60}};
  validateAuth(auth);assert.throws(()=>publicHeaders({'X-Private-Key':'override'},auth),/header/);
  assert.throws(()=>exchangeTokens(auth,{token:'private',ttl:10,token_type:'MAC'}),/Bearer/);
  assert.deepEqual(exchangeTokens(auth,{token:'opaque-private-token',ttl:'3600'},1000),{access:'opaque-private-token',expires:61000});
  assert.throws(()=>exchangeTokens(auth,Object.create({token:'inherited',ttl:100})),/token/);
  for(const ttl of [undefined,0,-1,Infinity,'NaN',{},'1e10'])assert.throws(()=>exchangeTokens(auth,{token:'private',ttl}),/lifetime/);
  for(const token of ['x\r\ny','x y','x'.repeat(16001),'é'])assert.throws(()=>exchangeTokens(auth,{token,ttl:10}),/token/);
  for(const patch of [{url:'http://auth.example/token'},{url:'https://auth.example/token?secret=public'},{url:'https://u:p@auth.example/token'},{header:'Host'},{prefix:'bad\r\n'},{maxTTLSeconds:86401},{body:{key:'not-allowed'}},{response:{format:'text',expiry:'expires-in'}},{response:{format:'json',expiry:'expires-in',tokenField:'constructor'}}])assert.throws(()=>validateAuth({type:'token-exchange',exchange:{...auth.exchange,...patch}}));
});

test('an in-flight response still redacts the exact token used if the cached token rotates', async t=>{
  const gate=deferred(),oldToken=jwt('old'),newToken=jwt('new');
  const {instances}=setup(t,async(url,options)=>{if(url===tokenURL)return oldToken;await gate.promise;return {echo:options.headers.Authorization};});
  const a=instances.open(id,{},'fitness');instances.configure(a.id,{key:'PRIVATE-KEY'});await instances.exchange(a.id);
  const pending=instances.call(a.id,'request',{url:base+'/data'},{surface:'live'});
  await new Promise(r=>setImmediate(r));instances.manager(a.id).secrets[id].tokens.access=newToken;gate.resolve();
  assert.deepEqual(await pending,{echo:'Bearer [credential redacted]'});
});
