import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {PluginManager} from '../src/plugins.mjs';import {PluginInstances} from '../src/plugin-instances.mjs';
import {validateAuth,browserCallback} from '../src/plugin-auth.mjs';
const directory=new URL('../../plugins/',import.meta.url).pathname;
const auth={type:'oauth2',clientAuth:'none',publicClientID:'public-client',authorizationUrl:'https://login.example.com/authorize',tokenUrl:'https://login.example.com/token',scopes:['read'],browser:{redirectUri:'https://provider.example.com/callback',origins:['https://login.example.com']}};
function setup(t,transport){const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'morph-browser-'));const plugins=new PluginManager({directory,dataDir,transport,trusted:true});const instances=new PluginInstances({plugins,dataDir,callbackBase:'http://127.0.0.1:8787'});t.after(()=>{instances.close();plugins.close();fs.rmSync(dataDir,{recursive:true,force:true});});return {plugins,instances,dataDir};}
function callback(login,code='one-use-private-code'){const url=new URL('https://www.ecobee.com/home/authCallback');url.searchParams.set('state',new URL(login).searchParams.get('state'));url.searchParams.set('code',code);return url.toString();}

test('generic browser OAuth enforces fixed public HTTPS declarations and exact callback semantics',async()=>{
 validateAuth(auth);
 for(const browser of [{...auth.browser,redirectUri:'http://provider.example/callback'},{...auth.browser,redirectUri:'https://provider.example/callback?x=1'},{...auth.browser,origins:['https://127.0.0.1']},{...auth.browser,origins:['https://localhost']},{...auth.browser,origins:['https://private.local']},{...auth.browser,origins:['https://other.example.com']},{...auth.browser,script:'scrape passwords'}])assert.throws(()=>validateAuth({...auth,browser}));
 assert.throws(()=>validateAuth({...auth,clientAuth:'client_secret_post'}),/Public/);
 for(const value of ['https://evil.example.com/callback?state=s&code=c','https://provider.example.com/callback/other?state=s&code=c','https://provider.example.com/callback?state=s&state=t&code=c','https://provider.example.com/callback?state=s&code=c&code=d','https://provider.example.com/callback?state=s&code=c#access_token=x'])assert.throws(()=>browserCallback(auth,value));
 assert.equal(browserCallback(auth,'https://provider.example.com/callback?state=s&code=c').get('code'),'c');
 const source=fs.readFileSync(new URL('../../mobile/src/oauthBrowser.js',import.meta.url),'utf8');const {oauthNavigation}=await import('data:text/javascript,'+encodeURIComponent(source));
 assert.equal(oauthNavigation('https://login.example.com/u/login?state=x',auth.browser),'allow');assert.equal(oauthNavigation('https://provider.example.com/callback?state=x&code=y',auth.browser),'callback');
 for(const value of ['http://login.example.com/','https://login.example.com.evil.org/','file:///secret','intent://something','https://provider.example.com/other','https://user:password@login.example.com/'])assert.equal(oauthNavigation(value,auth.browser),'block');
});

test('protected native callback uses real pinned instance OAuth, PKCE, private Bearer injection and refresh rotation',async t=>{
 const requests=[];let exchanges=0;
 const {instances}=setup(t,async(url,options)=>{requests.push({url,options});if(url.endsWith('/oauth/token'))return {access_token:'private-browser-access-'+(++exchanges),refresh_token:'private-browser-refresh-'+exchanges,expires_in:3600};return {echo:options.headers.Authorization,status:{code:0}};});
 const instance=instances.open('ecobee',{slot:'account'},'example');assert.equal(instances.metadata(instance.id).configured,true);
 const second=instances.open('ecobee',{slot:'second'},'example');instances.copyRegistration(instance.id,second.id);assert.equal(instances.metadata(second.id).configured,true);assert.equal(instances.metadata(second.id).connected,false,'copying a public registration never copies tokens');
 const login=instances.connect(instance.id),m=instances.manager(instance.id),manifest=m.get('ecobee');const start=new URL(login);
 assert.equal(start.searchParams.get('client_id'),manifest.auth.publicClientID);assert.equal(start.searchParams.get('redirect_uri'),manifest.auth.browser.redirectUri);assert.equal(start.searchParams.get('code_challenge_method'),'S256');assert.equal(start.searchParams.has('client_secret'),false);
 await assert.rejects(instances.finish(new URL(callback(login)).searchParams),/protected/);
 await assert.rejects(instances.finishBrowser(instance.id,'https://evil.example/callback?state=s&code=c'),/match/);
 await instances.finishBrowser(instance.id,callback(login));const body=new URLSearchParams(requests[0].options.body);
 assert.equal(body.get('redirect_uri'),manifest.auth.browser.redirectUri);assert.equal(body.get('code'),'one-use-private-code');assert.equal(body.has('client_secret'),false);assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'),start.searchParams.get('code_challenge'));
 await assert.rejects(instances.finishBrowser(instance.id,callback(login)),/expired|match/);
 const result=await instances.call(instance.id,'request',{url:'https://api.ecobee.com/1/thermostat?format=json',method:'POST',body:{selection:{selectionType:'thermostats',selectionMatch:'selected'},functions:[{type:'setHold',params:{holdClimateRef:'away',holdType:'nextTransition'}}]}},{surface:'live'});
 assert.equal(result.echo,'Bearer [credential redacted]');assert.equal(requests.at(-1).options.headers.Authorization,'Bearer private-browser-access-1');
 m.secrets.ecobee.tokens.expires=0;await instances.call(instance.id,'request',{url:'https://api.ecobee.com/1/thermostat'},{surface:'live'});assert.equal(m.secrets.ecobee.tokens.refresh,'private-browser-refresh-2');assert.equal(new URLSearchParams(requests[2].options.body).get('refresh_token'),'private-browser-refresh-1');
 assert.doesNotMatch(JSON.stringify(instances.list()),/private-browser|one-use-private-code|code_verifier/);
 await assert.rejects(instances.call(instance.id,'request',{url:'https://other.example.com/data'},{surface:'live'}),/origin|approved/i);
 instances.disconnect(instance.id);assert.equal(instances.metadata(instance.id).connected,false);
});

test('cancelled or replaced protected sign-in cannot resurrect account tokens even if transport ignores cancellation',async t=>{
 let release;const {instances}=setup(t,()=>new Promise(resolve=>{release=resolve;}));const instance=instances.open('ecobee',{slot:'account'},'example');let login=instances.connect(instance.id);
 const result=instances.finishBrowser(instance.id,callback(login));instances.cancelOAuth(instance.id);release({access_token:'late-private-token',refresh_token:'late-refresh',expires_in:3600});await assert.rejects(result,/exchange failed/);assert.equal(instances.metadata(instance.id).connected,false);
 login=instances.connect(instance.id);const newer=instances.connect(instance.id);await assert.rejects(instances.finishBrowser(instance.id,callback(login)),/expired|match/);const m=instances.manager(instance.id);m.oauthPending.get(new URL(newer).searchParams.get('state')).expires=0;await assert.rejects(instances.finishBrowser(instance.id,callback(newer)),/expired|match/);
});
