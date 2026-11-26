// Provider-neutral credential placement and OAuth 2 client authentication.
import {httpsURL,origin} from './plugin-network.mjs';
export function browserCallback(auth,value){
  if(!auth.browser||typeof value!=='string'||value.length>16000)throw new Error('No protected browser flow');
  let url;try{url=new URL(value);}catch{throw new Error('Invalid authorization callback');}
  const expected=new URL(auth.browser.redirectUri);
  if(url.origin!==expected.origin||url.pathname!==expected.pathname||url.username||url.password||url.hash)throw new Error('Authorization callback does not match the pinned URI');
  if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length>1||url.searchParams.getAll('error').length>1)throw new Error('Invalid authorization callback parameters');
  return url.searchParams;
}
const forbiddenHeaders = new Set(['host', 'cookie', 'set-cookie', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'content-type', 'origin', 'referer', 'expect']);
const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
export const keyedAuth = auth => ['bearer', 'api-key', 'token-exchange'].includes(auth.type);
export const clientAuth = auth => auth.clientAuth === undefined ? 'client_secret_post' : auth.clientAuth;
export const needsClientSecret = auth => auth.type === 'oauth2' && clientAuth(auth) !== 'none';
export const primitiveDocs = {
  credentials: [
    { type: 'none' },
    { type: 'bearer', note: 'Shorthand for a private Authorization header with prefix "Bearer ".' },
    { type: 'api-key', header: 'X-Api-Key', prefix: '', note: 'Private credential placed in one declared HTTP header; bound to one approved origin.' },
    { type: 'token-exchange', example: { type: 'token-exchange', exchange: { url: 'https://auth.example.com/token', header: 'Authorization', prefix: 'ApiKey ', response: { format: 'text', expiry: 'jwt-exp' }, maxTTLSeconds: 86400 } }, note: 'Use exactly auth.exchange:{url,header,prefix?,response,maxTTLSeconds?}. Fixed private-header POST, no request body or URL query. response is {format:"text",expiry:"jwt-exp"}, or {format:"json",expiry:"expires-in",tokenField:"access_token",expiresInField:"expires_in"}; JSON also supports expiry:"jwt-exp". JSON field mappings are own top-level names, not paths. Cache lifetime 1–86400 seconds. Protected setup saves the key and connects; tokens never return to apps/chat. Publishing does not migrate existing instances: open a NEW slot to use the new release; old slots remain pinned.' },
    { type: 'oauth2', clientAuth: ['client_secret_post', 'client_secret_basic', 'none'], note: 'Authorization code + PKCE; public clients use none. Requires provider app registration. Opaque access tokens are used as Bearer tokens; not OpenID identity verification.' },
  ],
  httpHeaders: 'Declare headers:{type:"headers"} in the request input schema to accept bounded public request metadata, e.g. API-version/Accept headers. Authorization, cookies, connection/routing headers and the declared private credential header cannot be supplied/overridden. REST recipes may declare static request.headers. Bodies remain JSON.',
  oauthBrowser: {example:{publicClientID:'provider-public-client',browser:{redirectUri:'https://provider.example/callback',origins:['https://login.provider.example']}},note:'Optional oauth2 protected browser sign-in. Fixed HTTPS callback intercepted by native host, authorization-origin allowlist, incognito cookies/MFA in provider pages, PKCE/state and token exchange/rotation in host. Public client IDs are public recipe metadata, only with clientAuth:none. No password scraping, cookies, tokens or callbacks in plugin JS. Provider may prohibit embedded browsers or shared clients; real login must be verified.'},
  oauthParameters: 'authorizationParams and tokenParams accept bounded string values, e.g. audience/resource/login_hint. Broker-owned security fields cannot be overridden. scopeSeparator may be a space (default) or comma. Scopes may be empty if the provider allows that. Token responses must be JSON; expires_in may be omitted for non-expiring tokens. Missing/expired/revoked tokens may require reconnecting.',
};

