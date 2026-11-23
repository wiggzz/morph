import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Type,validateToolArguments} from '@earendil-works/pi-ai';
import {makeAgent} from '../src/agent.mjs';
import {Library} from '../src/library.mjs';
import {PluginManager} from '../src/plugins.mjs';
import {bundle} from '../src/bundle.mjs';
import {chatView} from '../src/chat-view.mjs';
import {toolResult} from '../src/project-tools.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'morph-pi-tools-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const plugins=new PluginManager({directory:new URL('../../plugins/',import.meta.url).pathname,dataDir:dir,trusted:true}),library=new Library(dir,plugins.packages);const agent=await makeAgent({dataDir:dir,plugins,library,notify(){},host:async()=>({}),authPath:path.join(dir,'auth.json')});t.after(()=>{agent.projectTools.clear();agent.session.dispose();plugins.close();});return agent;}
const definition={name:'project_echo',label:'Project echo',description:'Echo typed input',parameters:Type.Object({text:Type.String({maxLength:20})})};
test('project tools use real Pi dynamic registration, schemas, partial results and withdrawal without a model turn',async t=>{
  const {session,projectTools}=await setup(t),calls=[],partials=[];
  projectTools.sync([definition],'release-a',async(identity,name,id,args,signal,onUpdate)=>{calls.push({identity,name,id,args,signal});onUpdate({content:[{type:'text',text:'Working'}],details:{pending:true}});return {content:[{type:'text',text:args.text}],details:{echo:args.text},structuredContent:{echo:args.text}};});
  assert.ok(session.getActiveToolNames().includes('project_echo'));
  assert.equal(session.getAllTools().some(tool=>['bash','powershell','grep','find','ls'].includes(tool.name)),false,'host filesystem/shell implementations stay unavailable even in the inactive registry');
  const tool=session.agent.state.tools.find(t=>t.name==='project_echo');
  assert.throws(()=>validateToolArguments(tool,{type:'toolCall',id:'bad',name:tool.name,arguments:{text:'x'.repeat(30)}}));
  const args=validateToolArguments(tool,{type:'toolCall',id:'ok',name:tool.name,arguments:{text:'hello'}});
  const result=await tool.execute('ok',args,new AbortController().signal,partial=>partials.push(partial));
  assert.equal(result.content[0].text,'hello');assert.equal(result.details.echo,'hello');assert.equal(partials[0].details.pending,true);assert.equal(calls[0].identity,'release-a');
  assert.throws(()=>projectTools.sync([{...definition,name:'read'}],'bad',()=>{}),/collides/);
  projectTools.clear();assert.equal(session.getActiveToolNames().includes('project_echo'),false);
  projectTools.sync([definition],'release-b',async()=>({content:[{type:'text',text:'new'}],details:{}}));assert.ok(session.getActiveToolNames().includes('project_echo'),'hidden tools can return after reload');
  await assert.rejects(tool.execute('stale',{text:'old'},new AbortController().signal),/changed|aborted/);
  const controller=new AbortController();controller.abort();await assert.rejects(session.agent.state.tools.find(t=>t.name==='project_echo').execute('cancel',{text:'x'},controller.signal),/abort/i);
  projectTools.sync([{...definition,name:'inactive_echo',defaultActive:false}],'release-inactive',async()=>({content:[],details:{}}));
  assert.equal(session.getActiveToolNames().includes('inactive_echo'),false,'Pi owns default activation semantics');assert.ok(session.getAllTools().some(t=>t.name==='inactive_echo'));
  assert.throws(()=>toolResult({content:[{type:'text',text:'x'.repeat(65000)}],details:{}}),/64 KiB/);
  assert.throws(()=>toolResult({content:[{type:'html',html:'unsafe'}]}),/Invalid/);
});

