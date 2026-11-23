import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundle } from '../src/bundle.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(source) {
  const messages = [];
  const context = vm.createContext({ console: { ...console, error() {} }, setTimeout, clearTimeout, window: { ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) } } });
  vm.runInContext(await bundle({ files: { '/App.tsx': source } }), context, { timeout: 2000 });
  await wait(50);
  return { context, messages, ports: () => messages.filter(m => m.type === 'ports').at(-1)?.ports || [] };
}

test('named ports expose bounded state and schemas; commands validate arguments and see current React state', async () => {
  const r = await run(`import React,{useState} from 'react';import {Text} from 'react-native';import {useAgentPort} from '@morph/agent';export default function App(){const [count,set]=useState(0);useAgentPort('counter',{description:'Demo counter',state:{count},commands:{set:{description:'Set a bounded count',input:{type:'object',properties:{value:{type:'integer',minimum:0,maximum:100}},required:['value']},run:({value})=>{set(value);return {count:value}}},increment:()=>set(count+1),clear:{input:{type:'null'},run:value=>{set(0);return value}}}});return <Text>{count}</Text>}`);
  assert.equal(r.ports()[0].name, 'counter');
  assert.equal(r.ports()[0].state.count, 0);
  assert.equal(r.ports()[0].commands[0].input.properties.value.type, 'integer');
  await r.context.window.__morphPortCommand({ requestId: 'bad', port: 'counter', command: 'set', args: { value: 'not-a-number' } });
  assert.match(r.messages.find(m => m.type === 'port_result' && m.requestId === 'bad').error, /expected integer/);
  await r.context.window.__morphPortCommand({ requestId: 'set', port: 'counter', command: 'set', args: { value: 7 } });
  await wait(30);
  assert.equal(r.ports()[0].state.count, 7);
  await r.context.window.__morphPortCommand({ requestId: 'inc', port: 'counter', command: 'increment', args: {} });
  await wait(30);
  assert.equal(r.ports()[0].state.count, 8, 'command closures are refreshed, not stuck at the initial render');
  await r.context.window.__morphPortCommand({ requestId: 'clear', port: 'counter', command: 'clear', args: null });
  await wait(30);
  assert.equal(r.ports()[0].state.count, 0);
  assert.equal(r.messages.find(m => m.type === 'port_result' && m.requestId === 'clear').result, null);
  assert.equal(r.messages.filter(m => m.type === 'activity').at(-1).pendingTasks, 0);
});

test('a tool-invoked handler can ask the main agent and finish on a receipt without waiting for approval/agent completion', async () => {
  const r = await run(`import React from 'react';import {Text} from 'react-native';import {agent,useAgentPort} from '@morph/agent';export default function App(){useAgentPort('help',{state:{selected:'123'},commands:{ask:async()=>agent.send({text:'Explain selection',context:{selected:'123'}})}});return <Text>Ready</Text>}`);
  const invocation = r.context.window.__morphPortCommand({ requestId: 'invoke', port: 'help', command: 'ask', args: {} });
  const request = r.messages.find(m => m.type === 'agent_send');
  assert.equal(request.text, 'Explain selection');
  assert.deepEqual(request.context, { selected: '123' });
  assert.equal(request.capabilityID, undefined, 'WebView code never gets a native capability');
  r.context.window.__morphAgentResult({ requestId: request.requestId, data: { requestId: 'review-id', status: 'pending_approval' } });
  await Promise.race([invocation, wait(500).then(() => { throw new Error('Deadlock waiting for main agent'); })]);
  const result = r.messages.find(m => m.type === 'port_result' && m.requestId === 'invoke');
  assert.equal(result.result.status, 'pending_approval');
  assert.equal(r.messages.filter(m => m.type === 'activity').at(-1).pendingTasks, 0);
});

test('invalid/duplicate ports and non-JSON state produce actionable errors', async () => {
  const duplicate = await run(`import React from 'react';import {useAgentPort} from '@morph/agent';function Port(){useAgentPort('same',{state:{},commands:{}});return null}export default function App(){return <><Port/><Port/></>}`);
  assert.ok(duplicate.messages.some(m => m.type === 'error' && /Duplicate agent port/.test(m.error)));
  const invalid = await run(`import React from 'react';import {useAgentPort} from '@morph/agent';export default function App(){useAgentPort('bad',{state:{fn:()=>0},commands:{}});return null}`);
  assert.ok(invalid.messages.some(m => m.type === 'error' && /JSON/.test(m.error)));
});
