import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Releases } from './releases.mjs';
import { normalize } from './workspace.mjs';
import { validateManifest } from './plugin-manifest.mjs';

export class PluginPackages {
  constructor({ directory, dataDir }) {
    this.bundledDirectory = directory;
    this.directory = path.join(dataDir, 'plugin-workspaces');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.workspaces = new Map();
    for (const dir of fs.readdirSync(this.directory, { withFileTypes: true })) if (dir.isDirectory()) this.open(dir.name);
    for (const dir of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!dir.isDirectory() || this.workspaces.has(dir.name)) continue;
      const filename = path.join(directory, dir.name, 'manifest.json');
      if (!fs.existsSync(filename)) continue;
      const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
      validateManifest(manifest, dir.name);
      const wrappers = `import { plugins } from '@morph/plugins';\nexport const createClient = instanceID => ({\n` + Object.keys(manifest.methods).map(method => `${JSON.stringify(method)}: (args = {}) => plugins.call(instanceID, ${JSON.stringify(method)}, args),`).join('\n') + '\n});\n';
      const w = this.create(manifest.id, { '/manifest.json': JSON.stringify(manifest, null, 2), '/index.ts': wrappers });
      w.releases.publish(this.snapshot(manifest.id), 'Bundled example');
    }
  }
  bundledExample(id) {
    this.validID(id);
    const filename = path.join(this.bundledDirectory, id, 'manifest.json');
    if (!fs.existsSync(filename)) return null;
    return validateManifest(JSON.parse(fs.readFileSync(filename, 'utf8')), id);
  }
  validID(id) { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,49}$/.test(id)) throw new Error('Use a lowercase plugin id with letters, digits and hyphens'); }
  open(id) {
    this.validID(id);
    const directory = path.join(this.directory, id);
    const filename = path.join(directory, 'draft.json');
    if (!fs.existsSync(filename)) throw new Error('Plugin workspace not found');
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const w = { id, directory, files: data.files, releases: new Releases(path.join(directory, 'releases')), requested: data.requested || null };
    this.workspaces.set(id, w); return w;
  }
  get(id) { this.validID(id); const w = this.workspaces.get(id); if (!w) throw new Error('Plugin workspace not found'); return w; }
  save(w) {
    const filename = path.join(w.directory, 'draft.json');
    fs.writeFileSync(filename + '.tmp', JSON.stringify({ files: w.files, requested: w.requested }), { mode: 0o600 });
    fs.renameSync(filename + '.tmp', filename);
  }
  create(id, files) {
    this.validID(id);
    if (this.workspaces.has(id)) throw new Error('Plugin workspace already exists');
    if (this.workspaces.size >= 32) throw new Error('At most 32 local plugin workspaces are supported');
    if (!files) {
      const manifest = { id, name: id, version: '0.1.0', publisher: 'Local user-authored plugin (unsigned)', description: 'A locally built service plugin', driver: 'http-json', auth: { type: 'none' }, network: { configurable: true, defaults: ['https://example.com'] }, permissions: ['Read JSON from user-approved HTTPS origins'], docs: 'Document the exported client functions, network use and setup here.', methods: { request: { description: 'Read JSON from an approved origin', input: { properties: { url: { type: 'string', maxLength: 4000 }, method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, headers: { type: 'headers' }, body: { type: 'json' } }, required: ['url'] } } } };
      files = { '/manifest.json': JSON.stringify(manifest, null, 2), '/index.ts': `import { plugins } from '@morph/plugins';\nexport const createClient = instanceID => ({ request: (args = {}) => plugins.call(instanceID, 'request', args) });\n` };
    }
    const directory = path.join(this.directory, id); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const w = { id, directory, files, requested: null, releases: new Releases(path.join(directory, 'releases')) };
    this.workspaces.set(id, w); this.save(w); return w;
  }
  list() {
    return [...this.workspaces.values()].map(w => ({ id: w.id, files: Object.keys(w.files), draftID: this.snapshot(w.id).id, requested: w.requested, history: w.releases.list() }));
  }
  read(id, filename) { const value = this.get(id).files[normalize(filename)]; if (value === undefined) throw new Error('Plugin file not found'); return value; }
  write(id, filename, content) {
    const w = this.get(id);
    if (typeof content !== 'string' || Buffer.byteLength(content) > 128 * 1024) throw new Error('Plugin file limit: 128 KiB');
    const files = { ...w.files, [normalize(filename)]: content };
    if (Object.keys(files).length > 32 || Buffer.byteLength(JSON.stringify(files)) > 256 * 1024) throw new Error('Plugin package limit: 32 files / 256 KiB');
    w.files = files; this.save(w);
  }
  edit(id, filename, oldText, newText) {
    const text = this.read(id, filename);
    if (!oldText || text.split(oldText).length !== 2) throw new Error('oldText must match exactly once');
    this.write(id, filename, text.replace(oldText, () => newText));
  }
  snapshot(id) {
    const files = { ...this.get(id).files };
    return { id: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
  }
  validate(id) {
    const snapshot = this.snapshot(id);
    if (!snapshot.files['/index.ts'] && !snapshot.files['/index.js']) throw new Error('Plugin needs /index.ts or /index.js');
    const manifest = JSON.parse(snapshot.files['/manifest.json']);
    validateManifest(manifest, id);
    return { ...snapshot, manifest };
  }
  requestPublish(id) { const w = this.get(id); w.requested = this.validate(id).id; this.save(w); return 'Plugin publication requested. The user must publish the built source hash in Plugins; installation is a separate approval.'; }
  publish(id, expectedHash, label = '') {
    const snapshot = this.validate(id);
    if (snapshot.id !== expectedHash) throw new Error('Plugin source changed; build and review it again');
    const w = this.get(id), release = w.releases.publish(snapshot, label);
    w.requested = null; this.save(w); return release;
  }
  activate(id, version) { return this.get(id).releases.activate(version); }
  restoreDraft(id, version) { const w = this.get(id); w.files = w.releases.read(version).files; this.save(w); }
  active() {
    return [...this.workspaces.values()].filter(w => w.releases.index.active).map(w => {
      const release = w.releases.read(w.releases.index.active);
      return { ...JSON.parse(release.files['/manifest.json']), hash: release.id, release: release.version, files: release.files };
    });
  }
}
