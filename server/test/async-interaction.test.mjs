import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundle } from '../src/bundle.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('event acknowledgment is distinct from async completion and final render', async () => {
  const messages = [];
  const context = vm.createContext({ console, setTimeout, clearTimeout, window: { ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) } } });
  const code = await bundle({ files: { '/App.tsx': `import React,{useState} from 'react';import {Pressable,Text} from 'react-native';export default function App(){const [status,set]=useState('Idle');return <Pressable testID="connect" onPress={()=>new Promise(resolve=>{set('Loading');window.finishConnect=()=>{set('Connected');resolve()}})}><Text>{status}</Text></Pressable>}` } });
  vm.runInContext(code, context, { timeout: 2000 });
  await wait(50);
  const tree = () => messages.filter(m => m.type === 'tree').at(-1).tree;
  context.window.__morphEvent(tree()[0].props.onPress.event, null, 'connect-test');
  await wait(70);
  assert.ok(messages.some(m => m.type === 'event_done' && m.requestId === 'connect-test'));
  assert.equal(messages.filter(m => m.type === 'activity').at(-1).pendingTasks, 1);
  assert.match(JSON.stringify(tree()), /Loading/);
  context.window.finishConnect();
  await wait(70);
  assert.equal(messages.filter(m => m.type === 'activity').at(-1).pendingTasks, 0);
  assert.match(JSON.stringify(tree()), /Connected/);
});
