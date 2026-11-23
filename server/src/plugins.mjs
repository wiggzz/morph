import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { secureJSON, origin, httpsURL } from './plugin-network.mjs';
import { PluginPackages } from './plugin-packages.mjs';
import { validateManifest } from './plugin-manifest.mjs';
import { keyedAuth, needsClientSecret, credentialHeaders, tokenRequest, primitiveDocs, publicHeaders, exchangeTokens } from './plugin-auth.mjs';

const MAX_ARGS = 16000;
function saveJSON(filename, value) {
  fs.writeFileSync(filename + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(filename + '.tmp', filename);
}
function readJSON(filename, fallback) { return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : fallback; }
function argumentsFor(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > MAX_ARGS) throw new Error('Plugin arguments must be a JSON object under 16 KiB');
  for (const key of schema.required || []) if (!Object.hasOwn(args, key)) throw new Error('Missing argument: ' + key);
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(schema.properties, key)) throw new Error('Unknown argument: ' + key);
    const rule = schema.properties[key];
    if (rule.type === 'headers') publicHeaders(value);
    if (rule.enum && !rule.enum.includes(value)) throw new Error('Invalid value for ' + key);
    if (rule.type === 'string' && (typeof value !== 'string' || value.length > (rule.maxLength || 4000))) throw new Error('Invalid text argument: ' + key);
    if (rule.pattern && (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value))) throw new Error('Invalid identifier: ' + key);
    if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) throw new Error('Invalid number: ' + key);
  }
  return args;
}

