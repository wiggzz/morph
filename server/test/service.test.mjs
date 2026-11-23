import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
const serverDir=fileURLToPath(new URL('../',import.meta.url)), wait=ms=>new Promise(r=>setTimeout(r,ms));
// Simulated native host only. No real pixels, OAuth service or model calls.
test('paired trusted library supports projects, chats, live state, durable data and isolated credential setup', {timeout:45000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morph-service-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const port=19000+Math.floor(Math.random()*10000);let logs='';
  const child=spawn(process.execPath,['src/index.mjs'],{cwd:serverDir,env:{...process.env,MORPH_DATA:dir,MORPH_PORT:String(port),MORPH_AUTH_PATH:path.join(dir,'auth.json')},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);t.after(()=>child.kill('SIGTERM'));
  for(let i=0;i<100&&!logs.includes('Pairing token:');i++){if(child.exitCode!==null)throw new Error(logs);await wait(100);}assert.match(logs,/Pairing token:/);
  const address=`ws://127.0.0.1:${port}`;
  await new Promise((resolve,reject)=>{const socket=new WebSocket(address);socket.on('unexpected-response',(_r,response)=>{assert.equal(response.statusCode,401);response.resume();socket.terminate();resolve();});socket.on('open',()=>reject(new Error('Pairing bypass')));socket.on('error',()=>{});});
  const ws=new WebSocket(address,{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(dir,'pairing-token'),'utf8')}});t.after(()=>ws.close());await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  const messages=[], counts=new Map(), tokens=new Map();let previewToken, deferred, handshake=false, failNext=false;
  const send=x=>ws.send(JSON.stringify(x)), last=()=>messages.length;
  ws.on('message',raw=>{
    const m=JSON.parse(raw);messages.push(m);
    if(m.type==='host_request'){
      const p=m.payload;
      if(['render','deploy'].includes(m.op)){
        assert.match(p.html,/Content-Security-Policy/);
        if(m.op==='render')previewToken=p.capabilityID;else{tokens.set(p.appID,p.capabilityID);counts.set(p.appID,0);}
        if(m.op==='render'&&!handshake){deferred=m;send({type:'app_rpc',id:'during-mount',capabilityID:previewToken,payload:{action:'state_get',key:'test'}});return;}
        send({type:'host_result',id:m.id,...(failNext?{error:'simulated native failure'}:{data:{snapshotID:p.snapshotID,tree:[]}})});failNext=false;
      }else{
        if(m.op==='app_invoke')counts.set(p.appID,(counts.get(p.appID)||0)+1);
        send({type:'host_result',id:m.id,data:{ports:[{name:'counter',state:{count:counts.get(p.appID)||0},commands:[]}],result:counts.get(p.appID)||0,snapshotID:'simulated'}});
      }
    }
    if(m.type==='app_rpc_result'&&m.id==='during-mount'){
      assert.equal(m.data,null);handshake=true;send({type:'host_result',id:deferred.id,data:{snapshotID:deferred.payload.snapshotID,tree:[]}});
    }
  });
  const until=async(predicate,after=0)=>{for(let i=0;i<160;i++){const found=messages.slice(after).find(predicate);if(found)return found;await wait(25);}throw new Error('No matching message: '+JSON.stringify(messages.slice(-4)).slice(0,1500)+'\n'+logs.slice(-1000));};
  send({type:'hello'});let state=await until(m=>m.type==='state'&&m.preview?.status==='ready');const first=state.preview.id, starter=state.files['/App.tsx'], oldChat=state.library.activeChat;
  assert.equal(state.trustedSandbox,true);assert.equal(state.authenticated,false,'tests must never start a paid model turn');assert.equal(handshake,true);
  let mark=last();send({type:'promote'});state=await until(m=>m.type==='state'&&m.liveID===first&&!m.busy,mark);
  assert.equal(state.liveVersion,1);assert.equal(state.agentBridge.live.control,true,'no internal live permission card');
  mark=last();send({type:'save_file',path:'/App.tsx',content:starter.replace('What should we make?','Changed draft')});await until(m=>m.type==='state'&&m.draftID!==first,mark);
  mark=last();send({type:'promote'});await until(m=>m.type==='error'&&/render again/.test(m.error),mark);
  mark=last();send({type:'render'});state=await until(m=>m.type==='state'&&m.preview?.status==='ready'&&m.preview.id!==first&&!m.busy,mark);const second=state.preview.id;
  mark=last();send({type:'promote'});state=await until(m=>m.type==='state'&&m.liveID===second&&!m.busy,mark);assert.equal(state.previousID,first);
  mark=last();send({type:'rollback'});state=await until(m=>m.type==='state'&&m.liveID===first&&!m.busy,mark);assert.equal(state.draftID,second);assert.equal(state.history.entries.length,2);
  mark=last();failNext=true;send({type:'render'});await until(m=>m.type==='state'&&m.preview?.status==='error'&&!m.busy,mark);
  mark=last();send({type:'promote'});await until(m=>m.type==='error'&&/healthy preview/.test(m.error),mark);
  mark=last();send({type:'app_rpc',id:'persist',capabilityID:tokens.get('my-app'),payload:{action:'state_set',key:'selection',value:{id:'123'}}});await until(m=>m.type==='app_rpc_result'&&m.id==='persist'&&m.data.id==='123',mark);
  mark=last();send({type:'new_chat'});state=await until(m=>m.type==='state'&&m.library.activeChat!==oldChat&&!m.busy,mark);const newChat=state.library.activeChat;assert.equal(state.library.primary,null);
  assert.ok(state.runningApps.some(r=>r.id==='my-app'),'changing chat keeps live app');
  mark=last();send({type:'project_create',kind:'app',id:'second',name:'Second app',icon:'✦'});state=await until(m=>m.type==='state'&&m.library.apps.some(a=>a.id==='second'),mark);assert.equal(state.library.primary,'app:second');
  mark=last();send({type:'open_project',project:'app:second'});state=await until(m=>m.type==='state'&&m.library.activeApp==='second'&&m.preview?.status==='ready'&&!m.busy,mark);
  mark=last();send({type:'promote'});state=await until(m=>m.type==='state'&&m.library.activeApp==='second'&&m.liveVersion===1&&!m.busy,mark);assert.equal(state.runningApps.length,2);
  mark=last();send({type:'app_rpc',id:'cross-command',capabilityID:tokens.get('second'),payload:{action:'invoke',appID:'my-app',port:'counter',command:'increment',args:{}}});const invoked=await until(m=>m.type==='app_rpc_result'&&m.id==='cross-command',mark);assert.equal(invoked.data.result,1);assert.equal(invoked.data.approvalRequired,undefined);
  mark=last();send({type:'open_chat',id:oldChat});await until(m=>m.type==='state'&&m.library.activeChat===oldChat&&!m.busy,mark);
  mark=last();send({type:'open_project',project:'app:my-app'});await until(m=>m.type==='show_app'&&m.appID==='my-app',mark);assert.equal(counts.get('my-app'),1,'launcher reuse must not remount');
  mark=last();send({type:'app_rpc',id:'durable',capabilityID:tokens.get('second'),payload:{action:'state_get',appID:'my-app',key:'selection'}});assert.equal((await until(m=>m.type==='app_rpc_result'&&m.id==='durable',mark)).data.id,'123');
  mark=last();send({type:'plugin_rpc',id:'new-account',capabilityID:tokens.get('my-app'),payload:{action:'open',plugin:'bearer-http',options:{slot:'work',label:'Work account',origins:['https://api.example.com']}}});const opened=(await until(m=>m.type==='plugin_rpc_result'&&m.id==='new-account',mark)).data;assert.equal(opened.connectionRequired,true);assert.match(opened.id,/^i-/);
  mark=last();send({type:'plugin_rpc',id:'vault-bypass',capabilityID:tokens.get('my-app'),payload:{action:'configure',id:opened.id,key:'unsafe'}});await until(m=>m.type==='plugin_rpc_result'&&m.id==='vault-bypass'&&/protected/.test(m.error),mark);
  mark=last();send({type:'instance_configure',id:opened.id,config:{key:'FAKE-PRIVATE-TEST-KEY'}});state=await until(m=>m.type==='state'&&m.pluginInstances.some(i=>i.id===opened.id&&i.connected),mark);assert.equal(JSON.stringify(state).includes('FAKE-PRIVATE-TEST-KEY'),false);
  mark=last();send({type:'plugin_rpc',id:'exchange-bypass',capabilityID:tokens.get('my-app'),payload:{action:'exchange',id:opened.id}});await until(m=>m.type==='plugin_rpc_result'&&m.id==='exchange-bypass'&&/protected/.test(m.error),mark);
  mark=last();send({type:'plugin_rpc',id:'garmin-account',capabilityID:tokens.get('my-app'),payload:{action:'open',plugin:'garmin-personal',options:{slot:'personal'}}});const garmin=(await until(m=>m.type==='plugin_rpc_result'&&m.id==='garmin-account',mark)).data;assert.equal(garmin.connected,false);
  mark=last();send({type:'instance_exchange',id:garmin.id});await until(m=>m.type==='error'&&/Save the exchange key/.test(m.error),mark);
  const secrets=path.join(dir,'plugin-instances',opened.id,'plugin-secrets.json');assert.match(fs.readFileSync(secrets,'utf8'),/FAKE-PRIVATE-TEST-KEY/);assert.equal(fs.statSync(secrets).mode&0o777,0o600);
  mark=last();send({type:'app_rpc',id:'binding',capabilityID:tokens.get('my-app'),payload:{action:'state_get',key:'pluginInstances'}});const bindings=(await until(m=>m.type==='app_rpc_result'&&m.id==='binding',mark)).data;assert.equal(bindings['bearer-http:work'],opened.id);
  mark=last();send({type:'agent_rpc',id:'background-agent',capabilityID:tokens.get('my-app'),payload:{text:'No background inference'}});await until(m=>m.type==='agent_rpc_result'&&m.id==='background-agent'&&/button press/.test(m.error),mark);
  mark=last();send({type:'open_chat',id:newChat});await until(m=>m.type==='state'&&m.library.activeChat===newChat&&!m.busy,mark);assert.ok(fs.existsSync(path.join(dir,'workspace.json')));
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'library.json')));assert.equal(saved.apps.length,2);assert.equal(saved.chats.length,2);
  mark=last();send({type:'app_rpc',id:'before-trash',capabilityID:tokens.get('second'),payload:{action:'state_set',key:'keep',value:7}});await until(m=>m.type==='app_rpc_result'&&m.id==='before-trash'&&m.data===7,mark);
  const oldSecondToken=tokens.get('second');
  mark=last();send({type:'trash_app',appID:'second'});state=await until(m=>m.type==='state'&&m.library.trash.some(a=>a.id==='second')&&!m.busy,mark);assert.ok(!state.runningApps.some(a=>a.id==='second'));assert.ok(state.runningApps.some(a=>a.id==='my-app'));assert.equal(state.preview,null);assert.equal(counts.get('my-app'),1);
  mark=last();send({type:'app_rpc',id:'stale-trash',capabilityID:oldSecondToken,payload:{action:'state_get',key:'keep'}});await until(m=>m.type==='app_rpc_result'&&m.id==='stale-trash'&&m.error,mark);
  mark=last();send({type:'restore_app',appID:'second'});state=await until(m=>m.type==='state'&&m.library.apps.some(a=>a.id==='second')&&!m.busy,mark);assert.ok(!state.runningApps.some(a=>a.id==='second'),'restore must not silently launch');
  mark=last();send({type:'open_project',project:'app:second'});await until(m=>m.type==='state'&&m.runningApps.some(a=>a.id==='second')&&!m.busy,mark);assert.notEqual(tokens.get('second'),oldSecondToken);
  mark=last();send({type:'app_rpc',id:'after-restore',capabilityID:tokens.get('second'),payload:{action:'state_get',key:'keep'}});await until(m=>m.type==='app_rpc_result'&&m.id==='after-restore'&&m.data===7,mark);
  mark=last();send({type:'trash_app',appID:'second'});await until(m=>m.type==='state'&&m.library.trash.length===1&&!m.busy,mark);
  mark=last();send({type:'purge_app',appID:'second'});await until(m=>m.type==='error'&&/Confirm permanent/.test(m.error),mark);assert.ok(fs.existsSync(path.join(dir,'apps','second')));
  mark=last();send({type:'purge_app',appID:'second',confirm:true});state=await until(m=>m.type==='state'&&m.library.trash.length===0&&!m.busy,mark);assert.equal(fs.existsSync(path.join(dir,'apps','second')),false);assert.equal(fs.existsSync(path.join(dir,'app-data','second.json')),false);
  mark=last();send({type:'trash_app',appID:'my-app'});state=await until(m=>m.type==='state'&&m.library.apps.length===0&&!m.busy,mark);assert.equal(state.library.activeApp,null);assert.deepEqual(state.files,{});assert.equal(state.runningApps.length,0);assert.ok(state.pluginInstances.some(i=>i.id===opened.id&&i.connected));
  mark=last();send({type:'hello'});await until(m=>m.type==='state'&&m.library.apps.length===0&&!m.busy,mark);assert.equal(messages.slice(mark).some(m=>m.type==='host_request'&&m.payload?.appID!=='morph-chat'),false,'empty library may load the system chat but must not recreate an ordinary app on reconnect');
  mark=last();send({type:'purge_app',appID:'my-app',confirm:true});state=await until(m=>m.type==='state'&&m.library.apps.length===0&&m.library.trash.length===0&&!m.busy,mark);assert.ok(state.library.chats.every(c=>c.primary===null));assert.ok(state.pluginInstances.some(i=>i.id===opened.id&&i.connected));assert.ok(fs.existsSync(secrets));assert.ok(fs.existsSync(path.join(dir,'pairing-token')));assert.equal(fs.existsSync(path.join(dir,'workspace.json')),false);
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
  let restartLogs='';const restarted=spawn(process.execPath,['src/index.mjs'],{cwd:serverDir,env:{...process.env,MORPH_DATA:dir,MORPH_PORT:String(port),MORPH_AUTH_PATH:path.join(dir,'auth.json')},stdio:['ignore','pipe','pipe']});t.after(()=>restarted.kill('SIGTERM'));restarted.stdout.on('data',x=>restartLogs+=x);restarted.stderr.on('data',x=>restartLogs+=x);
  for(let i=0;i<400&&!restartLogs.includes('Morph: ws:');i++){if(restarted.exitCode!==null)throw new Error(restartLogs);await wait(25);}assert.match(restartLogs,/Morph: ws:/);
  const fresh=new WebSocket(address,{headers:{Authorization:'Bearer '+fs.readFileSync(path.join(dir,'pairing-token'),'utf8')}});t.after(()=>fresh.close());const freshMessages=[];fresh.on('message',raw=>{const m=JSON.parse(raw);freshMessages.push(m);if(m.type==='host_request'){assert.equal(m.payload.appID,'morph-chat','cold empty library mounts only system chat');fresh.send(JSON.stringify({type:'host_result',id:m.id,data:{tree:[],snapshotID:m.payload.snapshotID}}));}});await new Promise((r,j)=>{fresh.once('open',r);fresh.once('error',j);});fresh.send(JSON.stringify({type:'hello'}));
  for(let i=0;i<400&&!freshMessages.some(m=>m.type==='state'&&!m.busy);i++)await wait(25);
  const cold=freshMessages.find(m=>m.type==='state'&&!m.busy);assert.ok(cold,'empty library must boot after restart');assert.equal(cold.library.apps.length,0);assert.equal(cold.library.trash.length,0);assert.equal(cold.library.chats.length,2);assert.ok(cold.pluginInstances.some(i=>i.id===opened.id&&i.connected));assert.equal(fs.existsSync(path.join(dir,'workspace.json')),false);
});
