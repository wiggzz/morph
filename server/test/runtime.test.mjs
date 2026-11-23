import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Workspace, normalize, starter } from '../src/workspace.mjs';
import { bundle, html } from '../src/bundle.mjs';
import { validateTree, findControl } from '../../mobile/src/nativeTree.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function texts(tree) { return tree.map(n => typeof n === 'string' ? n : texts(n.children)).join(' '); }

async function runtime(files = { '/App.tsx': starter }, dependencies = {}) {
  const messages = [];
  const context = vm.createContext({ console, setTimeout, clearTimeout, window: { ReactNativeWebView: { postMessage: raw => messages.push(JSON.parse(raw)) } } });
  const code = await bundle({ files, dependencies });
  vm.runInContext(code, context, { timeout: 2000 });
  await wait(50);
  return { context, messages, tree: () => messages.filter(m => m.type === 'tree').at(-1)?.tree };
}

test('virtual filesystem is persistent, bounded and has no host paths', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-vfs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const w = new Workspace(dir);
  assert.throws(() => normalize('../../.pi/agent/auth.json'));
  assert.throws(() => normalize('C:\\private.ts'));
  assert.throws(() => normalize('/secret\0.ts'));
  assert.throws(() => w.read('/auth.json'), /not found/);
  w.write('/new.ts', 'const x = 1;');
  const first = w.snapshot();
  w.edit('/new.ts', '1', '2');
  assert.equal(w.read('/new.ts'), 'const x = 2;');
  assert.throws(() => w.edit('/new.ts', 'missing', ''), /exactly once/);
  assert.throws(() => w.write('/huge.ts', 'x'.repeat(128 * 1024 + 1)), /limit/);
  assert.equal(new Workspace(dir).read('/new.ts'), 'const x = 2;');
  w.promote(first);
  const second = w.snapshot(); w.promote(second); w.rollback();
  assert.equal(w.state.live.id, first.id);
  assert.equal(w.read('/new.ts'), 'const x = 2;', 'rollback does not destroy working draft');
});

test('React hooks render a native tree and events update state in the isolated realm', async () => {
  const r = await runtime();
  assert.equal(r.messages.some(m => m.type === 'error'), false, JSON.stringify(r.messages));
  const tree = validateTree(r.tree());
  assert.match(texts(tree), /Native taps:.*0/);
  const control = findControl(tree, 'counter');
  r.context.window.__morphEvent(control.props.onPress.event, null, 'test-1');
  await wait(80);
  assert.match(texts(validateTree(r.tree())), /Native taps:.*1/);
  assert.ok(r.messages.find(m => m.type === 'event_done' && m.requestId === 'test-1'));
  assert.equal(r.context.process, undefined);
  assert.equal(r.context.require, undefined);
});

test('virtual multi-file imports and onChangeText work', async () => {
  const r = await runtime({
    '/App.tsx': `import React, {useState} from 'react'; import {View,TextInput,Text} from 'react-native'; import {label} from './label'; export default function App(){const [v,set]=useState(''); return <View><TextInput testID="name" value={v} onChangeText={set}/><Text>{label}{v}</Text></View>}`,
    '/label.ts': 'export const label = "Hello ";',
  });
  const control = findControl(validateTree(r.tree()), 'name');
  r.context.window.__morphEvent(control.props.onChangeText.event, 'Ada', 'text-1');
  await wait(80);
  assert.match(texts(r.tree()), /Hello.*Ada/);
});

test('bundle import allowlist rejects host filesystem, packages and missing virtual files', async () => {
  for (const spec of ['node:fs', '/etc/passwd', '@earendil-works/pi-coding-agent', './missing']) {
    await assert.rejects(bundle({ files: { '/App.tsx': `import x from '${spec}'; export default x;` } }));
  }
  await assert.rejects(bundle({ files: { '/App.tsx': 'this is invalid typescript !!!' } }));
});

test('runtime errors are reported rather than pretending a render succeeded', async () => {
  const r = await runtime({ '/App.tsx': `import React from 'react'; export default function App(){throw new Error('intentional failure')}` });
  assert.ok(r.messages.some(m => m.type === 'error' && m.error.includes('intentional failure')));
});

test('native bridge rejects unknown components, invalid text, duplicate testIDs and excessive trees', () => {
  const node = (type, children = [], props = {}) => ({ id: '1', type, props, children });
  assert.throws(() => validateTree([node('WebView')]), /Unsupported/);
  assert.throws(() => validateTree([node('View', ['raw text'])]), /Text component/);
  assert.throws(() => validateTree([node('View', [], { testID: 'x' }), node('View', [], { testID: 'x' })]), /Duplicate/);
  assert.throws(() => validateTree(Array.from({ length: 1001 }, () => node('View'))), /limit/);
  const safe = validateTree([node('Text', ['safe'], { style: { backgroundColor: 'red', experimental_backgroundImage: 'url(http://evil)' }, nativeID: 'secret', onLayout: { event: '1:onLayout' } })]);
  assert.deepEqual(safe[0].props, { style: { backgroundColor: 'red' } });
  assert.match(html('console.log("</script>")'), /<\\\/script/);
  assert.match(html(''), /connect-src 'none'/);
});
