import dns from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch, Headers } from 'undici';

export function httpsURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Use an absolute HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443'))
    throw new Error('Only HTTPS on port 443, without credentials or fragments, is allowed');
  return url;
}
export function origin(value) {
  const url = httpsURL(value.trim());
  if (url.pathname !== '/' || url.search) throw new Error('Enter origins without paths or query strings');
  return url.origin;
}
export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

// Resolve once, reject private/reserved addresses, then pin the TCP connection to that result.
// The dispatcher never uses proxy environment variables and never follows redirects.
export async function secureJSON(urlValue, options = {}) {
  const url = httpsURL(urlValue);
  const { responseType = 'json', ...requestOptions } = options;
  if (!['json', 'text'].includes(responseType)) throw new Error('Unsupported response format');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const records = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Network request cancelled or timed out'));
    signal.addEventListener('abort', abort, { once: true });
    dns.lookup(hostname, { all: true, verbatim: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  signal.throwIfAborted();
  if (!records.length || records.some(record => !publicAddress(record.address))) throw new Error('Private, local and reserved network addresses are blocked');
  const pinned = records.find(record => record.family === 4) || records[0];
  const dispatcher = new Agent({ connect: { lookup: (_host, opts, callback) => {
    if (opts?.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  } } });
  try {
    const headers = new Headers({ Accept: 'application/json', 'User-Agent': 'Morph-Lab/0.1' });
    for (const [name, value] of Object.entries(options.headers || {})) headers.set(name, value);
    const response = await fetch(url, { ...requestOptions, signal, dispatcher, redirect: 'error', headers });
    return await readResponse(response, responseType);
  } finally { await dispatcher.close(); }
}

// Kept separate so the real bounded body reader can be tested without external requests.
export async function readResponse(response, responseType = 'json') {
  if (!['json', 'text'].includes(responseType)) throw new Error('Unsupported response format');
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Remote service returned HTTP ${response.status}`);
  }
  if (response.status === 204) { await response.body?.cancel(); return null; }
  if (responseType === 'json' && !/\bjson\b/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw new Error('Remote service did not return JSON'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > (responseType === 'text' ? 16000 : 256 * 1024)) throw new Error('Plugin response exceeds output limit');
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (responseType === 'text') return text;
  try { return JSON.parse(text); }
  catch { throw new Error('Remote service returned invalid JSON'); }
}
