import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Library } from './library.mjs';
import {UsageLog} from './usage.mjs';
import {chatView} from './chat-view.mjs';
import {toolResult} from './project-tools.mjs';
import {CHAT_APP_ID,installSystemChat} from './system-chat.mjs';
import { PluginInstances } from './plugin-instances.mjs';
import { bundle, html } from './bundle.mjs';
import { makeAgent } from './agent.mjs';
import { PluginManager } from './plugins.mjs';
import { RuntimeCapabilities } from './runtime-capabilities.mjs';
import { AgentBridge } from './agent-bridge.mjs';
import { chatTranscript, activityLabel } from './chat-presentation.mjs';
import { previewReadError, previewResult, acceptsPreviewError } from './preview-diagnostics.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = path.resolve(process.env.MORPH_DATA || path.join(root, '.data'));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const tokenFile = path.join(dataDir, 'pairing-token');
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const token = fs.readFileSync(tokenFile, 'utf8').trim();
let library, instances;
const workspace = new Proxy({}, { get: (_target,key) => { const w = library.workspace(); const value = w[key]; return typeof value === 'function' ? value.bind(w) : value; } });
const port = Number(process.env.MORPH_PORT || 8787);
const plugins = new PluginManager({ trusted:true, directory: path.join(root, 'plugins'), dataDir, callbackBase: `http://127.0.0.1:${port}`, notify: () => notify() });
library = new Library(dataDir,plugins.packages);
installSystemChat(library);
instances = new PluginInstances({dataDir,plugins,callbackBase:`http://127.0.0.1:${port}`,notify:() => notify(),setup:id => send({type:'instance_setup',id}),saveBinding:(appID,plugin,slot,id) => {
  if (!library.state.apps.some(a => a.id === appID && !a.deletedAt)) return;
  const bindings = library.data(appID,'get','pluginInstances') || {};
  library.data(appID,'set','pluginInstances',{...bindings,[plugin+':'+slot]:id});
}});
const agentPlugins = new Proxy(plugins,{get:(target,key) => key === 'instances' ? instances : key === 'call' ? (id,method,args,ctx) => instances.call(id,method,args,{appID:library.state.activeApp,...ctx}) : typeof target[key] === 'function' ? target[key].bind(target) : target[key]});
const capabilities = new RuntimeCapabilities(agentPlugins);
const agentBridge = new AgentBridge({ trusted:true, capabilities, dataDir, notify: () => notify() });
const snapshot = () => ({...workspace.snapshot(library.dependencies(plugins.dependencies())),appID:library.state.activeApp,chatUI:library.app().system==='chat'});
async function buildPlugin(id) {
  const draft = plugins.packages.validate(id);
  await bundle({ files: { '/App.tsx': `import React from 'react'; import * as client from '@plugins/${id}'; export default () => React.createElement('Text', null, Object.keys(client).join(', '));` }, dependencies: { [id]: { hash: draft.id, files: draft.files } } });
  const result = { id, hash: draft.id, status: 'compiled', note: 'Manifest/JS compile only; not executed or network/device-tested.' };
  send({ type: 'plugin_build_result', ...result });
  return result;
}
function mountPayload(surface, release, code) {
  const appID=release.appID || library.state.activeApp;
  if(surface==='live' && appID!==CHAT_APP_ID && !capabilities.live(appID) && [...new Set(capabilities.active.values())].filter(r=>r.surface==='live' && r.appID!==CHAT_APP_ID).length>=4) throw new Error('Close a running app from Home first (limit 4)');
  if(surface==='live'&&appID===CHAT_APP_ID){projectToolSpecs=null;agent?.projectTools.clear();}
  release={...release,appID,chatUI:library.app(appID).system==='chat',dependencies:library.dependencies(release.dependencies || {},appID)};
  return {chatUI:release.chatUI,appID,html:html(code),snapshotID:release.id,capabilityID:capabilities.issue(surface,release),viewEpoch:surface==='preview'?previewEpoch:null};
}
let client;
let busy = false;
let currentActivity = null;
let controlBusy = false;
let preview = null;
let previewEpoch = 0;
let deployRequested = false;
let renderBusy = false;
let login = null;
let authState = null;
let authPending = null;
let agent;
const usage=new UsageLog(dataDir);
let projectToolSpecs=null,streamingView=null,viewTimer=null,viewEvent=null;
function publishChatView(event=null,immediate=false){
  if(event)viewEvent=event;
  const flush=()=>{viewTimer=null;if(agent)send({type:'chat_view',chatID:library.state.activeChat,...chatView(agent.session.messages,streamingView,viewEvent)});};
  if(immediate){clearTimeout(viewTimer);flush();}else if(!viewTimer)viewTimer=setTimeout(flush,80);
}
function syncProjectTools(spec){
  const record=capabilities.record(spec.capabilityID);
  if(record.appID!==CHAT_APP_ID||record.surface!=='live'||capabilities.live(CHAT_APP_ID)?.id!==record.id)throw new Error('Only the live system chat may register Pi tools');
  agent.projectTools.sync(spec.tools,record.id,async(identity,name,id,args,signal,onUpdate)=>{
    if(capabilities.live(CHAT_APP_ID)?.id!==identity)throw new Error('Chat tool runtime changed');
    return host('chat_tool_execute',{surface:'live',appID:CHAT_APP_ID,name,toolCallId:id,args},signal,undefined,onUpdate);
  });projectToolSpecs=spec;
}
let layoutLogTimer;
let lastKeyboardLayout;
const pending = new Map();
const busEdges = new Map();
const appPromptQueue = []; let drainingPrompts = false;
async function drainAppPrompts() {
  if (drainingPrompts || busy || controlBusy || login) return;
  drainingPrompts = true;
  try {
    while (appPromptQueue.length && !busy && !controlBusy && !login) {
      const next = appPromptQueue.shift();
      try {capabilities.record(next.capabilityID);} catch {continue;}
      if (library.state.activeChat !== next.chatID) await switchChat(next.chatID);
      await promptAgent(next.prompt);
    }
  } catch(error) {send({type:'error',error:error.message});}
  finally {drainingPrompts = false;}
}
function busPath(from,to,seen = new Set()) { if (from === to) return true; if (seen.has(from)) return false; seen.add(from); return [...busEdges.values()].some(edge => edge.from === from && busPath(edge.to,to,seen)); }
const send = message => { if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); };
const transcript = () => chatTranscript(agent.session.messages);
function notify() {
  if (!agent) return;
  const current = library.state.activeApp ? library.workspace() : null;
  send({ type: 'state', library: library.view(), runningApps: [...new Set(capabilities.active.values())].filter(r => r.surface === 'live' && r.appID && r.appID!==CHAT_APP_ID).map(r => ({id:r.appID,snapshotID:r.snapshotID,version:r.version})), agentBridge: agentBridge.state(), deviceBusy: controlBusy, layoutDiagnostics: true, files: current?.state.files || {}, draftID: current ? snapshot().id : null,
    history: current?.releases.list() || {entries:[]}, liveVersion: current?.state.live?.version,
    chatTools:agent.session.getActiveToolNames().filter(name=>agent.projectTools.entries.has(name)),
    pluginInstances: instances.list(), trustedSandbox:true, plugins: plugins.list(), pluginWorkspaces: plugins.packages.list(),
    preview: preview && { appID:preview.appID, id: preview.id, status: preview.status, error: preview.error, diagnostics: preview.diagnostics },
    liveID: current?.state.live?.id, previousID: current?.state.previous?.id,
    deployRequested, busy: busy || controlBusy, activity: currentActivity || (busy ? 'Thinking…' : controlBusy ? 'Loading the app…' : null), model: agent.session.model?.id,
    models: agent.models().map(m => ({ id: m.id, name: m.name, image: m.input.includes('image') })),
    authenticated: agent.modelRuntime.hasConfiguredAuth('openai-codex'), auth: authState,
  });publishChatView();
}
function invalidatePreview() {
  capabilities.revoke('preview'); previewEpoch++;
  if (preview) { preview.status = 'invalidated'; preview.error = 'Plugin access/version changed. Render again.'; preview.diagnostics = { code: 'PLUGIN_ACCESS_CHANGED' }; }
  deployRequested = false;
  send({ type: 'clear_preview' });
}
const appReads = new Set(['inspect', 'screenshot', 'interact', 'app_describe', 'app_inspect', 'app_invoke', 'chat_tool_execute']);
const scopeFor = op => ['interact', 'app_invoke', 'chat_tool_execute'].includes(op) ? 'control' : 'read';
function host(op, payload = {}, signal, access, onUpdate) {
  const surface = payload.surface || 'preview';
  const primary = library.chat().primary;
  if (appReads.has(op) && !payload.appID && !primary?.startsWith('app:')) throw new Error('Supply appID or focus an app project in this chat');
  const targetApp = payload.appID || (appReads.has(op) ? primary.slice(4) : library.state.activeApp);
  if (appReads.has(op)) payload = {...payload,appID:targetApp};
  if (access) payload.background = true;
  if (targetApp===CHAT_APP_ID && surface==='live' && op==='screenshot') return Promise.reject(new Error('Actual chat screenshots are protected; render the chat UI Preview with fixture messages instead'));
  if (targetApp===CHAT_APP_ID && (surface==='live' || op==='deploy')) payload={...payload,background:true};
  if (!access && targetApp!==CHAT_APP_ID && surface === 'live' && ['app_invoke','interact','screenshot'].includes(op)) {library.app(targetApp);library.state.activeApp = targetApp;library.save();capabilities.select(targetApp);notify();}
  if (op === 'app_invoke') {
    try {
      const args = JSON.stringify(payload.args === undefined ? {} : payload.args);
      if (args === undefined || Buffer.byteLength(args) > 16000) return Promise.reject(new Error('Port arguments must be JSON under 16 KiB'));
    } catch { return Promise.reject(new Error('Port arguments must be bounded JSON')); }
  }
  if (appReads.has(op) && !['preview', 'live'].includes(surface)) return Promise.reject(new Error('Choose preview or live'));
  if (appReads.has(op) && surface === 'live') {
    try { const approval = access ? agentBridge.authorizeLink(access.token,targetApp,scopeFor(op)) : agentBridge.authorize(surface, scopeFor(op),targetApp); if (approval) { const request = agentBridge.requests.get(approval.requestId); if (!access && request) { request.chatID = library.state.activeChat; request.chatTitle = library.chat().title; notify(); } return Promise.resolve(approval); } }
    catch (error) { return Promise.reject(error); }
  }
  if (appReads.has(op) && surface === 'preview') {
    if (preview?.appID && preview.appID !== targetApp) return Promise.reject(new Error('Preview belongs to ' + preview.appID + '; render the requested app first'));
    const blocked = previewReadError(preview);
    if (blocked) return ['inspect', 'app_describe', 'app_inspect'].includes(op) ? Promise.resolve({ status: preview?.status || 'empty', tree: [], ports: [], error: blocked, diagnostics: { code: preview?.status === 'invalidated' ? 'PLUGIN_ACCESS_CHANGED' : 'PREVIEW_UNAVAILABLE' } }) : Promise.reject(new Error(blocked));
    if (op.startsWith('app_') && preview?.status === 'error') return Promise.resolve(previewResult(preview, { ports: [] }));
  }
  if (!client || client.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Open the Morph Android client first'));
  const target = client;
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const finish = (err, result) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(id);
      if(err&&op==='chat_tool_execute'&&target.readyState===WebSocket.OPEN)target.send(JSON.stringify({type:'chat_tool_cancel',id}));
      err ? reject(err) : resolve(result);
    };
    const abort = () => finish(new Error('Cancelled'));
    const timer = setTimeout(() => finish(new Error('Device timed out; keep Morph in the foreground')), 20000);
    pending.set(id, { finish, onUpdate, client: target, op, surface, viewEpoch: previewEpoch, appID:targetApp, access, runtimeID: (surface === 'live' ? capabilities.live(targetApp) : capabilities.active.get(surface))?.id, bridgeEpoch: surface === 'live' ? access ? agentBridge.linkCheck(access.token,targetApp,scopeFor(op)).epoch : agentBridge.accessEpoch(capabilities.live(targetApp)) : null });
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    target.send(JSON.stringify({ type: 'host_request', id, op, payload }));
  });
}
async function render(signal, appID, background = false) {
  if (!appID) { const primary = library.chat().primary; if (!primary?.startsWith('app:')) throw new Error('Choose an app with render({appID}); plugin projects use plugin_build.'); appID = primary.slice(4); }
  library.app(appID); library.state.activeApp = appID; library.save(); capabilities.select(appID);
  if (renderBusy) throw new Error('A render is already in progress');
  renderBusy = true;
  const epoch = ++previewEpoch;
  capabilities.revoke('preview'); send({ type: 'clear_preview' });
  const draft = snapshot();
  preview = { ...draft, status: 'compiling', phase: 'compile' }; deployRequested = false; notify();
  try {
    const code = await bundle(draft);
    if (previewEpoch !== epoch) throw new Error('Preview invalidated during compilation. Render again.');
    preview = { ...draft, code, status: 'rendering', phase: 'native' }; notify();
    const payload = {...mountPayload('preview', draft, code),background};
    const result = await host('render', payload, signal);
    if (previewEpoch !== epoch || capabilities.active.get('preview')?.id !== payload.capabilityID) throw new Error('Preview invalidated while mounting. Render again.');
    preview.status = 'ready'; notify();
    return { id: draft.id, ...result };
  } catch (e) {
    if (previewEpoch === epoch) {
      capabilities.revoke('preview');
      preview.status = 'error'; preview.error = preview.error || String(e.message);
      preview.diagnostics ||= e.diagnostics || { code: preview.phase === 'compile' ? 'COMPILE_ERROR' : 'NATIVE_RENDER_ERROR', ...(e.errors?.[0]?.location ? { location: { file: e.errors[0].location.file, line: e.errors[0].location.line, column: e.errors[0].location.column } } : {}) };
      send({ type: 'preview_diagnostic', snapshotID: draft.id, viewEpoch: epoch, error: preview.error, diagnostics: preview.diagnostics });
      notify();
    }
    throw e;
  } finally { renderBusy = false; }
}
function requestDeploy() {
  if (preview?.status !== 'ready') throw new Error('Render a healthy preview first');
  if (preview.id !== snapshot().id) throw new Error('Source changed after preview; render again');
  return 'Healthy preview ready to deploy';
}
async function promotePreview(label = '') {
  requestDeploy();
  return exclusive(async () => {
    const release = {id:preview.id,files:preview.files,dependencies:preview.dependencies,appID:library.state.activeApp,chatUI:preview.chatUI===true};
    try {
      await host('deploy',mountPayload('live',release,preview.code));
      if (preview?.status !== 'ready' || release.id !== snapshot().id) throw new Error('Draft changed during deployment; render again');
    } catch(error) {
      const previous = workspace.state.live;
      if (previous) {try {await host('deploy',mountPayload('live',previous,await bundle(previous)));} catch {}}
      else {capabilities.revoke('live:'+library.state.activeApp);send({type:'close_app',appID:library.state.activeApp});}
      throw error;
    }
    const published = workspace.promote(release,label);
    capabilities.live(library.state.activeApp).version = published.version;deployRequested = false;notify();
    return {appID:library.state.activeApp,version:published.version,snapshotID:published.id,status:'deployed'};
  });
}
async function activateApp(appID,version) {
  return exclusive(async () => {library.app(appID);library.state.activeApp=appID;library.save();capabilities.select(appID);const release=workspace.releases.read(version);await host('deploy',mountPayload('live',release,await bundle(release)));workspace.activate(version);notify();return {appID,version};});
}
async function manageRuntime(action,appID) {
  if (action === 'run') return exclusive(() => openApp(appID));
  if (appID===CHAT_APP_ID) throw new Error('Use protected chat recovery to stop the system chat UI');
  library.app(appID);capabilities.revoke('live:'+appID);send({type:'close_app',appID});notify();return 'Closed '+appID;
}
async function loadAgent() {
  const old = agent;streamingView=null;viewEvent=null;clearTimeout(viewTimer);viewTimer=null;
  agent = await makeAgent({ dataDir, usage, workspace, host, notify, render, requestDeploy:() => {if(library.chat().primary !== 'app:'+preview?.appID) throw new Error('Render this chat primary app before deploying');return promotePreview('Agent deployment');}, activateApp, manageRuntime, webActivity: activity => {currentActivity = activity;notify();}, authPath: process.env.MORPH_AUTH_PATH, plugins:agentPlugins, buildPlugin, library, sharedRuntime: old?.modelRuntime });
  old?.projectTools.clear();old?.session.dispose();
  if(projectToolSpecs){try{syncProjectTools(projectToolSpecs);}catch{projectToolSpecs=null;}}
  agent.session.subscribe(event => {
  if(event.type==='message_update'||(event.type==='message_start'&&event.message?.role==='assistant'))streamingView=event.message;
  if(event.type==='message_end')streamingView=null;
  if(['message_start','message_update','message_end','tool_execution_start','tool_execution_update','tool_execution_end','agent_start','agent_settled'].includes(event.type))publishChatView(event);
  if (event.type === 'agent_start') { busy = true; notify(); }
  if (event.type === 'agent_settled') { busy = false; currentActivity = null; notify(); }
  if (event.type === 'message_end' || event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
    if (event.type === 'message_end') send({ type: 'transcript', messages: transcript() });
    else {
      const starting = event.type === 'tool_execution_start';
      currentActivity = starting ? activityLabel(event.toolName) : null;
      send({ type: 'tool', label: currentActivity, phase: starting ? 'start' : 'end' });
    }
  }
  });
}
await loadAgent();

