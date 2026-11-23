import { useLayoutEffect, useRef } from 'react';
import { beginTask } from './activity';
import { jsonCopy, validName, validateSchema, validateInput } from './bridge-validation';
const send = value => window.ReactNativeWebView.postMessage(JSON.stringify(value));
const ports = new Map(), pending = new Map();
let sequence = 0, publishTimer;
function schemaDefaults(schema) {
  if (schema.type === 'object' && schema.additionalProperties === undefined) schema.additionalProperties = false;
  for (const child of Object.values(schema.properties || {})) schemaDefaults(child);
  if (schema.items) schemaDefaults(schema.items);
  return schema;
}
function commandSpec(value) {
  const run = typeof value === 'function' ? value : value?.run;
  if (typeof run !== 'function') throw new Error('Port command needs a function or {run,input,description}');
  const input = jsonCopy(value?.input || { type: 'object', additionalProperties: true }, 8000);
  validateSchema(input);
  return { run, input: schemaDefaults(input), description: String(value?.description || '').slice(0, 500) };
}
function snapshot() {
  const result = [...ports].map(([name, entry]) => ({
    name, description: String(entry.spec.description || '').slice(0, 500), state: jsonCopy(entry.spec.state ?? null),
    commands: Object.entries(entry.spec.commands || {}).map(([name, command]) => { const spec = commandSpec(command); return { name, description: spec.description, input: spec.input }; }),
  }));
  return jsonCopy(result, 128000);
}
function publish() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    try { send({ type: 'ports', ports: snapshot() }); }
    catch (error) { send({ type: 'error', error: error.message, diagnostics: { code: 'AGENT_PORTS' } }); }
  }, 0);
}
export function useAgentPort(name, spec) {
  const owner = useRef({});
  useLayoutEffect(() => {
    if (!validName(name) || !spec || typeof spec !== 'object') throw new Error('useAgentPort needs a valid name and specification');
    if (ports.has(name) && ports.get(name).owner !== owner.current) throw new Error('Duplicate agent port: ' + name);
    if (!ports.has(name) && ports.size >= 16) throw new Error('At most 16 agent ports are supported');
    if (Object.keys(spec.commands || {}).length > 32 || Object.keys(spec.commands || {}).some(command => !validName(command))) throw new Error('Invalid/too many port commands');
    jsonCopy(spec.state ?? null);
    for (const command of Object.values(spec.commands || {})) commandSpec(command);
    ports.set(name, { owner: owner.current, spec }); publish();
  });
  useLayoutEffect(() => () => {
    if (ports.get(name)?.owner === owner.current) { ports.delete(name); publish(); }
  }, [name]);
}
window.__morphAgentResult = message => {
  const waiter = pending.get(message.requestId);
  if (!waiter) return;
  pending.delete(message.requestId); clearTimeout(waiter.timer); waiter.finish();
  message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(message.data);
};
export const agent = {
  async send({ text, context = null }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) return Promise.reject(new Error('Agent text must be 1–4000 characters'));
    if (pending.size >= 4) return Promise.reject(new Error('Too many pending agent receipts'));
    const safeContext = jsonCopy(context, 12000), requestId = 'agent-' + (++sequence);
    return new Promise((resolve, reject) => {
      const finish = beginTask();
      const timer = setTimeout(() => { pending.delete(requestId); finish(); reject(new Error('Agent receipt timed out')); }, 8000);
      pending.set(requestId, { resolve, reject, timer, finish });
      try { send({ type: 'agent_send', requestId, text: text.trim(), context: safeContext }); }
      catch (error) { pending.delete(requestId); clearTimeout(timer); finish(); reject(error); }
    });
  },
};
export const storage = {
  get: key => appRequest({action:'state_get',key}),
  set: (key,value) => appRequest({action:'state_set',key,value}),
  delete: key => appRequest({action:'state_delete',key}),
  list: () => appRequest({action:'state_list'}),
  forApp: appID => ({get:key=>appRequest({action:'state_get',appID,key}),set:(key,value)=>appRequest({action:'state_set',appID,key,value}),delete:key=>appRequest({action:'state_delete',appID,key}),list:()=>appRequest({action:'state_list',appID})}),
};
export const apps = {
  describe: appID => appRequest({action:'describe',appID}),
  inspect: (appID,port) => appRequest({action:'inspect',appID,port}),
  invoke: (appID,port,command,args = {}) => appRequest({action:'invoke',appID,port,command,args}),
};
async function appRequest(payload) {
  if ((!payload.action.startsWith('state_') || payload.appID !== undefined) && (typeof payload.appID !== 'string' || !/^[a-z][a-z0-9-]{0,49}$/.test(payload.appID))) throw new Error('Choose a valid target app ID');
  if (pending.size >= 8) throw new Error('Too many app calls');
  const safe = jsonCopy(Object.fromEntries(Object.entries(payload).filter(([,value]) => value !== undefined)),18000), requestId = 'app-' + (++sequence);
  return new Promise((resolve,reject) => {
    const finish = beginTask();
    const timer = setTimeout(() => {pending.delete(requestId);finish();reject(new Error('App call timed out'));},18000);
    pending.set(requestId,{resolve,reject,timer,finish});
    try {send({type:'app_call',requestId,payload:safe});} catch(error) {pending.delete(requestId);clearTimeout(timer);finish();reject(error);}
  });
}
window.__morphPortCommand = async request => {
  const finish = beginTask();
  try {
    const entry = ports.get(request.port);
    if (!entry || !Object.hasOwn(entry.spec.commands || {}, request.command)) throw new Error('Unknown port or command');
    const command = commandSpec(entry.spec.commands[request.command]);
    const args = jsonCopy(Object.hasOwn(request, 'args') ? request.args : {});
    validateInput(command.input, args);
    const result = await command.run(args);
    send({ type: 'port_result', requestId: request.requestId, result: jsonCopy(result ?? null) });
  } catch (error) { send({ type: 'port_result', requestId: request.requestId, error: String(error.message).slice(0, 2000) }); }
  finally { finish(); publish(); }
};
