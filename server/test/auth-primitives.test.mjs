import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginManager } from '../src/plugins.mjs';
import { validateAuth, publicHeaders, tokenRequest } from '../src/plugin-auth.mjs';
const directory = fileURLToPath(new URL('../../plugins/', import.meta.url));
function setup(t, transport) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-primitives-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const manager = new PluginManager({ directory, dataDir, transport });
  t.after(() => manager.close()); return manager;
}
function install(manager, id, auth) {
  const p = manager.packages;
  p.create(id);
  const manifest = JSON.parse(p.read(id, '/manifest.json'));
  manifest.auth = auth;
  manifest.network = { origins: ['https://api.example.com'] };
  p.write(id, '/manifest.json', JSON.stringify(manifest));
  p.publish(id, p.validate(id).id, 'Generic protocol test'); manager.reload();
  manager.approve(id, { hash: manager.get(id).hash });
}
const oauth = (clientAuth, extra = {}) => ({ type: 'oauth2', authorizationUrl: 'https://identity.example.com/authorize', tokenUrl: 'https://identity.example.com/token', scopes: ['read'], clientAuth, ...extra });

test('private header credentials and public metadata compose without exposing or overriding the secret', async t => {
  const requests = [];
  const manager = setup(t, async (url, options) => { requests.push({ url, options }); return { echo: options.headers['X-Service-Key'], ok: true }; });
  install(manager, 'header-service', { type: 'api-key', header: 'X-Service-Key', prefix: 'Token ' });
  manager.configure('header-service', { key: 'private-header-secret' });
  const result = await manager.call('header-service', 'request', { url: 'https://api.example.com/data', headers: { 'X-Api-Version': '2026-01', Accept: 'application/vnd.example+json' } }, { surface: 'live' });
  assert.equal(requests[0].options.headers['X-Service-Key'], 'Token private-header-secret');
  assert.equal(requests[0].options.headers['x-api-version'], '2026-01');
  assert.equal(result.echo, 'Token [credential redacted]');
  for (const name of ['x-service-key', 'Authorization', 'Cookie', 'Host', 'Content-Length', 'X-Forwarded-For', 'Proxy-Authorization', 'Sec-Fetch-Site']) {
    await assert.rejects(manager.call('header-service', 'request', { url: 'https://api.example.com/data', headers: { [name]: 'override' } }, { surface: 'live' }), /header/);
  }
  assert.equal(requests.length, 1, 'rejected headers never reach transport');
  assert.throws(() => manager.configure('header-service', { key: 'a\r\nb' }), /credential/);
  assert.equal(JSON.stringify(manager.docs('header-service')).includes('private-header-secret'), false);
  assert.equal(manager.list().find(p => p.id === 'header-service').configured, true);
});

test('OAuth Basic client auth and provider parameters are shared primitives for exchange and refresh', async t => {
  const requests = [];
  const manager = setup(t, async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/token')) return { access_token: 'private-basic-access', refresh_token: 'private-basic-refresh', expires_in: '3600', scope: 'read,write', token_type: 'Bearer' };
    return { value: 42 };
  });
  const auth = oauth('client_secret_basic', { scopes: ['read', 'write'], scopeSeparator: ',', authorizationParams: { login_hint: 'user@example.com', resource: 'example-api' }, tokenParams: { resource: 'example-api' } });
  install(manager, 'basic-service', auth);
  manager.configure('basic-service', { clientID: 'client:id+name', clientSecret: 'a:b c+%&=' });
  const login = new URL(manager.beginOAuth('basic-service'));
  assert.equal(login.searchParams.get('scope'), 'read,write');
  assert.equal(login.searchParams.get('login_hint'), 'user@example.com');
  assert.equal(login.searchParams.has('client_secret'), false);
  await manager.finishOAuth('basic-service', new URLSearchParams({ state: login.searchParams.get('state'), code: 'one-use-code' }));
  const exchange = requests[0].options;
  const encoded = Buffer.from(exchange.headers.Authorization.slice('Basic '.length), 'base64').toString('utf8').split(':');
  assert.equal(new URLSearchParams('v=' + encoded[0]).get('v'), 'client:id+name');
  assert.equal(new URLSearchParams('v=' + encoded[1]).get('v'), 'a:b c+%&=');
  const body = new URLSearchParams(exchange.body);
  assert.equal(body.get('resource'), 'example-api');
  assert.ok(body.get('code_verifier'));
  assert.equal(body.has('client_secret'), false);
  assert.equal(body.has('client_id'), false);
  assert.equal(typeof manager.secrets['basic-service'].tokens.expires, 'number');
  manager.secrets['basic-service'].tokens.expires = 0;
  await manager.call('basic-service', 'request', { url: 'https://api.example.com/data' }, { surface: 'live' });
  const refresh = requests[1].options;
  assert.equal(refresh.headers.Authorization, exchange.headers.Authorization);
  assert.equal(new URLSearchParams(refresh.body).get('grant_type'), 'refresh_token');
  assert.equal(new URLSearchParams(refresh.body).get('resource'), 'example-api');
  assert.equal(JSON.stringify(manager.list()).includes('private-basic'), false);
});

