import { origin, httpsURL } from './plugin-network.mjs';
import { validateAuth, publicHeaders } from './plugin-auth.mjs';
export function validateManifest(m, id) {
  if (!m || !/^[a-z][a-z0-9-]{0,49}$/.test(m.id) || m.id !== id || !/^\d+\.\d+\.\d+$/.test(m.version) || !['http-json', 'rest-json'].includes(m.driver) || !['none', 'bearer', 'api-key', 'oauth2', 'token-exchange'].includes(m.auth?.type) || !m.methods || Object.keys(m.methods).length > 30 || !m.network || !Array.isArray(m.permissions) || typeof m.docs !== 'string')
    throw new Error('Invalid plugin manifest: ' + id);
  if ((m.network.origins || m.network.defaults || []).length > 8) throw new Error('At most 8 origins are allowed');
  for (const item of m.network.origins || m.network.defaults || []) origin(item);
  if (m.driver === 'rest-json' && m.network.origins?.length !== 1) throw new Error('REST plugins require one fixed origin');
  if (m.auth.type === 'oauth2') {
    httpsURL(m.auth.authorizationUrl); httpsURL(m.auth.tokenUrl);
    if (!Array.isArray(m.auth.scopes) || m.auth.scopes.length > 20 || m.auth.scopes.some(scope => typeof scope !== 'string' || !scope || scope.length > 2000 || /\s/.test(scope) || (m.auth.scopeSeparator === ',' && scope.includes(',')))) throw new Error('Provide an array of up to 20 OAuth scope identifiers');
  }
  validateAuth(m.auth);
  for (const [name, method] of Object.entries(m.methods)) {
    if (method.request?.headers) publicHeaders(method.request.headers, m.auth);
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(name) || !method.input?.properties) throw new Error('Valid method name and argument schema required');
    for (const rule of Object.values(method.input.properties)) if (rule.pattern && rule.pattern !== '^[a-zA-Z0-9_-]+$') throw new Error('Only the identifier argument pattern is currently supported');
    if (m.driver === 'rest-json' && (method.request?.method !== 'GET' || !method.request.path?.startsWith('/') || method.request.path.startsWith('//') || method.request.path.includes('\\'))) throw new Error('REST recipes currently support read-only relative GET paths');
  }
  if (m.driver === 'http-json' && (!m.methods.request || Object.keys(m.methods).length !== 1)) throw new Error('HTTP plugins expose the request method; custom JS clients wrap it');
  return m;
}
