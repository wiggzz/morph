import fs from 'node:fs';
import path from 'node:path';

// Source snapshots are write-once files; activation is independent and never rewrites a release.
export class Releases {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.indexPath = path.join(directory, 'index.json');
    this.index = fs.existsSync(this.indexPath) ? JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) : { entries: [], active: null, previous: null, activations: [] };
  }
  save() {
    fs.writeFileSync(this.indexPath + '.tmp', JSON.stringify(this.index, null, 2), { mode: 0o600 });
    fs.renameSync(this.indexPath + '.tmp', this.indexPath);
  }
  filename(version) { return path.join(this.directory, `v${String(version).padStart(6, '0')}.json`); }
  read(version) {
    if (!Number.isSafeInteger(version) || version < 1 || !this.index.entries.some(entry => entry.version === version)) throw new Error('Release version not found');
    return JSON.parse(fs.readFileSync(this.filename(version), 'utf8'));
  }
  publish(snapshot, label = '') {
    if (typeof label !== 'string' || label.length > 120) throw new Error('Release label must be under 120 characters');
    let version = (this.index.entries.at(-1)?.version || 0) + 1;
    while (fs.existsSync(this.filename(version))) version++;
    const release = { ...snapshot, version, label: label.trim(), createdAt: new Date().toISOString() };
    fs.writeFileSync(this.filename(version), JSON.stringify(release), { flag: 'wx', mode: 0o600 });
    this.index.entries.push({ version, id: release.id, label: release.label, createdAt: release.createdAt,
      dependencies: Object.entries(release.dependencies || {}).map(([id, dependency]) => ({ id, version: dependency.release, hash: dependency.hash })),
    });
    this.index.previous = this.index.active;
    this.index.active = version;
    this.index.activations.push({ version, at: release.createdAt, action: 'promote' });
    this.save();
    return this.read(version);
  }
  activate(version) {
    const release = this.read(version);
    if (version !== this.index.active) {
      this.index.previous = this.index.active; this.index.active = version;
      this.index.activations.push({ version, at: new Date().toISOString(), action: 'activate' });
      this.save();
    }
    return release;
  }
  list() { return { entries: this.index.entries, active: this.index.active, previous: this.index.previous }; }
}