async function switchChat(id) {
  if (busy || login || controlBusy) throw new Error('Stop the current operation before switching chats');
  await exclusive(async () => { library.selectChat(id); await loadAgent(); send({type:'chat_changed',id}); send({type:'transcript',messages:transcript()});publishChatView(null,true); notify(); });
}
async function loadSystemChat() {
  const release=library.workspace(CHAT_APP_ID).state.live;
  if (!release) throw new Error('No chat UI release; use the native fallback');
  try {await host('deploy',{...mountPayload('live',release,await bundle(release)),background:true});}
  finally {capabilities.select(library.state.activeApp);}
}
async function openApp(id) {
  if(id===CHAT_APP_ID) {library.state.activeApp=id;library.save();await loadSystemChat();send({type:'show_chat'});notify();return;}
  library.app(id); library.state.activeApp = id; library.save(); capabilities.select(id);
  if (capabilities.live(id)) { send({type:'show_app',appID:id}); notify(); return; }
  if ([...new Set(capabilities.active.values())].filter(r => r.surface === 'live' && r.appID!==CHAT_APP_ID).length >= 4) throw new Error('Four apps are running. Close one from Home.');
  const release = workspace.state.live;
  if (release) await host('deploy',mountPayload('live',release,await bundle(release)));
  else await render(undefined,id);
  notify();
}

