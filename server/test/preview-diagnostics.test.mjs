import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTree, TREE_LIMITS } from '../../mobile/src/nativeTree.js';
import { settlePreview } from '../../mobile/src/settlePreview.js';
import { previewReadError, previewResult, acceptsPreviewError } from '../src/preview-diagnostics.mjs';
const node = (children = [], props = {}) => ({ id: '1', type: 'View', props, children });

test('depth and total node failures report distinct codes, actual/limit and the offending path', () => {
  let deep = node();
  for (let i = 0; i < 42; i++) deep = node([deep], { testID: `wrapper-${i}` });
  assert.throws(() => validateTree([deep]), error => {
    assert.equal(error.diagnostics.code, 'DEPTH_LIMIT');
    assert.equal(error.diagnostics.limit, TREE_LIMITS.depth);
    assert.equal(error.diagnostics.actual, 41);
    assert.equal(error.diagnostics.testID, 'wrapper-0');
    assert.equal(error.diagnostics.path, '$[0]' + '.children[0]'.repeat(41));
    assert.match(error.message, /41 > 40/);
    return true;
  });
  assert.throws(() => validateTree(Array.from({ length: 1001 }, () => node())), error => {
    assert.equal(error.diagnostics.code, 'NODE_LIMIT');
    assert.equal(error.diagnostics.actual, 1001);
    assert.equal(error.diagnostics.limit, 1000);
    assert.equal(error.diagnostics.path, '$[1000]');
    return true;
  });
});

test('tree/style errors carry locations instead of unstructured native failure strings', () => {
  assert.throws(() => validateTree([node(['raw text'])]), error => error.diagnostics.code === 'TEXT_OUTSIDE_TEXT' && error.diagnostics.path === '$[0].children[0]');
  let style = { padding: 1 };
  for (let i = 0; i < 12; i++) style = [style];
  assert.throws(() => validateTree([node([], { style })]), error => error.diagnostics.code === 'STYLE_DEPTH_LIMIT' && error.diagnostics.path.startsWith('$[0].props.style'));
});

test('compile/native errors stay inspectable and screenshot-able; access invalidation is a distinct barrier', () => {
  const diagnostics = { code: 'DEPTH_LIMIT', path: '$[0].children[0]', actual: 41, limit: 40 };
  const preview = { id: 'source', status: 'error', error: 'Native tree exceeds depth limit', diagnostics };
  assert.equal(previewReadError(preview), null);
  const result = previewResult(preview, { error: null, tree: [], image: 'mock-pixels', pendingTasks: 0 });
  assert.equal(result.error, preview.error, 'a late native error:null cannot erase authoritative render failure');
  assert.equal(result.image, 'mock-pixels', 'diagnostic screenshot payload is preserved');
  assert.deepEqual(result.diagnostics, diagnostics);
  assert.equal(result.status, 'error');
  assert.equal(previewReadError({ status: 'error', phase: 'compile' }), null);
  assert.match(previewReadError({ status: 'invalidated' }), /plugin access/);
  assert.match(previewReadError({ status: 'disconnected' }), /disconnected/);
  assert.match(previewReadError(null), /No preview/);
});

test('late errors cannot resurrect an access-invalidated preview or poison a newer generation', () => {
  const report = { surface: 'preview', snapshotID: 'source', viewEpoch: 7 };
  assert.equal(acceptsPreviewError({ id: 'source', status: 'ready' }, 7, report), true);
  assert.equal(acceptsPreviewError({ id: 'source', status: 'invalidated' }, 7, report), false);
  assert.equal(acceptsPreviewError({ id: 'source', status: 'ready' }, 8, report), false);
  assert.equal(acceptsPreviewError({ id: 'other', status: 'ready' }, 7, report), false);
});

test('wait-until-settled waits for tracked tasks and a quiet commit interval', async () => {
  let time = 0, completed = false, committed = false;
  const state = { runtimeKey: 7, pendingTasks: 1, lastActivity: 0, error: null };
  const result = await settlePreview(() => state, {
    generation: 7, timeoutMs: 500, quietMs: 100, now: () => time,
    sleep: async ms => {
      time += ms;
      if (time >= 100 && !completed) { completed = true; state.pendingTasks = 0; state.lastActivity = time; }
      if (time >= 125 && !committed) { committed = true; state.lastActivity = time; }
    },
  });
  assert.equal(result.settled, true);
  assert.ok(time >= 225, 'do not return the intermediate loading commit');
});

test('settling returns explicit bounded timeout/error/replacement outcomes', async () => {
  let time = 0;
  const state = { runtimeKey: 1, pendingTasks: 2, lastActivity: 0 };
  const result = await settlePreview(() => state, { generation: 1, timeoutMs: 100, now: () => time, sleep: async ms => { time += ms; } });
  assert.deepEqual(result, { settled: false, reason: 'timeout', pendingTasks: 2 });
  assert.equal(time, 100);
  state.error = 'native failure';
  assert.equal((await settlePreview(() => state)).reason, 'render_error');
  assert.equal((await settlePreview(() => state, { generation: 2 })).reason, 'runtime_replaced');
});
