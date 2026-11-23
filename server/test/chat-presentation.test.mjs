import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatTranscript, activityLabel } from '../src/chat-presentation.mjs';
import { PluginManager } from '../src/plugins.mjs';

function manager(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-chat-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const m = new PluginManager({ directory: fileURLToPath(new URL('../../plugins/', import.meta.url)), dataDir, transport: async () => ({}) });
  t.after(() => m.close()); return m;
}

test('human chat excludes tool data, thinking, internal narration and empty messages without changing model history', () => {
  const history = [
    { role: 'system', content: 'internal', timestamp: 1 },
    { role: 'user', content: 'Build something', timestamp: 2 },
    { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'I will read every file…' }, { type: 'toolCall', name: 'read', arguments: { path: '/secret' } }], timestamp: 3 },
    { role: 'toolResult', content: [{ type: 'text', text: '{"private":"raw API data"}' }, { type: 'image', data: 'raw-pixels' }], timestamp: 4 },
    { role: 'assistant', stopReason: 'stop', content: [{ type: 'thinking', thinking: 'internal reasoning' }, { type: 'text', text: 'Ready to preview.' }], timestamp: 5 },
    { role: 'assistant', content: [], timestamp: 6 },
  ];
  const original = JSON.stringify(history);
  assert.deepEqual(chatTranscript(history), [
    { role: 'user', text: 'Build something', timestamp: 2 },
    { role: 'assistant', text: 'Ready to preview.', timestamp: 5 },
  ]);
  assert.equal(JSON.stringify(history), original, 'UI filtering never removes the model/tool session history');
  assert.equal(chatTranscript(Array.from({ length: 150 }, (_, i) => ({ role: 'user', content: String(i) }))).length, 100);
});

test('tool activity is a single human-readable label, never tool arguments/results', () => {
  assert.equal(activityLabel('write'), 'Updating the app');
  assert.equal(activityLabel('plugin_install'), 'Preparing an approval request');
  assert.equal(activityLabel('screenshot'), 'Looking at the preview');
  assert.equal(activityLabel('unknown-secret-argument'), 'Working on your request');
});

test('inline decisions are hash- and request-bound, support decline, and cannot be replayed', t => {
  const m = manager(t);
  m.requestInstall('public-http');
  const first = m.list().find(p => p.id === 'public-http');
  assert.ok(first.requestId && first.requestedAt > 0);
  assert.throws(() => m.decideInstall(first.id, first.hash, 'forged-id', 'approve', {}), /expired/);
  const declined = m.decideInstall(first.id, first.hash, first.requestId, 'decline');
  assert.equal(declined.decision, 'decline');
  assert.equal(m.list().find(p => p.id === first.id).installed, false);
  assert.equal(m.list().find(p => p.id === first.id).requested, false);
  m.requestInstall(first.id);
  const second = m.list().find(p => p.id === first.id);
  assert.notEqual(second.requestId, first.requestId, 'new request gets a new nonce even for identical package code');
  assert.throws(() => m.decideInstall(first.id, first.hash, first.requestId, 'approve', {}), /expired/);
  const approved = m.decideInstall(second.id, second.hash, second.requestId, 'approve', { origins: ['https://api.open-meteo.com'], preview: true, agent: false, writes: false });
  assert.equal(approved.needsSetup, false);
  const installed = m.list().find(p => p.id === first.id);
  assert.equal(installed.installed, true);
  assert.deepEqual(installed.grant, { preview: true, agent: false, writes: false });
  assert.throws(() => m.decideInstall(second.id, second.hash, second.requestId, 'approve', {}), /expired/);
});

test('inline account-plugin approval never invents credentials or account authorization', t => {
  const m = manager(t);
  m.requestInstall('gmail');
  const plugin = m.list().find(p => p.id === 'gmail');
  const result = m.decideInstall(plugin.id, plugin.hash, plugin.requestId, 'approve');
  assert.equal(result.needsSetup, true);
  assert.equal(m.list().find(p => p.id === 'gmail').configured, false);
  assert.equal(m.secrets.gmail, undefined);
});
