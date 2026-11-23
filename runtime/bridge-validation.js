export const validName = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value);
export function jsonCopy(value, limit = 16000) {
  const seen = new Set(); let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 2000 || depth > 12) throw new Error('Bridge JSON exceeds depth/node limit');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object') throw new Error('Bridge data must be JSON; use null instead of undefined/functions');
    if (seen.has(item)) throw new Error('Bridge JSON is circular');
    seen.add(item); for (const child of Object.values(item)) visit(child, depth + 1); seen.delete(item);
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  let bytes = 0;
  for (const char of text) { const code = char.codePointAt(0); bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
  if (bytes > limit) throw new Error(`Bridge JSON exceeds ${limit} bytes`);
  return JSON.parse(text);
}
const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'description', 'title', 'default']);
export function validateSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 8) throw new Error('Invalid/too-deep port input schema');
  if (Object.keys(schema).some(key => !keywords.has(key))) throw new Error('Unsupported port schema keyword');
  if (schema.type && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(schema.type)) throw new Error('Unsupported port input type');
  if (schema.properties && (typeof schema.properties !== 'object' || Array.isArray(schema.properties))) throw new Error('Invalid schema properties');
  if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100)) throw new Error('Invalid port enum');
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') throw new Error('additionalProperties must be boolean');
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) if (schema[key] !== undefined && (!Number.isFinite(schema[key]) || (key !== 'minimum' && key !== 'maximum' && (!Number.isInteger(schema[key]) || schema[key] < 0)))) throw new Error('Invalid schema bound: ' + key);
  if (schema.properties) for (const child of Object.values(schema.properties)) validateSchema(child, depth + 1);
  if (schema.items) validateSchema(schema.items, depth + 1);
  if (schema.required && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string'))) throw new Error('Invalid required fields');
}
export function validateInput(schema, value, path = '$', depth = 0) {
  if (depth > 12) throw new Error('Port arguments too deep');
  const fail = text => { throw new Error(`Port input ${path}: ${text}`); };
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) fail('not in enum');
  const type = schema.type;
  if (type === 'null' && value !== null) fail('expected null');
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected object');
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail('missing ' + key);
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, key)) validateInput(schema.properties[key], child, path + '.' + key, depth + 1);
      else if (schema.additionalProperties !== true) fail('unknown field ' + key);
    }
  }
  if (type === 'array') {
    if (!Array.isArray(value)) fail('expected array');
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 1000)) fail('array size out of bounds');
    if (schema.items) value.forEach((item, i) => validateInput(schema.items, item, `${path}[${i}]`, depth + 1));
  }
  if (type === 'string') {
    if (typeof value !== 'string') fail('expected string');
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 16000)) fail('string length out of bounds');
  }
  if (type === 'boolean' && typeof value !== 'boolean') fail('expected boolean');
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) fail('expected ' + type);
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail('number out of bounds');
  }
}
