import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Workspace } from './workspace.mjs';
export class Library {
  constructor(dataDir, packages) {
    this.dir = dataDir; this.packages = packages; this.opened = new Map();
    this.filename = path.join(dataDir, 'library.json');
    if (fs.existsSync(this.filename)) this.state = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
    else {
      const sessions = path.join(dataDir, 'sessions');
      const files = fs.existsSync(sessions) ? fs.readdirSync(sessions).filter(f => f.endsWith('.jsonl')).sort((a,b) => fs.statSync(path.join(sessions,b)).mtimeMs - fs.statSync(path.join(sessions,a)).mtimeMs) : [];
      const chats = files.map((f,i) => ({ id: crypto.randomUUID(), title: i ? `Earlier chat ${i}` : 'Existing app chat', primary: 'app:my-app', projects: ['app:my-app'], sessionFile: path.join(sessions,f), createdAt: fs.statSync(path.join(sessions,f)).mtimeMs }));
      if (!chats.length) chats.push(this.newChatRecord('app:my-app', 'Build my app'));
      this.state = { version: 1, apps: [{ id: 'my-app', name: 'My app', icon: '◈', legacy: true, services: null }], pluginMeta: {}, activeApp: 'my-app', chats, activeChat: chats[0].id };
      this.save();
    }
  }
  save() { fs.writeFileSync(this.filename + '.tmp', JSON.stringify(this.state), { mode: 0o600 }); fs.renameSync(this.filename + '.tmp', this.filename); }
  validID(id) { if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,49}$/.test(id)) throw new Error('Use a lowercase project ID with letters, digits and hyphens'); }
  app(id = this.state.activeApp) { this.validID(id); const app = [...this.state.apps,...(this.state.systemApps || [])].find(a => a.id === id); if (!app) throw new Error('Unknown app: ' + id); if (app.deletedAt) throw new Error('App is in Trash; restore it first: ' + id); return app; }
  trashApp(id) {
    const app = this.app(id); if (app.system) throw new Error('System apps cannot be trashed; use protected chat recovery instead'); this.workspace(id); app.deletedAt = Date.now();
    if (this.state.activeApp === id) this.state.activeApp = this.state.apps.find(a => !a.deletedAt)?.id || null;
    this.save(); return app;
  }
  restoreApp(id) {
    this.validID(id); const app = this.state.apps.find(a => a.id === id && a.deletedAt);
    if (!app) throw new Error('App is not in Trash');
    const dir = app.legacy ? this.dir : path.join(this.dir,'apps',id);
    if (!fs.existsSync(path.join(dir,'workspace.json'))) throw new Error('App files are missing; cannot restore');
    delete app.deletedAt; if (!this.state.activeApp) this.state.activeApp = id;
    this.save(); return app;
  }
  purgeApp(id) {
    this.validID(id); const app = this.state.apps.find(a => a.id === id && a.deletedAt);
    if (!app) throw new Error('Move the app to Trash before permanently deleting it');
    // The imported app shares the backend data directory: NEVER remove that directory.
    if (app.legacy) {
      for (const name of ['workspace.json','workspace.json.tmp','releases/app']) fs.rmSync(path.join(this.dir,name),{recursive:true,force:true});
    } else fs.rmSync(path.join(this.dir,'apps',id),{recursive:true,force:true});
    for (const suffix of ['.json','.json.tmp']) fs.rmSync(path.join(this.dir,'app-data',id+suffix),{force:true});
    this.opened.delete(id); this.state.apps = this.state.apps.filter(a => a.id !== id);
    this.state.retiredAppIDs = [...new Set([...(this.state.retiredAppIDs || []),id])];
    for (const chat of this.state.chats) {if (chat.primary === 'app:'+id) chat.primary = null;chat.projects = chat.projects.filter(p => p !== 'app:'+id);}
    this.save();
  }
  workspace(id = this.state.activeApp) {
    const app = this.app(id);
    if (!this.opened.has(id)) this.opened.set(id, new Workspace(app.legacy ? this.dir : path.join(this.dir, app.system ? 'system-apps' : 'apps', id), app.legacy ? '' : id));
    return this.opened.get(id);
  }
  project(key) {
    if (typeof key !== 'string') throw new Error('Choose app:<id> or plugin:<id>');
    const [kind,id,...rest] = key.split(':'); this.validID(id);
    if (rest.length || !['app','plugin'].includes(kind)) throw new Error('Choose app:<id> or plugin:<id>');
    if (kind === 'app') this.app(id); else this.packages.get(id);
    return { kind,id,key };
  }
  create(kind,id,name,icon) {
    this.validID(id);
    if (kind === 'app') {
      if (id === 'morph-chat' || this.state.systemApps?.some(a=>a.id===id)) throw new Error('This ID is reserved for a system app');
      if (this.state.retiredAppIDs?.includes(id)) throw new Error('This app ID was permanently deleted; choose a new ID (the same display name is fine)');
      if (this.state.apps.length >= 24 || this.state.apps.some(a => a.id === id)) throw new Error('App exists (possibly in Trash) or library limit (24, including Trash) reached');
      this.state.apps.push({ id, name: this.label(name || id), icon: this.glyph(icon || '◇'), services: null });
      this.workspace(id); if (!this.state.activeApp) this.state.activeApp = id;
    } else if (kind === 'plugin') { this.packages.create(id); this.state.pluginMeta[id] = { name: this.label(name || id), icon: this.glyph(icon || '⚙') }; }
    else throw new Error('Choose app or plugin');
    const key = kind + ':' + id;
    const primary = this.chat().primary;
    if (!primary || (primary.startsWith('app:') && this.state.apps.some(a => 'app:'+a.id === primary && a.deletedAt))) this.chat().primary = key;
    this.touch(key); this.save(); return key;
  }
  label(value) { if (typeof value !== 'string' || !value.trim() || value.length > 80) throw new Error('Name must be 1–80 characters'); return value.trim(); }
  glyph(value) { if (typeof value !== 'string' || !value.trim() || value.length > 12) throw new Error('Icon must be a short emoji, glyph or initials (max 12 characters)'); return value.trim(); }
  update(key, { name, icon }) {
    const p = this.project(key), meta = p.kind === 'app' ? this.app(p.id) : (this.state.pluginMeta[p.id] ||= {});
    const next = { ...(name !== undefined ? { name: this.label(name) } : {}), ...(icon !== undefined ? { icon: this.glyph(icon) } : {}) };
    Object.assign(meta,next); this.save();
  }
  newChatRecord(primary = null, title = 'New chat') { return { id: crypto.randomUUID(), title, primary, projects: primary ? [primary] : [], createdAt: Date.now() }; }
  createChat(primary = null) { if (primary) this.project(primary); if (this.state.chats.length >= 256) throw new Error('Chat limit reached'); const chat = this.newChatRecord(primary); this.state.chats.unshift(chat); this.state.activeChat = chat.id; this.save(); return chat; }
  chat(id = this.state.activeChat) { const chat = this.state.chats.find(c => c.id === id); if (!chat) throw new Error('Chat not found'); return chat; }
  selectChat(id) { this.chat(id); this.state.activeChat = id; this.save(); }
  touch(key) { this.project(key); const chat = this.chat(); if (!chat.projects.includes(key)) chat.projects.push(key); this.save(); }
  resolve(filename) {
    if (typeof filename !== 'string' || filename.includes('..') || filename.includes('\\') || filename.includes('\0')) throw new Error('Only virtual project paths without traversal are allowed');
    const match = /^\/(apps|plugins)\/([a-z][a-z0-9-]{0,49})(\/.*)$/.exec(filename);
    if (match) return { ...this.project((match[1] === 'apps' ? 'app:' : 'plugin:') + match[2]), filename: match[3] };
    if (/^\/(apps|plugins)(\/|$)/.test(filename)) throw new Error('Use /apps/<id>/<file> or /plugins/<id>/<file>');
    if (!this.chat().primary) throw new Error('This chat has no primary project. Create one or use a fully qualified /apps/<id>/… or /plugins/<id>/… path.');
    return { ...this.project(this.chat().primary), filename };
  }
  files(action, filename, ...args) {
    const p = this.resolve(filename); this.touch(p.key);
    return p.kind === 'app' ? this.workspace(p.id)[action](p.filename,...args) : this.packages[action](p.id,p.filename,...args);
  }
  fileList() { return [...[...this.state.apps,...(this.state.systemApps || [])].filter(a => !a.deletedAt).flatMap(a => this.workspace(a.id).list().map(f => '/apps/' + a.id + f)), ...this.packages.list().flatMap(p => p.files.map(f => '/plugins/' + p.id + f))]; }
  dependencies(all, id = this.state.activeApp) { this.app(id); return all; }
  data(id,action,key,value) {
    this.app(id); const dir = path.join(this.dir,'app-data'); fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const file = path.join(dir,id+'.json'), data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {};
    if (action === 'list') return Object.keys(data);
    if (typeof key !== 'string' || !key || key.length > 100) throw new Error('App data key must be 1–100 characters');
    if (action === 'get') return Object.hasOwn(data,key) ? data[key] : null;
    let next;
    if (action === 'set') {
      const encoded = JSON.stringify(value); if (encoded === undefined || Buffer.byteLength(encoded) > 16000) throw new Error('App data values must be JSON under 16 KiB');
      next = {...data,[key]:JSON.parse(encoded)};
    } else if (action === 'delete') {next = {...data};delete next[key];} else throw new Error('Unknown app data operation');
    if (Object.keys(next).length > 64 || Buffer.byteLength(JSON.stringify(next)) > 256000) throw new Error('App data limit: 64 keys / 256 KiB');
    fs.writeFileSync(file+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(file+'.tmp',file);return action === 'set' ? next[key] : null;
  }
  service(id, plugin, enabled) { this.packages.get(plugin); const app = this.app(id); if (app.services === null) throw new Error('Imported app retains legacy service access; configure service grants in Plugins'); app.services = enabled ? [...new Set([...app.services,plugin])] : app.services.filter(p => p !== plugin); this.save(); }
  view() {
    return { activeApp: this.state.activeApp, activeChat: this.state.activeChat, systemApps: (this.state.systemApps || []).map(a=>({...a,path:'/apps/'+a.id,liveVersion:this.workspace(a.id).state.live?.version})), trash: this.state.apps.filter(a => a.deletedAt).map(a => ({id:a.id,name:a.name,icon:a.icon,deletedAt:a.deletedAt})), apps: this.state.apps.filter(a => !a.deletedAt).map(a => ({ ...a, path: '/apps/' + a.id, liveVersion: this.workspace(a.id).state.live?.version })), plugins: this.packages.list().map(p => ({ id:p.id, name:this.state.pluginMeta[p.id]?.name || p.id, icon:this.state.pluginMeta[p.id]?.icon || '⚙', path:'/plugins/' + p.id })), chats: this.state.chats.map(({ sessionFile, ...c }) => c), primary: this.chat().primary };
  }
}