export class PluginManager {
  constructor({ directory, dataDir, packages, callbackBase = 'http://127.0.0.1:8787', notify = () => {}, transport = secureJSON, trusted = false }) {
    this.trusted = trusted; this.notify = notify; this.transport = transport; this.callbackBase = callbackBase;
    this.catalogue = new Map(); this.oauthPending = new Map(); this.refreshes = new Map(); this.exchanges = new Map(); this.active = new Map(); this.calls = new Map();
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.statePath = path.join(dataDir, 'plugin-grants.json'); this.secretPath = path.join(dataDir, 'plugin-secrets.json');
    this.state = readJSON(this.statePath, { grants: {}, requests: {} });
    this.state.requestTimes ||= {};
    this.state.requestIDs ||= {};
    for (const id of Object.keys(this.state.requests)) this.state.requestIDs[id] ||= crypto.randomUUID();
    this.secrets = readJSON(this.secretPath, {});
    this.packages = packages || new PluginPackages({ directory, dataDir });
    this.reload();
  }
  reload() {
    this.catalogue.clear();
    for (const m of this.packages.active()) { validateManifest(m, m.id); this.catalogue.set(m.id, m); }
  }
  dependencies() {
    return Object.fromEntries([...this.catalogue.values()].filter(m => this.trusted || this.state.grants[m.id]?.hash === m.hash).map(m => [m.id, { hash: m.hash, release: m.release, files: m.files }]));
  }
  persist() { saveJSON(this.statePath, this.state); saveJSON(this.secretPath, this.secrets); }
  get(id) { const m = this.catalogue.get(id); if (!m) throw new Error('Unknown plugin'); return m; }
  grant(id) {
    const m = this.get(id); let grant = this.state.grants[id];
    if (this.trusted && (!grant || grant.hash !== m.hash)) {
      if (this.secrets[id]) throw new Error('Existing credential binding pins an older package; connect a new instance instead of silently transferring credentials');
      this.approve(id,{hash:m.hash,origins:m.network.origins || m.network.defaults,preview:true,agent:true,writes:true}); grant = this.state.grants[id];
    }
    if (!grant || grant.hash !== m.hash) throw new Error('Plugin needs user installation / approval');
    return grant;
  }
  callbackURL(id) { return `${this.callbackBase}/oauth/plugins/${encodeURIComponent(id)}/callback`; }
  list() {
    return [...this.catalogue.values()].map(m => {
      const grant = this.state.grants[m.id], secret = this.secrets[m.id] || {};
      const installed = this.trusted || grant?.hash === m.hash;
      return { ...m, files: undefined, requestId: this.state.requestIDs[m.id], requestedAt: this.state.requestTimes[m.id] || 0, installed, needsReapproval: !!grant && !installed, requested: !this.trusted && this.state.requests[m.id] === m.hash,
        grant: installed ? this.trusted ? {preview:true,agent:true,writes:true} : { preview: grant.preview, agent: grant.agent, writes: grant.writes } : null,
        origins: grant?.origins || m.network.origins || m.network.defaults,
        configured: m.auth.type === 'none' || (keyedAuth(m.auth) ? !!secret.key : !!secret.clientID && (!needsClientSecret(m.auth) || !!secret.clientSecret)),
        connected: ['oauth2', 'token-exchange'].includes(m.auth.type) ? !!secret.tokens : keyedAuth(m.auth) ? !!secret.key : installed,
        callbackURL: m.auth.type === 'oauth2' ? this.callbackURL(m.id) : undefined,
      };
    });
  }
  docs(id) {
    const p = this.list().find(m => m.id === id); if (!p) throw new Error('Unknown plugin');
    return { id, name: p.name, version: p.version, hash: p.hash, installed: p.installed, requested: p.requested, grant: p.grant, configured: p.configured, connected: p.connected, origins: p.origins, permissions: p.permissions, docs: p.docs, methods: p.methods, setup: p.auth.setup, auth: p.auth, primitives: primitiveDocs, bundledExample: this.packages.bundledExample?.(id) || null, authoringNote: 'auth/methods/docs above describe the currently active project release, not necessarily the latest bundled example. primitives describe current host support and exact configuration examples. bundledExample is the shipped example manifest, independent of user workspace/release collisions; it is reference source, NOT an installed update. Copy only the needed recipe fields while preserving your app method contract, then validate/build/publish explicitly. Existing account instances remain pinned; use a new slot for a changed credential recipe.' };
  }
  requestInstall(id) {
    const m = this.get(id);
    if (this.trusted) return 'Package is available in the trusted Morph sandbox. Use plugins.open(packageID,{slot,label,origins}) to create an account/configuration instance; only credential setup is protected.';
    if (this.state.grants[id]?.hash === m.hash) return 'Already installed. Additional access must be enabled by the user in Plugins.';
    if (this.state.requests[id] !== m.hash) { this.state.requestTimes[id] = Date.now(); this.state.requestIDs[id] = crypto.randomUUID(); }
    this.state.requests[id] = m.hash; this.persist(); this.notify();
    return 'Installation requested. A protected approval card is now in chat. The user must approve this exact package and permissions. Nothing has been installed yet. Wait for their decision, do not repeatedly request or instruct them to hunt through settings.';
  }
  decideInstall(id, hash, requestId, decision, approval = {}) {
    const plugin = this.get(id);
    if (!requestId || requestId !== this.state.requestIDs[id] || hash !== plugin.hash || this.state.requests[id] !== hash) throw new Error('Approval request expired or was already handled');
    if (decision === 'approve') this.approve(id, { ...approval, hash });
    else if (decision === 'decline') { delete this.state.requests[id]; this.persist(); this.notify(); }
    else throw new Error('Unknown approval decision');
    return { plugin: id, hash, requestId, decision, name: plugin.name, requestedAt: this.state.requestTimes[id] || Date.now(), needsSetup: plugin.auth.type !== 'none' && !this.list().find(p => p.id === id).connected };
  }
  approve(id, { hash, origins = [], preview = false, agent = false, writes = false }) {
    const m = this.get(id);
    if (hash !== m.hash) throw new Error('Plugin changed; review it again before approving');
    const allowed = [...new Set((m.network.configurable ? origins : m.network.origins).map(origin))];
    if (!allowed.length || allowed.length > 8 || (m.auth.type !== 'none' && allowed.length !== 1)) throw new Error('Approve 1–8 origins; private credentials require exactly one');
    const old = this.state.grants[id];
    if (old?.hash === hash && m.auth.type !== 'none' && old.origins.join() !== allowed.join() && (this.secrets[id]?.key || this.secrets[id]?.tokens))
      throw new Error('Remove the plugin before changing the origin of an existing credential');
    if (old && old.hash !== hash) delete this.secrets[id]; // New package code cannot inherit old credentials silently.
    this.abort(id);
    this.state.grants[id] = { hash, origins: allowed, preview: preview === true, agent: agent === true, writes: m.driver === 'http-json' && writes === true, epoch: crypto.randomUUID() };
    delete this.state.requests[id]; this.persist(); this.notify();
  }
  abort(id) {
    for (const controller of this.active.get(id) || []) controller.abort();
    for (const [state, pending] of this.oauthPending) if (pending.id === id) this.oauthPending.delete(state);
  }
  remove(id) {
    this.get(id); this.abort(id);
    delete this.state.grants[id]; delete this.state.requests[id]; delete this.secrets[id];
    this.persist(); this.notify();
  }
  configure(id, config) {
    const m = this.get(id); this.grant(id);
    const valid = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096 && !/[\r\n]/.test(value);
    this.abort(id); this.state.grants[id].epoch = crypto.randomUUID();
    if (keyedAuth(m.auth)) {
      if (!valid(config.key)) throw new Error('Enter a nonempty private credential without line breaks');
      this.secrets[id] = { key: config.key.trim() };
    } else if (m.auth.type === 'oauth2') {
      if (!valid(config.clientID) || (needsClientSecret(m.auth) && !valid(config.clientSecret))) throw new Error(needsClientSecret(m.auth) ? 'Enter the OAuth client ID and secret' : 'Enter the public OAuth client ID');
      this.secrets[id] = { clientID: config.clientID.trim(), ...(needsClientSecret(m.auth) ? { clientSecret: config.clientSecret } : {}) };
    } else throw new Error('This plugin does not need credentials');
    this.persist(); this.notify();
  }
  disconnect(id) {
    this.grant(id); this.abort(id); this.state.grants[id].epoch = crypto.randomUUID();
    if (this.get(id).auth.type === 'oauth2' && this.secrets[id]) delete this.secrets[id].tokens;
    else delete this.secrets[id];
    this.persist(); this.notify();
  }
  beginOAuth(id) {
    const m = this.get(id), grant = this.grant(id), secret = this.secrets[id];
    if (m.auth.type !== 'oauth2' || !secret?.clientID || (needsClientSecret(m.auth) && !secret?.clientSecret)) throw new Error('Configure the OAuth registration in Plugins first');
    this.abort(id);
    const state = crypto.randomBytes(32).toString('hex'), verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    for (const [key, p] of this.oauthPending) if (p.expires < Date.now()) this.oauthPending.delete(key);
    this.oauthPending.set(state, { id, verifier, epoch: grant.epoch, expires: Date.now() + 10 * 60000 });
    const url = new URL(m.auth.authorizationUrl);
    for (const [key, value] of Object.entries({ ...m.auth.authorizationParams, client_id: secret.clientID, redirect_uri: this.callbackURL(id), response_type: 'code', ...(m.auth.scopes.length ? { scope: m.auth.scopes.join(m.auth.scopeSeparator || ' ') } : {}), state, code_challenge: challenge, code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    return url.toString();
  }
  async finishOAuth(id, params) {
    const state = params.get('state'), pending = this.oauthPending.get(state);
    this.oauthPending.delete(state);
    if (!pending || pending.id !== id || pending.expires < Date.now() || this.grant(id).epoch !== pending.epoch) throw new Error('OAuth request expired or did not match. Start Connect again.');
    if (params.has('error') || !params.get('code')) throw new Error('Authorization was denied or not completed');
    const m = this.get(id), secret = this.secrets[id];
    const controller = this.track(id);
    try {
      const tokens = await this.transport(m.auth.tokenUrl, { ...tokenRequest(m.auth, secret, { grant_type: 'authorization_code', code: params.get('code'), code_verifier: pending.verifier, redirect_uri: this.callbackURL(id) }), signal: controller.signal });
      if (this.grant(id).epoch !== pending.epoch || this.secrets[id] !== secret) throw new Error('Plugin access changed during login');
      this.storeTokens(id, tokens); this.persist(); this.notify();
    } catch { throw new Error('OAuth exchange failed. Check the registration/callback and reconnect.'); }
    finally { this.untrack(id, controller); }
  }
  storeTokens(id, tokens) {
    if (typeof tokens?.access_token !== 'string' || !tokens.access_token || (tokens.refresh_token !== undefined && typeof tokens.refresh_token !== 'string')) throw new Error('OAuth response missing token fields');
    if (tokens.token_type && String(tokens.token_type).toLowerCase() !== 'bearer') throw new Error('Only OAuth Bearer access tokens are supported');
    const m = this.get(id);
    if (tokens.scope !== undefined && (typeof tokens.scope !== 'string' || !m.auth.scopes.every(scope => tokens.scope.split(m.auth.scopeSeparator || ' ').includes(scope)))) throw new Error('Required OAuth scopes were not granted');
    let expires = null;
    if (tokens.expires_in !== undefined) {
      const seconds = typeof tokens.expires_in === 'number' ? tokens.expires_in : typeof tokens.expires_in === 'string' && /^\d+$/.test(tokens.expires_in) ? Number(tokens.expires_in) : NaN;
      expires = Date.now() + seconds * 1000;
      if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(Math.ceil(expires))) throw new Error('Invalid OAuth token lifetime');
    }
    this.secrets[id].tokens = { access: tokens.access_token, refresh: tokens.refresh_token || this.secrets[id].tokens?.refresh, expires };
  }
  async exchange(id) {
    const m = this.get(id), grant = this.grant(id), secret = this.secrets[id];
    if (m.auth.type !== 'token-exchange' || !secret?.key) throw new Error('Save the exchange key in protected account setup first');
    const pending = this.exchanges.get(id);
    if (pending?.epoch === grant.epoch) return pending.promise;
    const epoch = grant.epoch, controller = this.track(id), entry = { epoch };
    const promise = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const e = m.auth.exchange;
        const response = await this.transport(e.url, { method: 'POST', headers: { Accept: e.response.format === 'text' ? '*/*' : 'application/json', ...credentialHeaders({ type: 'api-key', header: e.header, prefix: e.prefix }, secret.key) }, responseType: e.response.format, signal: controller.signal });
        controller.signal.throwIfAborted();
        if (this.state.grants[id]?.epoch !== epoch || this.secrets[id] !== secret) throw new Error('Credential binding changed');
        const tokens = exchangeTokens(m.auth, response);
        if (tokens.access === secret.key) throw new Error('Exchange must return a derived token, not the source credential');
        secret.tokens = tokens;
        this.persist(); this.notify();
        return secret.tokens.access;
      } catch { throw new Error('Token exchange failed or cancelled. Check the key and declared endpoint in protected account setup.'); }
      finally { this.untrack(id, controller); if (this.exchanges.get(id) === entry) this.exchanges.delete(id); }
    });
    entry.promise = promise; this.exchanges.set(id, entry);
    return promise;
  }
  track(id) {
    const controller = new AbortController();
    if (!this.active.has(id)) this.active.set(id, new Set());
    this.active.get(id).add(controller); return controller;
  }
  untrack(id, controller) { this.active.get(id)?.delete(controller); }
  async credential(id) {
    const m = this.get(id), secret = this.secrets[id];
    if (m.auth.type === 'none') return undefined;
    if (m.auth.type === 'token-exchange') {
      if (!secret?.tokens) throw new Error('Connect the exchange account in protected setup first');
      if (secret.tokens.expires > Date.now() + 60000) return secret.tokens.access;
      return this.exchange(id);
    }
    if (keyedAuth(m.auth)) { if (!secret?.key) throw new Error('User must enter the private credential in Plugins'); return secret.key; }
    if (!secret?.tokens) throw new Error('Connect your account in Plugins first');
    if (secret.tokens.expires === null || secret.tokens.expires > Date.now() + 60000) return secret.tokens.access;
    if (!secret.tokens.refresh) throw new Error('Account session expired; reconnect in Plugins');
    if (!this.refreshes.has(id)) {
      const epoch = this.grant(id).epoch;
      const controller = this.track(id);
      const refresh = (async () => {
        try {
          const tokens = await this.transport(m.auth.tokenUrl, { ...tokenRequest(m.auth, secret, { grant_type: 'refresh_token', refresh_token: secret.tokens.refresh }), signal: controller.signal });
          if (this.grant(id).epoch !== epoch || this.secrets[id] !== secret) throw new Error('Plugin permissions changed');
          this.storeTokens(id, tokens); this.persist();
        } catch { throw new Error('Account refresh failed; reconnect in Plugins'); }
        finally { this.untrack(id, controller); this.refreshes.delete(id); }
      })();
      this.refreshes.set(id, refresh);
    }
    await this.refreshes.get(id); return this.secrets[id].tokens.access;
  }
  redact(id, value, used = []) {
    const s = this.secrets[id] || {};
    let serialized = JSON.stringify(value);
    for (const secret of [s.key, s.clientSecret, s.tokens?.access, s.tokens?.refresh, ...used].filter(Boolean)) {
      const escaped = JSON.stringify(secret).slice(1, -1);
      serialized = serialized.split(escaped).join('[credential redacted]');
      if (Buffer.byteLength(serialized) > 256 * 1024) throw new Error('Plugin response exceeds output limit');
    }
    if (Buffer.byteLength(serialized) > 256 * 1024) throw new Error('Plugin response exceeds output limit');
    return JSON.parse(serialized);
  }
  async call(id, methodName, input = {}, { surface, signal, expectedHash } = {}) {
    const m = this.get(id), grant = this.grant(id), method = m.methods[methodName];
    if (expectedHash && expectedHash !== m.hash) throw new Error('This app pins a different plugin release. Review plugin versions/permissions, then render again.');
    if (!['live', 'preview', 'agent'].includes(surface)) throw new Error('Unknown plugin caller');
    if (!this.trusted && surface !== 'live' && !grant[surface]) throw new Error(`${surface} access is not approved. Ask the user to enable it in Plugins.`);
    if (!method || !Object.hasOwn(m.methods, methodName)) throw new Error('Unknown plugin method');
    const args = argumentsFor(method.input, input);
    const count = (this.calls.get(id) || []).filter(at => at > Date.now() - 60000);
    if (count.length >= 30 || (this.active.get(id)?.size || 0) >= 4) throw new Error('Plugin rate limit; try again later');
    count.push(Date.now()); this.calls.set(id, count);
    let url, verb, body, headers;
    if (m.driver === 'http-json') {
      url = httpsURL(args.url); verb = args.method || 'GET';
      headers = publicHeaders(args.headers, m.auth);
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) throw new Error('Unsupported HTTP method');
      if (!this.trusted && verb !== 'GET' && !grant.writes) throw new Error('Write requests require separate user approval');
      if (verb === 'GET' && args.body !== undefined) throw new Error('GET requests do not accept a body');
      if (args.body !== undefined) body = JSON.stringify(args.body);
    } else {
      headers = publicHeaders(method.request.headers, m.auth);
      const params = { ...method.request.defaults, ...args };
      const pathname = method.request.path.replace(/\{(\w+)\}/g, (_match, key) => encodeURIComponent(params[key]));
      url = new URL(pathname, grant.origins[0]); verb = 'GET';
      for (const [queryKey, param] of Object.entries(method.request.query || {})) if (params[param] !== undefined) url.searchParams.set(queryKey, String(params[param]));
    }
    if (!grant.origins.includes(url.origin)) throw new Error('Origin not approved for this plugin: ' + url.origin);
    if (m.auth.type === 'token-exchange') {
      const endpoint = new URL(m.auth.exchange.url);
      const normalize = p => decodeURIComponent(p).replace(/\/+$/g, '') || '/';
      if (url.origin === endpoint.origin && normalize(url.pathname) === normalize(endpoint.pathname)) throw new Error('Token endpoint is reserved for the protected host exchange');
    }
    let key;
    const controller = this.track(id);
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      controller.signal.throwIfAborted();
      key = await this.credential(id);
      controller.signal.throwIfAborted();
      if (this.state.grants[id]?.epoch !== grant.epoch) throw new Error('Plugin access changed');
      const result = await this.transport(url.toString(), { method: verb, body, signal: controller.signal, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers, ...credentialHeaders(m.auth, key) } });
      controller.signal.throwIfAborted();
      if (this.state.grants[id]?.epoch !== grant.epoch) throw new Error('Plugin access changed');
      return this.redact(id, result, [key]);
    } catch (e) {
      throw new Error(this.redact(id, String(e.message || 'Plugin request failed'), [key]));
    } finally { signal?.removeEventListener('abort', abort); this.untrack(id, controller); }
  }
  close() { for (const id of this.catalogue.keys()) this.abort(id); }
}