async function startLogin(method) {
  if (login || busy) throw new Error('Stop the current operation first');
  login = new AbortController();
  const current = login;
  authState = { type: 'progress', message: 'Starting Codex sign-in…' }; notify();
  try {
    await agent.modelRuntime.login('openai-codex', 'oauth', {
      signal: current.signal,
      notify: event => { authState = { ...authState, ...event }; notify(); },
      prompt: prompt => {
        if (prompt.type === 'select') return Promise.resolve(method === 'device_code' ? 'device_code' : 'browser');
        return new Promise((resolve, reject) => {
          const id = crypto.randomUUID();
          const finish = (err, answer) => {
            prompt.signal?.removeEventListener('abort', abort);
            current.signal.removeEventListener('abort', abort);
            if (authPending?.id === id) authPending = null;
            err ? reject(err) : resolve(answer);
          };
          const abort = () => finish(new Error('Login prompt cancelled'));
          authPending = { id, finish };
          authState = { ...authState, type: 'prompt', id, message: prompt.message }; notify();
          if (prompt.signal?.aborted || current.signal.aborted) return abort();
          prompt.signal?.addEventListener('abort', abort, { once: true });
          current.signal.addEventListener('abort', abort, { once: true });
        });
      },
    }, { agentName: 'morph' });
    authState = { type: 'complete', message: 'Signed in to Codex' };
  } catch (e) {
    authState = { type: 'error', message: current.signal.aborted ? 'Sign-in cancelled' : e.message };
  } finally { login = null; notify(); }
}

