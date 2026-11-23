import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Releases } from './releases.mjs';

export const starter = `import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
export default function App() {
  const [count, setCount] = useState(0);
  return <View style={s.page}>
    <Text style={s.eyebrow}>MORPH / A LIVING APP</Text>
    <Text style={s.title}>What should we make?</Text>
    <Text style={s.body}>Open chat and ask your agent to turn this space into something useful. Changes land in Preview first.</Text>
    <Pressable testID="counter" style={s.button} onPress={() => setCount(count + 1)}>
      <Text style={s.buttonText}>Native taps: {count}</Text>
    </Pressable>
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1, padding: 28, justifyContent: 'center', backgroundColor: '#101a22' },
  eyebrow: { color: '#7de2ce', fontSize: 11, letterSpacing: 2, marginBottom: 22 },
  title: { color: '#f4f3ec', fontSize: 38, fontWeight: '700', marginBottom: 20 },
  body: { color: '#aab9bf', fontSize: 17, lineHeight: 26, marginBottom: 28 },
  button: { backgroundColor: '#7de2ce', padding: 18, borderRadius: 16 },
  buttonText: { color: '#10242a', fontWeight: '700', fontSize: 16 }
});
`;

export function normalize(name) {
  if (typeof name !== 'string' || name.includes('\\') || name.includes('\0') || name.split('/').includes('..'))
    throw new Error('Only virtual paths without .. are allowed');
  const result = '/' + name.split('/').filter(Boolean).join('/');
  if (!/^\/[\w./-]+\.(tsx?|jsx?|json)$/.test(result)) throw new Error('Use a .tsx, .ts, .jsx, .js or .json virtual file');
  return result;
}

export class Workspace {
  constructor(dir, namespace = '') {
    this.dir = dir; this.namespace = namespace;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filename = path.join(dir, 'workspace.json');
    this.state = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {
      files: { '/App.tsx': starter }, live: null, previous: null,
    };
    this.releases = new Releases(path.join(dir, 'releases', 'app'));
    if (!this.releases.index.entries.length) {
      if (this.state.previous) this.releases.publish(this.state.previous, 'Imported previous deployment');
      if (this.state.live) this.releases.publish(this.state.live, 'Imported existing deployment');
    }
    this.syncReleases();
    this.save();
  }
  syncReleases() {
    this.state.live = this.releases.index.active ? this.releases.read(this.releases.index.active) : null;
    this.state.previous = this.releases.index.previous ? this.releases.read(this.releases.index.previous) : null;
  }
  save() {
    const filename = path.join(this.dir, 'workspace.json');
    fs.writeFileSync(filename + '.tmp', JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(filename + '.tmp', filename);
  }
  list() { return Object.keys(this.state.files).sort(); }
  read(name) {
    const result = this.state.files[normalize(name)];
    if (result === undefined) throw new Error('Virtual file not found');
    return result;
  }
  write(name, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 128 * 1024) throw new Error('File limit: 128 KiB');
    const next = { ...this.state.files, [normalize(name)]: content };
    if (Object.keys(next).length > 64 || Buffer.byteLength(JSON.stringify(next)) > 512 * 1024) throw new Error('Workspace limit exceeded');
    this.state.files = next;
    this.save();
  }
  edit(name, oldText, newText) {
    const current = this.read(name);
    if (!oldText || current.split(oldText).length !== 2) throw new Error('oldText must match exactly once');
    this.write(name, current.replace(oldText, () => newText));
  }
  snapshot(dependencies = {}) {
    const files = { ...this.state.files };
    const source = Object.keys(dependencies).length ? { files, dependencies } : files;
    const id = crypto.createHash('sha256').update(JSON.stringify(this.namespace ? { appID: this.namespace, source } : source)).digest('hex').slice(0, 16);
    return { id, files, dependencies };
  }
  promote(snapshot, label = '') {
    const release = this.releases.publish(snapshot, label);
    this.syncReleases(); this.save();
    return release;
  }
  activate(version) {
    const release = this.releases.activate(version);
    this.syncReleases(); this.save();
    return release;
  }
  restoreDraft(version) {
    this.state.files = this.releases.read(version).files;
    this.save();
  }
  rollback() {
    if (!this.releases.index.previous) throw new Error('No previous deployment');
    return this.activate(this.releases.index.previous);
  }
}
