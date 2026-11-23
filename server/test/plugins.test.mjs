import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginManager } from '../src/plugins.mjs';
import { RuntimeCapabilities } from '../src/runtime-capabilities.mjs';
import { Workspace } from '../src/workspace.mjs';
import { bundle } from '../src/bundle.mjs';
import { httpsURL, origin, publicAddress, secureJSON } from '../src/plugin-network.mjs';
const directory = fileURLToPath(new URL('../../plugins/', import.meta.url));
function setup(t, transport = async () => ({ ok: true })) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-plugins-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const manager = new PluginManager({ directory, dataDir, transport });
  t.after(() => manager.close());
  return { manager, dataDir };
}
function approve(manager, id, extra = {}) {
  const p = manager.get(id);
  manager.approve(id, { hash: p.hash, origins: p.network.origins || p.network.defaults, ...extra });
}

test('installation requests never grant access; Preview and agent permissions default off', async t => {
  const { manager } = setup(t);
  assert.deepEqual(manager.list().map(p => p.id).sort(), ['bearer-http', 'garmin-personal', 'gmail', 'public-http']);
  assert.match(manager.requestInstall('public-http'), /Nothing has been installed/);
  await assert.rejects(manager.call('public-http', 'request', { url: 'https://api.open-meteo.com/' }, { surface: 'live' }), /approval/);
  assert.throws(() => manager.approve('public-http', { hash: 'stale', origins: ['https://example.com'] }), /changed/);
  approve(manager, 'public-http');
  assert.deepEqual(await manager.call('public-http', 'request', { url: 'https://api.open-meteo.com/' }, { surface: 'live' }), { ok: true });
  for (const surface of ['preview', 'agent']) await assert.rejects(manager.call('public-http', 'request', { url: 'https://api.open-meteo.com/' }, { surface }), /not approved/);
  await assert.rejects(manager.call('public-http', 'request', { url: 'https://evil.example/' }, { surface: 'live' }), /Origin not approved/);
  await assert.rejects(manager.call('public-http', 'request', { url: 'https://api.open-meteo.com/', method: 'POST', body: { text: 'x' } }, { surface: 'live' }), /Write requests/);
  await assert.rejects(manager.call('public-http', 'request', { url: 'https://api.open-meteo.com/', headers: { Authorization: 'anything' } }, { surface: 'live' }), /Unknown argument/);
  approve(manager, 'public-http', { preview: true, agent: true, writes: true });
  assert.deepEqual(await manager.call('public-http', 'request', { url: 'https://api.open-meteo.com/', method: 'POST', body: {} }, { surface: 'agent' }), { ok: true });
});

test('Bearers are origin-bound, private, redacted, and removed locally on uninstall', async t => {
  const requests = [], key = 'secret-example-key-123456789';
  const { manager, dataDir } = setup(t, async (url, options) => { requests.push({ url, options }); return { echo: options.headers.Authorization, name: 'Ada' }; });
  approve(manager, 'bearer-http');
  manager.configure('bearer-http', { key });
  const result = await manager.call('bearer-http', 'request', { url: 'https://api.github.com/user' }, { surface: 'live' });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer ' + key);
  assert.equal(result.echo, 'Bearer [credential redacted]');
  assert.equal(JSON.stringify(manager.list()).includes(key), false);
  assert.equal(JSON.stringify(manager.docs('bearer-http')).includes(key), false);
  assert.equal(JSON.stringify(manager.dependencies()).includes(key), false);
  assert.throws(() => approve(manager, 'bearer-http', { origins: ['https://other.example'] }), /Remove/);
  assert.throws(() => approve(manager, 'bearer-http', { origins: ['https://api.github.com', 'https://other.example'] }), /exactly one/);
  assert.equal(fs.statSync(path.join(dataDir, 'plugin-secrets.json')).mode & 0o777, 0o600);
  manager.remove('bearer-http');
  assert.equal(fs.readFileSync(path.join(dataDir, 'plugin-secrets.json'), 'utf8').includes(key), false);
  await assert.rejects(manager.call('bearer-http', 'request', { url: 'https://api.github.com/user' }, { surface: 'live' }), /approval/);
});

