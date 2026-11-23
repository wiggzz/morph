import crypto from 'node:crypto';
// Tokens are held by the trusted native shell, not the generated WebView code.
export class RuntimeCapabilities {
  constructor(plugins) { this.plugins = plugins; this.active = new Map(); }
  issue(surface, snapshot) {
    if (!['live', 'preview'].includes(surface)) throw new Error('Invalid surface');
    const slot = surface === 'live' && snapshot.appID ? 'live:' + snapshot.appID : surface;
    this.revoke(slot);
    const record = { id: crypto.randomUUID(), surface, appID: snapshot.appID || null, snapshotID: snapshot.id, version: snapshot.version || null, dependencies: snapshot.dependencies || {}, controller: new AbortController() };
    this.active.set(slot, record);
    this.active.set(surface, record); return record.id;
  }
  live(appID) { return this.active.get(appID ? 'live:' + appID : 'live'); }
  select(appID) { const record = this.live(appID); if (record) this.active.set('live',record); else this.active.delete('live'); }
  revoke(surface) { const record = this.active.get(surface); record?.controller.abort(); for (const [key,value] of this.active) if (value === record) this.active.delete(key); }
  clear() { for (const record of this.active.values()) record.controller.abort(); this.active.clear(); }
  record(token) {
    const record = [...this.active.values()].find(r => r.id === token);
    if (!record || record.controller.signal.aborted) throw new Error('Runtime replaced/disconnected. Render again.');
    return record;
  }
  async call(token, { plugin, method, args }) {
    const record = this.record(token);
    const dependency = Object.hasOwn(record.dependencies,plugin) ? record.dependencies[plugin] : undefined;
    if (!dependency && !this.plugins.trusted) throw new Error('This app snapshot does not include that approved plugin. Install/approve it, then render again.');
    return this.plugins.call(plugin, method, args || {}, { appID:record.appID, surface: record.surface, expectedHash: this.plugins.trusted ? undefined : dependency.hash, signal: record.controller.signal });
  }
}
