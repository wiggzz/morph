import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bundle } from '../src/bundle.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('published JS clients call the broker asynchronously and update React without receiving credentials', async () => {
  const messages = [];
  const snapshot = {
    files: { '/App.tsx': `import React,{useState,useEffect} from 'react'; import {Text} from 'react-native'; import {read} from '@plugins/example'; export default function App(){const [v,set]=useState('loading');useEffect(()=>{read().then(r=>set(r.title)).catch(e=>set(e.message))},[]);return <Text>{v}</Text>}` },
    dependencies: { example: { hash: 'published-source-hash', files: { '/index.ts': `import {plugins} from '@morph/plugins'; export const read=()=>plugins.call('example','request',{url:'https://example.com/data'});` } } },
  };
  const context = vm.createContext({ console, setTimeout, clearTimeout, window: { ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) } } });
  vm.runInContext(await bundle(snapshot), context, { timeout: 2000 });
  await wait(70);
  const call = messages.find(m => m.type === 'plugin_call');
  assert.deepEqual(call.args, { url: 'https://example.com/data' });
  assert.equal(call.plugin, 'example');
  assert.equal(messages.filter(m => m.type === 'activity').at(-1).pendingTasks, 1);
  assert.equal(Object.hasOwn(call, 'capabilityID'), false);
  context.window.__morphPluginResult({ requestId: call.requestId, data: { title: 'Remote data arrived' } });
  await wait(70);
  assert.match(JSON.stringify(messages.filter(m => m.type === 'tree').at(-1)), /Remote data arrived/);
  assert.equal(messages.filter(m => m.type === 'activity').at(-1).pendingTasks, 0);
  assert.equal(context.process, undefined);
  assert.equal(context.require, undefined);
});