export function validateAuth(auth) {
  if (!['none', 'bearer', 'api-key', 'oauth2', 'token-exchange'].includes(auth?.type)) throw new Error('Unsupported credential primitive');
  if(auth.type!=='oauth2'&&(auth.browser!==undefined||auth.publicClientID!==undefined))throw new Error('Browser/public client configuration belongs to oauth2');
  if (auth.type === 'api-key') {
    if (typeof auth.header !== 'string' || !headerName.test(auth.header) || forbiddenHeaders.has(auth.header.toLowerCase()) || /^(proxy-|sec-|x-forwarded-)/i.test(auth.header)) throw new Error('Unsafe private credential header');
    if (auth.prefix !== undefined && (typeof auth.prefix !== 'string' || auth.prefix.length > 64 || /[^\x20-\x7e]/.test(auth.prefix))) throw new Error('Credential prefix must be short printable ASCII');
  }
  if (auth.type === 'token-exchange') {
    const e = auth.exchange;
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k => !['url', 'header', 'prefix', 'response', 'maxTTLSeconds'].includes(k))) throw new Error('token-exchange requires auth.exchange:{url,header,prefix?,response:{format,expiry,tokenField?,expiresInField?},maxTTLSeconds?}; no extra exchange fields');
    validateAuth({ type: 'api-key', header: e.header, prefix: e.prefix });
    const url = new URL(e.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443')) throw new Error('Exchange endpoint must be fixed HTTPS without query parameters');
    const r = e.response;
    if (!r || Object.keys(r).some(k => !['format', 'expiry', 'tokenField', 'expiresInField'].includes(k)) || !['text', 'json'].includes(r.format) || !['jwt-exp', 'expires-in'].includes(r.expiry) || (r.format === 'text' && r.expiry !== 'jwt-exp')) throw new Error('Declare text/JWT or mapped JSON token response and expiry');
    for (const key of ['tokenField', 'expiresInField']) if (r[key] !== undefined && (typeof r[key] !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(r[key]) || ['constructor', 'prototype'].includes(r[key]))) throw new Error('Use a simple own JSON token field');
    if (e.maxTTLSeconds !== undefined && (!Number.isInteger(e.maxTTLSeconds) || e.maxTTLSeconds < 1 || e.maxTTLSeconds > 86400)) throw new Error('Exchange cache lifetime must be 1–86400 seconds');
  }
  if (auth.type === 'oauth2') {
    if(auth.publicClientID!==undefined&&(clientAuth(auth)!=='none'||typeof auth.publicClientID!=='string'||!auth.publicClientID.trim()||auth.publicClientID.length>512||/[\s\x00-\x1f]/.test(auth.publicClientID)))throw new Error('Public client ID requires a nonempty public OAuth client (clientAuth:none)');
    if(auth.browser!==undefined){
      const b=auth.browser;
      if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['redirectUri','origins'].includes(k))||!Array.isArray(b.origins)||!b.origins.length||b.origins.length>8)throw new Error('browser requires redirectUri and 1–8 sign-in origins');
      const redirect=httpsURL(b.redirectUri);if(redirect.search)throw new Error('Browser callback must not contain query parameters');
      for(const value of [...b.origins,redirect.origin]){const u=new URL(origin(value));if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(u.hostname)||/(?:^|\.)(localhost|local)$/i.test(u.hostname))throw new Error('Browser sign-in requires public HTTPS hostnames');}
      if(!b.origins.includes(new URL(auth.authorizationUrl).origin))throw new Error('Browser origins must include the authorization origin');
    }
    if (!['client_secret_post', 'client_secret_basic', 'none'].includes(clientAuth(auth))) throw new Error('Unsupported OAuth client authentication');
    if (auth.scopeSeparator !== undefined && ![' ', ','].includes(auth.scopeSeparator)) throw new Error('Use a space or comma scope separator');
    const reserved = new Set(['client_id', 'client_secret', 'redirect_uri', 'response_type', 'scope', 'state', 'code', 'code_verifier', 'code_challenge', 'code_challenge_method', 'grant_type', 'refresh_token', 'access_token', 'client_assertion', 'client_assertion_type']);
    for (const field of ['authorizationParams', 'tokenParams']) {
      const values = auth[field] || {};
      if (typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 20) throw new Error('OAuth parameter map must contain at most 20 string values');
      for (const [key, value] of Object.entries(values)) {
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || reserved.has(key.toLowerCase()) || typeof value !== 'string' || value.length > 2000 || /[\r\n]/.test(value)) throw new Error('Invalid/reserved OAuth parameter: ' + key);
      }
    }
    const tokenURL = new URL(auth.tokenUrl), authorizationURL = new URL(auth.authorizationUrl);
    if (tokenURL.search || authorizationURL.search) throw new Error('Put OAuth endpoint query parameters in the reviewed parameter maps');
  }
}
export function publicHeaders(values, auth = { type: 'none' }) {
  if (values === undefined) return {};
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 16) throw new Error('Use at most 16 public headers');
  const result = {};
  const privateName = (auth.type === 'api-key' ? auth.header : auth.type === 'token-exchange' ? auth.exchange.header : 'authorization').toLowerCase();
  for (const [name, value] of Object.entries(values)) {
    const key = name.toLowerCase();
    if (!headerName.test(name) || key === privateName || ['authorization', 'x-api-key', 'accept-encoding'].includes(key) || (forbiddenHeaders.has(key) && key !== 'content-type') || /^(proxy-|sec-|x-forwarded-)/i.test(key) || typeof value !== 'string' || value.length > 2000 || /[^\x20-\x7e]/.test(value) || Object.hasOwn(result, key)) throw new Error('Unsafe/private request header: ' + name);
    result[key] = value;
  }
  return result;
}
export function credentialHeaders(auth, value) {
  if (!value) return {};
  if (auth.type === 'api-key') return { [auth.header]: (auth.prefix || '') + value };
  return { Authorization: 'Bearer ' + value };
}
// JWT claims here are only cache-expiry hints from the pinned HTTPS issuer, never identity assertions.
export function exchangeTokens(auth, response, now = Date.now()) {
  const e = auth.exchange, r = e.response;
  const own = key => response && typeof response === 'object' && !Array.isArray(response) && Object.hasOwn(response, key) ? response[key] : undefined;
  const access = r.format === 'text' ? (typeof response === 'string' ? response.trim() : undefined) : own(r.tokenField || 'access_token');
  if (typeof access !== 'string' || !access || access.length > 16000 || /[^\x21-\x7e]/.test(access)) throw new Error('Invalid exchanged token');
  if (r.format === 'json' && own('token_type') !== undefined && String(own('token_type')).toLowerCase() !== 'bearer') throw new Error('Only exchanged Bearer tokens are supported');
  let seconds;
  if (r.expiry === 'jwt-exp') {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access)) throw new Error('Invalid exchanged JWT');
    let exp;
    try { exp = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString('utf8')).exp; } catch { throw new Error('Invalid JWT expiration'); }
    if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) throw new Error('Invalid JWT expiration');
    seconds = exp - now / 1000;
  } else {
    const raw = own(r.expiresInField || 'expires_in');
    seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid exchanged token lifetime');
  const expires = now + Math.min(seconds, e.maxTTLSeconds || 86400) * 1000;
  return { access, expires };
}
const encode = value => new URLSearchParams({ v: value }).toString().slice(2);
export function tokenRequest(auth, credentials, fields) {
  const params = new URLSearchParams({ ...auth.tokenParams, ...fields });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (clientAuth(auth) === 'client_secret_basic') {
    headers.Authorization = 'Basic ' + Buffer.from(encode(credentials.clientID) + ':' + encode(credentials.clientSecret)).toString('base64');
  } else {
    params.set('client_id', credentials.clientID);
    if (needsClientSecret(auth)) params.set('client_secret', credentials.clientSecret);
  }
  return { method: 'POST', headers, body: params.toString() };
}