test('runtime capabilities bind surface, pinned package hash and generation; replacement cancels in-flight requests', async t => {
  let release;
  const { manager } = setup(t, async (_url, options) => new Promise((resolve, reject) => {
    release = resolve;
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  approve(manager, 'public-http');
  const capabilities = new RuntimeCapabilities(manager);
  const snapshot = { dependencies: manager.dependencies() };
  const preview = capabilities.issue('preview', snapshot);
  await assert.rejects(capabilities.call(preview, { plugin: 'public-http', method: 'request', args: { url: 'https://api.open-meteo.com/' }, surface: 'live' }), /preview access/);
  const live = capabilities.issue('live', snapshot);
  const request = capabilities.call(live, { plugin: 'public-http', method: 'request', args: { url: 'https://api.open-meteo.com/' } });
  await new Promise(resolve => setTimeout(resolve, 10));
  capabilities.issue('live', snapshot);
  await assert.rejects(request, /aborted/);
  await assert.rejects(capabilities.call(live, { plugin: 'public-http', method: 'request', args: {} }), /replaced/);
  assert.ok(release);
  capabilities.clear();
});

test('OAuth uses state + PKCE, persists only backend tokens, refreshes once, and Gmail remains read-only', async t => {
  const requests = [];
  const { manager } = setup(t, async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/token')) return { access_token: 'access-private-token-123456', refresh_token: 'refresh-private-token-123456', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' };
    return { messages: [{ id: 'abc123' }] };
  });
  approve(manager, 'gmail', { preview: true });
  manager.configure('gmail', { clientID: 'example-google-client-id', clientSecret: 'example-google-client-secret' });
  const auth = new URL(manager.beginOAuth('gmail'));
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.match(auth.searchParams.get('redirect_uri'), /127\.0\.0\.1:8787\/oauth\/plugins\/gmail\/callback/);
  assert.equal(auth.searchParams.has('client_secret'), false);
  await assert.rejects(manager.finishOAuth('gmail', new URLSearchParams({ state: 'wrong', code: 'code' })), /expired/);
  const params = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'authorization-code' });
  await manager.finishOAuth('gmail', params);
  await assert.rejects(manager.finishOAuth('gmail', params), /expired/);
  const exchange = new URLSearchParams(requests[0].options.body);
  assert.ok(exchange.get('code_verifier'));
  assert.equal(exchange.get('client_secret'), 'example-google-client-secret');
  const result = await manager.call('gmail', 'listMessages', { q: 'in:inbox', maxResults: 10 }, { surface: 'preview' });
  assert.deepEqual(result, { messages: [{ id: 'abc123' }] });
  assert.match(requests[1].url, /maxResults=10/);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer access-private-token-123456');
  assert.equal(JSON.stringify(manager.list()).includes('private-token'), false);
  await assert.rejects(manager.call('gmail', 'sendMessage', {}, { surface: 'live' }), /Unknown plugin method/);
  await assert.rejects(manager.call('gmail', 'getMessage', { id: '../secret' }, { surface: 'live' }), /identifier/);
  manager.secrets.gmail.tokens.expires = 0;
  const [a, b] = await Promise.all([manager.call('gmail', 'getProfile', {}, { surface: 'live' }), manager.call('gmail', 'getProfile', {}, { surface: 'live' })]);
  assert.deepEqual(a, b);
  assert.equal(requests.filter(r => r.url.includes('/token')).length, 2, 'one initial exchange + one concurrent refresh');
  manager.disconnect('gmail');
  await assert.rejects(manager.call('gmail', 'getProfile', {}, { surface: 'live' }), /Connect your account/);
});