async function exclusive(action) {
  if (controlBusy) throw new Error('A device operation is already in progress');
  controlBusy = true; notify();
  try { return await action(); }
  finally { controlBusy = false; notify(); queueMicrotask(drainAppPrompts); }
}

async function promptAgent(text, queue = false) {
  if (busy || !agent.session.isIdle) {
    if (!queue) throw new Error('Wait for the current operation, or press Stop');
    await agent.session.prompt(text, { streamingBehavior: 'followUp', expandPromptTemplates: false });
    return;
  }
  if (login || controlBusy) throw new Error('Wait for the current operation');
  busy = true; notify();
  try { await agent.session.prompt(text, { expandPromptTemplates: false }); }
  finally { busy = !agent.session.isIdle; currentActivity = null; send({ type: 'transcript', messages: transcript() }); notify(); queueMicrotask(drainAppPrompts); }
}

async function handle(message) {
  if(message.type==='usage_event'){try{usage.record(capabilities.record(message.capabilityID),message);}catch{}return;}
  if(message.type==='chat_tools'){syncProjectTools({capabilityID:message.capabilityID,tools:message.tools});notify();return;}
  if(message.type==='chat_tool_update'){
    const p=pending.get(message.id);
    if(p?.op!=='chat_tool_execute'||p.client!==client||p.runtimeID!==message.capabilityID||capabilities.live(CHAT_APP_ID)?.id!==p.runtimeID)return;
    try{p.onUpdate?.(toolResult(message.result));}catch(error){p.finish(error);}return;
  }
  if(message.type==='system_chat_safe'){projectToolSpecs=null;agent.projectTools.clear();capabilities.revoke('live:'+CHAT_APP_ID);notify();return;}
  if (message.type === 'app_rpc') {
    const sourceClient = client; let edgeID;
    try {
      const payload = message.payload;
      const sourceRecord = capabilities.record(message.capabilityID);
      if (payload?.action?.startsWith('state_')) {
        const data = library.data(payload.appID || sourceRecord.appID,payload.action.slice(6),payload.key,payload.value);
        if (client === sourceClient) send({type:'app_rpc_result',id:message.id,data}); return;
      }
      const ops = {describe:'app_describe',inspect:'app_inspect',invoke:'app_invoke'};
      const op = Object.hasOwn(ops,payload?.action) ? ops[payload.action] : null;
      if (!op) throw new Error('Unknown app operation');
      const record = capabilities.record(message.capabilityID), now = Date.now();
      record.calls = (record.calls || []).filter(t => t > now-1000); if (record.calls.length >= 8) throw new Error('App bus rate limit: 8 calls/second'); record.calls.push(now);
      const p = message.payload; library.app(p.appID);
      if (op === 'app_invoke') {
        if (busPath(p.appID,record.appID)) throw new Error('App command cycle rejected; use local handlers or non-blocking receipts instead');
        edgeID = crypto.randomUUID(); busEdges.set(edgeID,{from:record.appID,to:p.appID});
      }
      const data = await host(op,{surface:'live',appID:p.appID,port:p.port,command:p.command,args:p.args,waitUntilSettled:true},undefined,{token:record.id});
      if (client === sourceClient) send({type:'app_rpc_result',id:message.id,data});
    } catch (error) { if (client === sourceClient) send({type:'app_rpc_result',id:message.id,error:error.message}); }
    finally { if (edgeID) busEdges.delete(edgeID); }
    return;
  }
  if (message.type === 'agent_rpc') {
    try {
      const actor = capabilities.record(message.capabilityID);
      if (message.humanInitiated !== true) throw new Error('Agent requests require an app button press, not a background loop');
      if (!agent.modelRuntime.hasConfiguredAuth('openai-codex')) throw new Error('Sign in to the main Codex agent in protected settings first');
      if ([...pending.values()].some(p => ['app_invoke','interact','chat_tool_execute'].includes(p.op) && !p.access && p.appID === actor.appID)) throw new Error('Nested agent request blocked during a tool-invoked handler. Return data to the current agent instead.');
      if (appPromptQueue.length >= 8) throw new Error('Agent request queue full');
      const data = agentBridge.requestMessage(message.capabilityID, message.payload);
      const request = agentBridge.requests.get(data.requestId), record = capabilities.record(message.capabilityID);
      const primary = record.appID ? 'app:' + record.appID : library.chat().primary;
      let chat = library.state.chats.find(c => c.primary === primary);
      if (!chat) { chat = library.newChatRecord(primary); library.state.chats.unshift(chat); library.save(); }
      request.chatID = chat.id; request.chatTitle = chat.title;
      const approved = agentBridge.decide(request.id,'approve');
      appPromptQueue.push({capabilityID:actor.id,chatID:chat.id,prompt:approved.prompt});
      send({ type: 'agent_rpc_result', id: message.id, data:{...data,status:'queued',chatID:chat.id,note:'Queued in the app builder chat. Receipt only, not an answer.'} });
      queueMicrotask(drainAppPrompts);
    } catch (error) { send({ type: 'agent_rpc_result', id: message.id, error: error.message }); }
    return;
  }
  if (message.type === 'ui_layout') {
    const fields = ['windowWidth', 'windowHeight', 'pixelRatio', 'rootTop', 'rawRootTop', 'screenOffset', 'rootHeight', 'keyboardTop', 'composerTop', 'composerHeight', 'composerBottom', 'baseBottom', 'correction', 'chatBottom', 'chatHeight'];
    const layout = Object.fromEntries(fields.map(key => [key, Number.isFinite(message.layout?.[key]) ? message.layout[key] : null]));
    const record = { receivedAt: new Date().toISOString(), ...layout };
    if (layout.keyboardTop !== null) lastKeyboardLayout = record;
    clearTimeout(layoutLogTimer);
    layoutLogTimer = setTimeout(() => {
      try {
        for (const [filename, value] of [['ui-layout.json', record], ['ui-layout-last-keyboard.json', lastKeyboardLayout]]) {
          if (!value) continue;
          fs.writeFileSync(path.join(dataDir, filename + '.tmp'), JSON.stringify(value, null, 2), { mode: 0o600 });
          fs.renameSync(path.join(dataDir, filename + '.tmp'), path.join(dataDir, filename));
        }
      } catch { console.warn('Layout diagnostics unavailable'); }
    }, 80);
    return;
  }
  if (message.type === 'plugin_rpc') {
    const source = client;
    try {
      const p = message.payload || {}, record = capabilities.record(message.capabilityID);
      const data = p.action === 'open' ? instances.open(p.plugin,p.options,record.appID) : p.action === 'list' ? instances.list().map(({auth,methods,...row}) => row) : p.action ? (() => {throw new Error('Credential management is available only in protected account setup');})() : await capabilities.call(message.capabilityID,p);
      if (client === source) send({ type: 'plugin_rpc_result', id: message.id, data });
    } catch (error) {
      if (client === source) send({ type: 'plugin_rpc_result', id: message.id, error: error.message });
    }
    return;
  }
  if (message.type === 'host_result') {
    const p = pending.get(message.id);
    if (p && p.client === client) {
      try {
      if (appReads.has(p.op) && p.surface === 'preview' && (previewReadError(preview) || p.viewEpoch !== previewEpoch)) p.finish(new Error('Preview replaced or access changed while device operation was running'));
      else if (appReads.has(p.op) && p.surface === 'live' && (capabilities.live(p.appID)?.id !== p.runtimeID || (p.access ? !agentBridge.linkCheck(p.access.token,p.appID,scopeFor(p.op)).allowed || agentBridge.linkCheck(p.access.token,p.appID,scopeFor(p.op)).epoch !== p.bridgeEpoch : agentBridge.accessEpoch(capabilities.live(p.appID)) !== p.bridgeEpoch || !agentBridge.check('live', scopeFor(p.op),p.appID).allowed))) p.finish(new Error('Live app replaced or agent access revoked while the operation was running'));
      else p.finish(message.error ? new Error(String(message.error)) : null, appReads.has(p.op) ? p.surface === 'preview' ? previewResult(preview, message.data) : { ...message.data, appID:p.appID, surface: 'live', snapshotID: capabilities.live(p.appID)?.snapshotID, status: message.data?.error ? 'error' : 'ready' } : message.data);
      } catch (error) { p.finish(error); }
    }
    return;
  }
  if (message.type === 'runtime_error') {
    if(message.surface===CHAT_APP_ID) {if(capabilities.live(CHAT_APP_ID)?.id!==message.capabilityID)return;projectToolSpecs=null;agent.projectTools.clear();capabilities.revoke('live:'+CHAT_APP_ID);notify();return;}
    if (acceptsPreviewError(preview, previewEpoch, message)) {
      capabilities.revoke('preview');
      preview.status = 'error'; preview.error = String(message.error).slice(0, 4000); preview.diagnostics = message.diagnostics || { code: 'NATIVE_RENDER_ERROR' }; deployRequested = false; notify();
    }
    return;
  }
  if (message.type.startsWith('instance_')) {
    if (message.type === 'instance_create') {const row = instances.open(message.plugin,message.options || {},message.appID || library.state.activeApp);send({type:'instance_setup',id:row.id});}
    else if (message.type === 'instance_configure') instances.configure(message.id,message.config || {});
    else if (message.type === 'instance_connect') send({type:'instance_auth',id:message.id,url:instances.connect(message.id),label:instances.metadata(message.id).label,browser:instances.metadata(message.id).auth.browser||null});
    else if(message.type==='instance_oauth_callback'){try{await instances.finishBrowser(message.id,message.url);send({type:'instance_auth_complete',id:message.id});}catch{send({type:'instance_auth_failed',id:message.id,error:'Sign-in failed or expired. Cancel and reconnect; check the recipe and provider support.'});}}
    else if(message.type==='instance_oauth_cancel')instances.cancelOAuth(message.id);
    else if (message.type === 'instance_exchange') await instances.exchange(message.id);
    else if (message.type === 'instance_disconnect') instances.disconnect(message.id);
    else if (message.type === 'instance_copy_registration') instances.copyRegistration(message.from,message.id);
    else throw new Error('Unknown credential-management operation');
    notify(); return;
  }
  if (message.type.startsWith('plugin_')) {
    const id = message.plugin;
    if (message.type === 'plugin_read_file') send({ type: 'plugin_file', plugin: id, path: message.path, content: plugins.packages.read(id, message.path) });
    else if (message.type === 'plugin_create') { if (busy) throw new Error('Wait for the agent'); plugins.packages.create(id); }
    else if (message.type === 'plugin_save_file') { if (busy) throw new Error('Wait for the agent'); plugins.packages.write(id, message.path, message.content); }
    else if (message.type === 'plugin_build') await buildPlugin(id);
    else if (message.type === 'plugin_publish') {
      if (busy || controlBusy) throw new Error('Wait for the current operation');
      await exclusive(async () => {
        const result = await buildPlugin(id);
        if (result.hash !== message.hash) throw new Error('Plugin draft changed; review the new source before publishing');
        plugins.packages.publish(id, message.hash, message.label || ''); plugins.reload();
      });
    } else if (message.type === 'plugin_activate') {
      if (busy || controlBusy) throw new Error('Wait for the current operation');
      plugins.abort(id); plugins.packages.activate(id, message.version); plugins.reload();
    } else throw new Error('Unknown plugin operation');
    if (['plugin_publish', 'plugin_activate'].includes(message.type)) {
      if (preview?.dependencies?.[id] || plugins.dependencies()[id]) invalidatePreview();
    }
    notify(); return;
  }
  if (controlBusy && !['stop', 'cancel_login', 'auth_answer'].includes(message.type))
    throw new Error('Wait for the current device operation');
  if (message.type === 'project_create') {
    if (busy || login) throw new Error('Wait for the current operation');
    library.create(message.kind,message.id,message.name,message.icon);notify();
  } else if (message.type === 'new_chat' || message.type === 'open_chat') {
    if (busy || login) throw new Error('Stop the current operation before changing chats');
    const chat = message.type === 'new_chat' ? library.createChat(message.primary || null) : library.chat(message.id);
    await switchChat(chat.id);
  } else if (message.type === 'open_project') {
    if (busy || login) throw new Error('Stop the current operation before opening a project');
    const p = library.project(message.project);
    if (message.build) { let chat = library.state.chats.find(c => c.primary === p.key); if (!chat) chat = library.createChat(p.key); await switchChat(chat.id); }
    if (p.kind === 'app') await exclusive(() => openApp(p.id)); else send({type:'show_plugin',id:p.id,build:message.build === true});
  } else if (message.type === 'system_chat_load') {
    await exclusive(loadSystemChat);notify();
  } else if (message.type === 'close_app') {
    if(message.appID===CHAT_APP_ID) throw new Error('Use protected chat recovery instead');
    capabilities.revoke('live:' + message.appID); send({type:'close_app',appID:message.appID}); notify();
  } else if (['trash_app','restore_app','purge_app'].includes(message.type)) {
    if (busy || login || renderBusy) throw new Error('Wait for the current operation before changing Trash');
    await exclusive(async () => {
      const id = message.appID;
      if (message.type === 'restore_app') library.restoreApp(id);
      else if (message.type === 'purge_app') {
        if (message.confirm !== true) throw new Error('Confirm permanent app deletion');
        library.purgeApp(id);
      } else {
        library.trashApp(id);
        capabilities.revoke('live:'+id); capabilities.select(library.state.activeApp); send({type:'close_app',appID:id});
        if (preview?.appID === id) {capabilities.revoke('preview');previewEpoch++;preview = null;deployRequested = false;send({type:'clear_preview'});}
      }
      send({type:'show_home'});notify();
    });
  } else if (message.type === 'project_update') {
    library.update(message.project,{name:message.name,icon:message.icon}); notify();
  } else if (message.type === 'chat') {
    if (busy || login) throw new Error('Wait for the current operation, or press Stop');
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 32000) throw new Error('Message must be 1–32000 characters');
    if (library.chat().title === 'New chat') { library.chat().title = message.text.trim().slice(0,60); library.save(); }
    await promptAgent(message.text);
  } else if (message.type === 'stop') {
    await agent.session.abort();
  } else if (message.type === 'select_model') {
    if (busy) throw new Error('Wait for the current turn');
    const model = agent.models().find(m => m.id === message.id);
    if (!model) throw new Error('Unknown Codex model');
    await agent.session.setModel(model); notify();
  } else if (message.type === 'login') {
    void startLogin(message.method).catch(e => send({ type: 'error', error: e.message }));
  } else if (message.type === 'cancel_login') {
    login?.abort();
  } else if (message.type === 'auth_answer') {
    if (!authPending || message.id !== authPending.id || typeof message.answer !== 'string') throw new Error('No matching login prompt');
    authPending.finish(null, message.answer);
  } else if (message.type === 'logout') {
    if (busy || login) throw new Error('Stop the current operation first');
    await agent.modelRuntime.logout('openai-codex'); authState = null; notify();
  } else if (message.type === 'save_file') {
    if (busy) throw new Error('Wait for the agent before editing');
    workspace.write(message.path, message.content); notify();
  } else if (message.type === 'render') {
    if (busy) throw new Error('Wait for the agent before rendering manually');
    await exclusive(() => render(undefined,library.state.activeApp));
  } else if (message.type === 'promote') {
    if (busy || renderBusy) throw new Error('Wait for the agent/render to finish before promoting');
    await promotePreview(message.label || '');
  } else if (message.type === 'activate_version') {
    if (busy || renderBusy) throw new Error('Wait for the current operation');
    await exclusive(async () => {
      const release = workspace.releases.read(message.version);
      await host('deploy', mountPayload('live', release, await bundle(release)));
      workspace.activate(message.version);
    });
  } else if (message.type === 'rollback') {
    if (busy || renderBusy) throw new Error('Wait for the current operation');
    if (!workspace.state.previous) throw new Error('No previous deployment');
    await exclusive(async () => {
      const previous = workspace.state.previous;
      const code = await bundle(previous);
      await host('deploy', mountPayload('live', previous, code));
      workspace.rollback();
    });
  } else if (message.type === 'hello') {
    if (busy) throw new Error('Wait for the agent to finish reconnecting');
    await exclusive(async () => {
      notify(); send({ type: 'transcript', messages: transcript() });publishChatView(null,true);
      if (library.state.activeApp && library.state.activeApp!==CHAT_APP_ID && workspace.state.live) {
        const live = workspace.state.live;
        const code = await bundle(live);
        await host('deploy', {...mountPayload('live', live, code),background:true});
      }
      // A newly connected host has no mounted preview even if an earlier host did.
      if (preview) { preview.status = 'disconnected'; notify(); }
      try {await loadSystemChat();} catch {send({type:'system_chat_failed'});}
      if (library.state.activeApp && library.state.activeApp!==CHAT_APP_ID && !workspace.state.live) await render(undefined,library.state.activeApp,true);
    });
  } else throw new Error('Unknown message type');
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://127.0.0.1:${port}`); }
  catch { res.writeHead(400); res.end('Invalid URL'); return; }
  if (url.pathname === '/oauth/instances/callback') {
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Referrer-Policy','no-referrer');
    if (req.method !== 'GET') {res.writeHead(405);res.end('Method not allowed');return;}
    void instances.finish(url.searchParams).then(() => {res.end('Account connected. Return to Morph.');},error => {res.writeHead(400);res.end(error.message);}); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
  res.end('Morph local agent service. Connect from the native app.\n');
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 12 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const received = req.headers.authorization || '';
  const expected = 'Bearer ' + token;
  if (Buffer.byteLength(received) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', ws => {
  // One controlling device: never route tools to a different client's surface.
  if (client && client.readyState !== WebSocket.CLOSED) { ws.close(1008, 'A client is already connected'); return; }
  client = ws;
  ws.on('error', e => console.error('Client connection:', e.message));
  ws.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());
      void handle(message).catch(e => send({ type: 'error', error: e.message }));
    } catch { send({ type: 'error', error: 'Invalid message' }); }
  });
  ws.on('close', () => {
    for (const p of pending.values()) if (p.client === ws) p.finish(new Error('Android client disconnected'));
    if (client !== ws) return;
    login?.abort();projectToolSpecs=null;agent.projectTools.clear();clearTimeout(viewTimer);viewTimer=null; capabilities.clear(); agentBridge.clearPending(); previewEpoch++;
    if (preview) preview.status = 'disconnected';
    void agent.session.abort();
    if (client === ws) client = null;
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Morph: ws://127.0.0.1:${port}`);
  console.log(`Pairing token: ${token}`);
  console.log(`Private data: ${dataDir}`);
});
const shutdown = async () => {
  usage.flush();
  clearTimeout(layoutLogTimer);clearTimeout(viewTimer);agent.projectTools.clear();
  login?.abort(); capabilities.clear(); agentBridge.clearPending(); instances.close(); plugins.close(); await agent.session.abort(); agent.session.dispose();
  for (const ws of wss.clients) ws.close();
  server.close(); process.exit(0);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
