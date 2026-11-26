import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {browserCallback} from './plugin-auth.mjs';
import { PluginManager } from './plugins.mjs';
export class PluginInstances {
  constructor({dataDir,plugins,callbackBase,notify = () => {},setup = () => {},saveBinding = () => {}}) {
    this.dir = path.join(dataDir,'plugin-instances'); fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
    this.file = path.join(this.dir,'index.json'); this.rows = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file,'utf8')) : [];
    this.plugins = plugins; this.callbackBase = callbackBase; this.notify = notify; this.setup = setup; this.saveBinding = saveBinding; this.managers = new Map();
    for (const plugin of Object.keys(plugins.state.grants)) if (plugins.catalogue.has(plugin) && !this.rows.some(r => r.importedFrom === plugin)) this.importAccount(plugin);
  }
  save() {fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.rows),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
  get(id) {const row = this.rows.find(r => r.id === id);if(!row) throw new Error('Unknown plugin instance');return row;}
  importAccount(plugin) {
    const id = 'i-'+crypto.randomBytes(16).toString('hex');
    const grant = this.plugins.state.grants[plugin];if (!grant) throw new Error('No legacy account binding');
    const releases = this.plugins.packages.get(plugin).releases;
    const entry = releases.list().entries.find(r => r.id === grant.hash);if(!entry) throw new Error('Legacy credential recipe release is missing');
    const dir = path.join(this.dir,id);fs.mkdirSync(dir,{recursive:true,mode:0o700});
    for (const [file,value] of [['plugin-grants.json',{grants:{[plugin]:grant},requests:{}}],['plugin-secrets.json',{[plugin]:this.plugins.secrets[plugin] || {}}]]) {
      const target = path.join(dir,file);if (!fs.existsSync(target)) {fs.writeFileSync(target+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(target+'.tmp',target);}
    }
    const slot = this.rows.some(r => r.ownerAppID === 'my-app' && r.plugin === plugin && r.slot === 'default') ? 'imported' : 'default';
    this.rows.push({id,plugin,label:'Existing '+this.plugins.get(plugin).name,ownerAppID:'my-app',slot,hash:grant.hash,version:entry.version,importedFrom:plugin});this.save();this.saveBinding('my-app',plugin,slot,id);return id;
  }
  manager(id) {
    const row = this.get(id);
    if (!this.managers.has(id)) {
      const release = this.plugins.packages.get(row.plugin).releases.read(row.version);
      if (release.id !== row.hash) throw new Error('Plugin instance release mismatch');
      const manifest = {...JSON.parse(release.files['/manifest.json']),hash:release.id,release:release.version,files:release.files};
      const m = new PluginManager({dataDir:path.join(this.dir,id),packages:{active:()=>[manifest]},callbackBase:this.callbackBase,transport:this.plugins.transport,trusted:true,notify:this.notify});
      m.callbackURL = () => this.callbackBase + '/oauth/instances/callback';
      this.managers.set(id,m);
    }
    return this.managers.get(id);
  }
  pluginID(id) {return this.get(id).plugin;}
  metadata(id) {
    const plugin = this.pluginID(id), p = this.manager(id).list().find(p => p.id === plugin);
    const row = this.get(id);
    return {...row,configured:p.configured,connected:p.connected,origins:p.origins,callbackURL:p.callbackURL,auth:p.auth,network:p.network,permissions:p.permissions,description:p.description,methods:p.methods};
  }
  list() {
    return this.rows.map(row => this.metadata(row.id));
  }
  open(plugin, options = {}, ownerAppID) {
    const pkg = this.plugins.get(plugin);
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['slot','label','origins'].includes(k))) throw new Error('Instance options are public slot, label and origins only. Enter credentials in protected setup, never in code/chat.');
    const slot = options.slot || 'default', label = options.label || `${pkg.name} · ${slot}`;
    if (typeof slot !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(slot) || typeof label !== 'string' || !label.trim() || label.length > 80) throw new Error('Use a short instance slot and label');
    let row = this.rows.find(r => r.plugin === plugin && r.ownerAppID === ownerAppID && r.slot === slot);
    if (!row) {
      if (this.rows.length >= 128) throw new Error('Instance limit reached (128)');
      row = {id:'i-'+crypto.randomBytes(16).toString('hex'),plugin,ownerAppID,slot,label:label.trim(),hash:pkg.hash,version:pkg.release};
      this.rows.push(row);
      try {
        const m = this.manager(row.id);
        m.approve(plugin,{hash:pkg.hash,origins:options.origins || pkg.network.origins || pkg.network.defaults,preview:true,agent:true,writes:true});
        this.save();
      } catch(error) {this.rows = this.rows.filter(r => r !== row);this.managers.delete(row.id);throw error;}
    }
    const meta = this.metadata(row.id); this.saveBinding(ownerAppID,plugin,slot,row.id);
    if (!meta.connected) this.setup(row.id);
    this.notify(); return {id:meta.id,plugin:meta.plugin,label:meta.label,slot:meta.slot,hash:meta.hash,version:meta.version,connected:meta.connected,connectionRequired:!meta.connected};
  }
  configure(id,config) {
    const m = this.manager(id), plugin = this.pluginID(id);
    if (config.origins) {const p = m.get(plugin);m.approve(plugin,{hash:p.hash,origins:config.origins,preview:true,agent:true,writes:true});}
    m.configure(plugin,config);this.notify();
  }
  copyRegistration(from,to) {
    const a = this.manager(from), b = this.manager(to), ap = this.pluginID(from), bp = this.pluginID(to);
    if (ap !== bp || a.get(ap).auth.type !== 'oauth2') throw new Error('Choose another instance of the same OAuth plugin');
    const secret = a.secrets[ap],clientID=secret?.clientID||a.get(ap).auth.publicClientID;if(!clientID) throw new Error('Source registration is not configured');
    this.configure(to,{clientID,clientSecret:secret?.clientSecret});
  }
  connect(id) {return this.manager(id).beginOAuth(this.pluginID(id));}
  cancelOAuth(id){this.manager(id).cancelOAuth(this.pluginID(id));}
  async finishBrowser(id,value){const m=this.manager(id),plugin=this.pluginID(id);const params=browserCallback(m.get(plugin).auth,value);await m.finishOAuth(plugin,params,{browser:true});this.notify();}
  async exchange(id) {await this.manager(id).exchange(this.pluginID(id));this.notify();return {id,connected:this.metadata(id).connected};}
  async finish(params) {
    const state = params.get('state');
    const id = this.rows.find(row => this.managers.get(row.id)?.oauthPending.has(state))?.id;
    if (!id) throw new Error('OAuth instance request expired; reconnect');
    await this.manager(id).finishOAuth(this.pluginID(id),params);this.notify();return id;
  }
  disconnect(id) {this.manager(id).disconnect(this.pluginID(id));this.notify();}
  async call(id,method,args,context) {
    if (this.plugins.catalogue.has(id)) throw new Error('Pass a plugin instance ID, not a package ID. First await plugins.open(packageID,{slot,label}).');
    const m = this.manager(id), plugin = this.pluginID(id);
    if (!this.metadata(id).connected) {this.setup(id);throw new Error('Connect plugin instance '+id+' in protected account setup, then retry. Its ID is already saved in app data.');}
    return m.call(plugin,method,args,{...context,expectedHash:undefined});
  }
  close() {for (const m of this.managers.values()) m.close();}
}