test('plugin authoring creates immutable numbered releases; source clients compile and old versions need approval', async t => {
  const { manager, dataDir } = setup(t);
  const packages = manager.packages;
  packages.create('my-service');
  packages.write('my-service', '/index.ts', `import {plugins} from '@morph/plugins'; export const profile = () => plugins.call('my-service','request',{url:'https://example.com/profile'});`);
  const first = packages.validate('my-service');
  assert.equal(manager.list().some(p => p.id === 'my-service'), false, 'drafts are not installed packages');
  packages.requestPublish('my-service');
  assert.ok(packages.get('my-service').requested);
  packages.publish('my-service', first.id, 'First API'); manager.reload();
  approve(manager, 'my-service');
  const dependencies = manager.dependencies();
  const app = { files: { '/App.tsx': `import React from 'react'; import {profile} from '@plugins/my-service'; export default () => React.createElement('Text',null,String(profile));` }, dependencies };
  assert.ok((await bundle(app)).length);
  packages.edit('my-service', '/index.ts', '/profile', '/account');
  const second = packages.validate('my-service');
  assert.throws(() => packages.publish('my-service', first.id), /changed/);
  packages.publish('my-service', second.id, 'New endpoint'); manager.reload();
  assert.equal(manager.list().find(p => p.id === 'my-service').needsReapproval, true);
  await assert.rejects(manager.call('my-service', 'request', { url: 'https://example.com/' }, { surface: 'live' }), /approval/);
  assert.equal(packages.get('my-service').releases.read(1).files['/index.ts'], first.files['/index.ts']);
  packages.activate('my-service', 1); manager.reload();
  assert.equal(packages.get('my-service').releases.index.active, 1);
  assert.equal(packages.read('my-service', '/index.ts'), second.files['/index.ts'], 'switching versions preserves draft');
  const reloaded = new PluginManager({ directory, dataDir, transport: async () => ({}) });
  assert.equal(reloaded.get('my-service').hash, first.id);
  assert.equal(reloaded.packages.get('my-service').releases.list().entries.length, 2);
});

test('app promotions have independent version numbers, all history survives restart and rollbacks never rewrite releases', t => {
  const { dataDir } = setup(t);
  const w = new Workspace(dataDir);
  const first = w.snapshot(); w.promote(first, 'First');
  w.write('/extra.ts', 'export const x = 1'); w.promote(w.snapshot(), 'Second');
  w.promote(w.snapshot(), 'Same source, new promotion');
  assert.deepEqual(w.releases.list().entries.map(v => v.version), [1, 2, 3]);
  const before = fs.readFileSync(w.releases.filename(1), 'utf8');
  w.activate(1); assert.equal(w.state.live.version, 1);
  assert.equal(w.read('/extra.ts'), 'export const x = 1');
  w.promote(w.snapshot(), 'Fourth'); assert.equal(w.state.live.version, 4);
  w.activate(2);
  assert.equal(fs.readFileSync(w.releases.filename(1), 'utf8'), before);
  const reloaded = new Workspace(dataDir);
  assert.equal(reloaded.state.live.version, 2);
  assert.equal(reloaded.releases.list().entries.length, 4);
  assert.throws(() => w.activate(-1), /not found/);
  w.restoreDraft(1); assert.equal(w.list().includes('/extra.ts'), false);
  assert.equal(w.state.live.version, 2, 'restoring a draft never deploys');
});

test('network boundary blocks local/reserved IPs, non-HTTPS, credentials, redirects and unsafe origins', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('1.1.1.1'), true);
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com:8787', 'file:///etc/passwd', 'https://example.com/#secret']) assert.throws(() => httpsURL(url));
  assert.throws(() => origin('https://example.com/path'));
  await assert.rejects(secureJSON('https://127.0.0.1/'), /Private/);
  await assert.rejects(secureJSON('https://[::1]/'), /Private/);
});