test('public OAuth clients use PKCE without a client secret; omitted expiry and optional scopes work', async t => {
  const requests = [];
  const manager = setup(t, async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/token')) return { access_token: 'opaque-public-client-access', token_type: 'bearer' };
    return { ok: true };
  });
  install(manager, 'public-client', oauth('none', { scopes: [] }));
  manager.configure('public-client', { clientID: 'abc', clientSecret: 'must-not-be-stored' });
  assert.equal(manager.secrets['public-client'].clientSecret, undefined);
  assert.equal(manager.list().find(p => p.id === 'public-client').configured, true);
  const login = new URL(manager.beginOAuth('public-client'));
  assert.equal(login.searchParams.has('scope'), false);
  assert.equal(login.searchParams.get('code_challenge_method'), 'S256');
  await manager.finishOAuth('public-client', new URLSearchParams({ state: login.searchParams.get('state'), code: 'code' }));
  const request = requests[0].options, body = new URLSearchParams(request.body);
  assert.equal(body.get('client_id'), 'abc');
  assert.equal(body.has('client_secret'), false);
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(manager.secrets['public-client'].tokens.expires, null);
  await manager.call('public-client', 'request', { url: 'https://api.example.com/data' }, { surface: 'live' });
  assert.equal(requests.length, 2, 'unknown/non-expiring lifetime does not invent refresh behavior');
});

test('protocol configuration cannot override broker security fields or inject protocol/credential headers', () => {
  for (const field of ['authorizationParams', 'tokenParams']) {
    for (const key of ['state', 'client_id', 'client_secret', 'code_verifier', 'grant_type', 'redirect_uri', 'refresh_token', 'client_assertion']) {
      assert.throws(() => validateAuth(oauth('none', { [field]: { [key]: 'override' } })), /reserved/);
    }
  }
  for (const name of ['Host', 'Cookie', 'Content-Length', 'Proxy-Authorization', 'Sec-Foo', 'Origin']) assert.throws(() => validateAuth({ type: 'api-key', header: name }), /Unsafe/);
  assert.throws(() => validateAuth({ type: 'api-key', header: 'X-Key', prefix: 'bad\r\n' }), /prefix/);
  assert.throws(() => publicHeaders({ 'X-Version': 'bad\r\nInjected: yes' }), /header/);
  assert.throws(() => publicHeaders({ Accept: 'a', accept: 'b' }), /header/);
  assert.throws(() => validateAuth(oauth('unknown-mode')), /authentication/);
  const post = tokenRequest(oauth('client_secret_post'), { clientID: 'id', clientSecret: 'secret' }, { grant_type: 'refresh_token', refresh_token: 'refresh' });
  assert.equal(new URLSearchParams(post.body).get('client_secret'), 'secret');
  assert.equal(post.headers.Authorization, undefined);
});