test('standard Pi factories and tool execute callbacks run in the isolated UI realm, with cancellation and readonly snapshots',async()=>{
  const messages=[],context=vm.createContext({console,setTimeout,clearTimeout,TextEncoder,TextDecoder,AbortController,window:{ReactNativeWebView:{postMessage:raw=>messages.push(JSON.parse(raw))}}});
  const files={'/App.tsx':`import React from 'react';import {View,Text} from 'react-native';import {useChat,getChatSnapshot} from '@morph/chat';window.snapshot=getChatSnapshot;export default()=>{const c=useChat();return <View><Text>{c.messages.map(m=>m.content?.[0]?.text||'').join(' ')}</Text></View>};`,'/tools.ts':`import {Type} from 'typebox';export default pi=>{pi.registerTool({name:'ui_echo',label:'Echo',description:'Echo a message',parameters:Type.Object({text:Type.String()}),async execute(id,p,signal,onUpdate,ctx){onUpdate({content:[{type:'text',text:'partial'}],details:{id}});if(p.text==='cancel')await new Promise(resolve=>signal.addEventListener('abort',resolve));signal.throwIfAborted();return {content:[{type:'text',text:p.text}],details:{id,cwd:ctx.cwd,contextKeys:Object.keys(ctx).sort()}};}});};`};
  vm.runInContext(await bundle({appID:'morph-chat',chatUI:true,files}),context,{timeout:2000});await wait(80);
  assert.equal(messages.some(m=>m.type==='error'),false,JSON.stringify(messages));const spec=messages.find(m=>m.type==='pi_tools'&&m.tools.length)?.tools[0];assert.equal(spec.name,'ui_echo');assert.equal(spec.execute,undefined);
  context.window.__morphSetChatState({title:'Test',mode:'full',messages:[{role:'user',content:[{type:'text',text:'Real text'}]}],draft:'not exposed',token:'not exposed'});await wait(50);
  const snapshot=context.window.snapshot();assert.equal(snapshot.messages[0].content[0].text,'Real text');assert.equal(Object.isFrozen(snapshot.messages[0].content[0]),true);assert.equal(snapshot.draft,undefined);assert.equal(snapshot.token,undefined);
  await context.window.__morphPiExecute({requestId:'one',name:'ui_echo',toolCallId:'pi-id',args:{text:'hello'}});
  assert.ok(messages.some(m=>m.type==='pi_tool_update'&&m.requestId==='one'));assert.equal(messages.find(m=>m.type==='pi_tool_result'&&m.requestId==='one').result.details.id,'pi-id');
  const details=messages.find(m=>m.type==='pi_tool_result'&&m.requestId==='one').result.details;assert.equal(details.cwd,'/apps/morph-chat');assert.deepEqual(details.contextKeys,['cwd','signal']);
  const pending=context.window.__morphPiExecute({requestId:'two',name:'ui_echo',toolCallId:'cancel-id',args:{text:'cancel'}});context.window.__morphPiCancel('two');await pending;assert.equal(messages.some(m=>m.type==='pi_tool_result'&&m.requestId==='two'),false);
  assert.equal(context.process,undefined);assert.equal(context.require,undefined);
});

test('readonly Pi display projection preserves tool details but excludes reasoning, provider state and oversized output',()=>{
  const original=[{role:'assistant',timestamp:1,content:[{type:'thinking',thinking:'SECRET-REASONING'},{type:'text',text:'Answer'},{type:'toolCall',id:'t',name:'ui_echo',arguments:{text:'hello'}}],provider:'PRIVATE-PROVIDER',apiKey:'PRIVATE-KEY'},{role:'toolResult',toolCallId:'t',toolName:'ui_echo',content:[{type:'text',text:'result'}],details:{chart:[1,2]},isError:false,timestamp:2}];
  const view=chatView(original);assert.equal(view.messages[1].details.chart.length,2);assert.equal(view.messages[0].content[1].type,'toolCall');assert.doesNotMatch(JSON.stringify(view),/SECRET|PRIVATE/);view.messages[1].details.chart.push(3);assert.equal(original[1].details.chart.length,2,'display copies cannot mutate canonical records');
  const large=chatView(Array.from({length:120},()=>({role:'user',content:[{type:'text',text:'x'.repeat(18000)}]})));assert.equal(large.truncated,true);assert.ok(JSON.stringify(large).length<200000);
});
