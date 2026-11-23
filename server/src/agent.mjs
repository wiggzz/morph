import path from 'node:path';
import fs from 'node:fs';
import {sandboxPrompt} from './sandbox-prompt.mjs';
import {ProjectTools} from './project-tools.mjs';
import {attachOpenAIWeb} from './openai-web.mjs';
import {Type} from '@earendil-works/pi-ai';
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';

export async function makeAgent({dataDir,host,notify,render,requestDeploy,authPath,plugins,buildPlugin,library,sharedRuntime,activateApp,manageRuntime,webActivity,usage}) {
  const modelRuntime=sharedRuntime||await ModelRuntime.create({authPath:authPath||path.join(dataDir,'auth.json'),modelsPath:null});
  const text=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}],details:undefined});
  const tool=(name,description,parameters,execute)=>({name,label:name,description,parameters,executionMode:'sequential',execute:async(_id,p,signal)=>execute(p,signal)});
  const choices=values=>Type.Union(values.map(v=>Type.Literal(v))), empty=Type.Object({}), appID=Type.Optional(Type.String({maxLength:50})), surface=Type.Optional(choices(['preview','live']));
  const primaryApp=()=>{const p=library.chat().primary;if(!p?.startsWith('app:'))throw new Error('This chat has no primary app; supply appID or focus an app project.');return p.slice(4);};
  const settle={waitUntilSettled:Type.Optional(Type.Boolean()),timeoutMs:Type.Optional(Type.Integer({minimum:100,maximum:15000})),quietMs:Type.Optional(Type.Integer({minimum:50,maximum:1000}))};
  const tools=[
    tool('list','List qualified virtual app/plugin files.',empty,()=>text(library.fileList())),
    tool('read','Read a virtual project file, optionally by 1-based lines.',Type.Object({path:Type.String(),offset:Type.Optional(Type.Integer({minimum:1})),limit:Type.Optional(Type.Integer({minimum:1,maximum:1000}))}),p=>{const start=p.offset||1;return text(library.files('read',p.path).split('\n').slice(start-1,start-1+(p.limit||300)).map((line,i)=>`${start+i}: ${line}`).join('\n'));}),
    tool('write','Create/replace virtual source (128 KiB/file).',Type.Object({path:Type.String(),content:Type.String()}),p=>{library.files('write',p.path,p.content);notify();return text('Saved '+p.path);}),
    tool('edit','Replace one exact unique source match.',Type.Object({path:Type.String(),oldText:Type.String(),newText:Type.String()}),p=>{library.files('edit',p.path,p.oldText,p.newText);notify();return text('Edited '+p.path);}),
    tool('projects','List/create/update/focus sandbox projects or run/close apps. create binds an unbound chat only; focus explicitly changes the primary project. Icons are short emoji/glyphs.',Type.Object({action:choices(['list','create','update','focus','run','close']),kind:Type.Optional(choices(['app','plugin'])),id:Type.Optional(Type.String()),project:Type.Optional(Type.String()),name:Type.Optional(Type.String()),icon:Type.Optional(Type.String())}),async p=>{
      if(p.action==='run'||p.action==='close')await manageRuntime(p.action,p.id||library.project(p.project).id);
      else if(p.action==='create')library.create(p.kind,p.id,p.name,p.icon);
      else if(p.action==='update')library.update(p.project,{name:p.name,icon:p.icon});
      else if(p.action==='focus'){library.project(p.project);library.chat().primary=p.project;library.touch(p.project);}
      notify();return text(library.view());
    }),
    tool('render','Compile/mount one isolated native Preview. Targets appID or this chat primary app. Does not deploy.',Type.Object({appID}),async(p,signal)=>text(await render(signal,p.appID))),
    tool('inspect','Read the native tree and diagnostics. Defaults to this chat primary app and Preview. Failed renders remain inspectable.',Type.Object({surface,appID}),async(p,signal)=>text(await host('inspect',p,signal))),
    tool('screenshot','Capture actual native app/Preview pixels, not protected chat/account setup. Requires the foreground Android client.',Type.Object({surface,appID}),async(p,signal)=>{const r=await host('screenshot',p,signal);return {content:[{type:'text',text:JSON.stringify({title:`Native ${p.surface||'preview'} screenshot`,appID:r.appID,status:r.status,error:r.error,diagnostics:r.diagnostics,pendingTasks:r.pendingTasks})},{type:'image',data:r.image,mimeType:'image/png'}],details:undefined};}),
    tool('interact','Invoke a native component callback by testID, not an OS touch. Optional quiet-settlement tracks async handlers/plugin calls, not arbitrary future timers.',Type.Object({surface,appID,testID:Type.String(),event:choices(['press','changeText','valueChange']),value:Type.Optional(Type.Union([Type.String(),Type.Boolean()])),...settle}),async(p,signal)=>text(await host('interact',p,signal))),
    tool('deploy','Deploy the healthy immutable Preview of this chat primary app as a numbered release; resets component state, not durable storage.',empty,async()=>text(await requestDeploy())),
    tool('usage_query','Read automatic local raw native app taps/controls/visibility and separate model-test markers. No app instrumentation required. Missing encounters are useful non-use evidence, not proof of intent; consider retention and exposure.',Type.Object({appID:Type.Optional(Type.String()),after:Type.Optional(Type.Number()),limit:Type.Optional(Type.Integer({minimum:1,maximum:500}))}),p=>text(usage?usage.query(p):{events:[],unavailable:true})),
    tool('app_bridge_docs','Read fixed public bridge documentation and examples; no host path argument.',empty,()=>text(fs.readFileSync(new URL('../../docs/AGENT-BRIDGE.md',import.meta.url),'utf8'))),
    tool('app_describe','List exposed app ports/command schemas without their state. Specify appID and surface:live for a running app.',Type.Object({surface,appID}),async(p,signal)=>text(await host('app_describe',p,signal))),
    tool('app_inspect','Read JSON state explicitly exposed by useAgentPort; optional port limits the result.',Type.Object({surface,appID,port:Type.Optional(Type.String({maxLength:64}))}),async(p,signal)=>text(await host('app_inspect',p,signal))),
    tool('app_invoke','Invoke a declared app command with validated JSON arguments. Live effects may include service writes. Waits for its promise; quiet settlement defaults on.',Type.Object({surface,appID,port:Type.String({maxLength:64}),command:Type.String({maxLength:64}),args:Type.Optional(Type.Unknown()),...settle}),async(p,signal)=>text(await host('app_invoke',p,signal))),
    tool('app_data','Read/write durable public app data, not the credential vault. JSON values under 16 KiB.',Type.Object({appID:Type.String(),action:choices(['list','get','set','delete']),key:Type.Optional(Type.String()),value:Type.Optional(Type.Unknown())}),p=>text(library.data(p.appID,p.action,p.key,p.value))),
    tool('versions','List/read immutable releases, restore a draft, or activate an app/plugin release.',Type.Object({entity:choices(['app','plugin']),appID,action:choices(['list','read','restore_draft','activate']),plugin:Type.Optional(Type.String()),version:Type.Optional(Type.Integer({minimum:1})),path:Type.Optional(Type.String())}),async p=>{
      const id=p.entity==='app'?(p.appID||primaryApp()):p.plugin,target=p.entity==='app'?library.workspace(id):null,releases=target?target.releases:plugins.packages.get(id).releases;
      if(p.action==='list')return text(releases.list());
      if(p.action==='activate'){if(target)return text(await activateApp(id,p.version));const r=plugins.packages.activate(id,p.version);plugins.reload();notify();return text(r);}
      if(p.action==='restore_draft'){if(target)target.restoreDraft(p.version);else plugins.packages.restoreDraft(id,p.version);notify();return text('Copied source to draft; active release unchanged.');}
      const release=releases.read(p.version);if(!p.path||!Object.hasOwn(release.files,p.path))throw new Error('Supply a path in this release');return text(release.files[p.path]);
    }),
    tool('plugins_list','Discover published service packages and authoring workspaces. Accounts are separate plugin_instances.',empty,()=>text({plugins:plugins.list().map(p=>({id:p.id,name:p.name,release:p.release,description:p.description})),workspaces:plugins.packages.list()})),
    tool('plugin_docs','Read the active package API/recipe plus current host primitives (with exact auth configuration examples) and bundledExample manifest, even if a user project shadows that shipped example. Examples are reference source, not installed updates. Never credentials. Calls require an INSTANCE ID.',Type.Object({id:Type.String()}),p=>text(plugins.docs(p.id))),
    tool('plugin_instances','List/open account/config instances. Idempotent per app/package/slot; first connection opens protected setup. No credential-management operations.',Type.Object({action:choices(['list','open']),plugin:Type.Optional(Type.String()),appID,slot:Type.Optional(Type.String()),label:Type.Optional(Type.String()),origins:Type.Optional(Type.Array(Type.String()))}),p=>text(p.action==='list'?plugins.instances.list():plugins.instances.open(p.plugin,Object.fromEntries(Object.entries({slot:p.slot,label:p.label,origins:p.origins}).filter(([,v])=>v!==undefined)),p.appID||primaryApp()))),
    tool('plugin_call','Call a plugin INSTANCE from the agent; service data enters model context. No extra sandbox grants. Credentials never enter model context.',Type.Object({id:Type.String(),method:Type.String(),args:Type.Optional(Type.Record(Type.String(),Type.Unknown()))}),async(p,signal)=>{const r=JSON.stringify(await plugins.call(p.id,p.method,p.args||{},{surface:'agent',signal}));return text(r.length>16000?r.slice(0,16000)+'\n[Truncated; read large datasets through app code.]':r);}),
    tool('plugin_files','Author virtual package source. Client JS runs in the app realm, never Node. list without id lists workspaces.',Type.Object({action:choices(['list','create','read','write','edit']),id:Type.Optional(Type.String()),path:Type.Optional(Type.String()),content:Type.Optional(Type.String()),oldText:Type.Optional(Type.String()),newText:Type.Optional(Type.String())}),p=>{
      const packages=plugins.packages;if(p.action==='list')return text(p.id?Object.keys(packages.get(p.id).files):packages.list());
      if(p.action==='create'){library.create('plugin',p.id);notify();return text('Created '+p.id);}
      if(p.action==='read')return text(packages.read(p.id,p.path));
      if(p.action==='write')packages.write(p.id,p.path,p.content);else packages.edit(p.id,p.path,p.oldText,p.newText);notify();return text('Saved draft; immutable releases unchanged.');
    }),
    tool('plugin_build','Validate the declarative recipe and compile its client. Not a network/device test or publication.',Type.Object({id:Type.String()}),async p=>text(await buildPlugin(p.id))),
    tool('plugin_publish','Build/publish an immutable package release. Existing account instances keep pinned recipes and credentials.',Type.Object({id:Type.String()}),async p=>{const built=await buildPlugin(p.id),r=plugins.packages.publish(p.id,built.hash);plugins.reload();notify();return text(r);}),
  ];
  const chat=library.chat(),sessionManager=chat.sessionFile&&fs.existsSync(chat.sessionFile)?SessionManager.open(chat.sessionFile):SessionManager.create(dataDir,path.join(dataDir,'chats',chat.id,'sessions'));chat.sessionFile=sessionManager.getSessionFile();library.save();
  const systemPrompt=sandboxPrompt+`\nInitial chat primary: ${chat.primary||'none'}. Call projects for current primary and working set. Focus a newly created project before using relative paths if this chat already had a primary.`;
  const projectTools=new ProjectTools();
  const extensionLoader=new DefaultResourceLoader({cwd:dataDir,agentDir:dataDir,settingsManager:SettingsManager.inMemory({packages:[],extensions:[]}),noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[pi=>projectTools.bind(pi)]});
  await extensionLoader.reload();
  if(extensionLoader.getExtensions().errors.length)throw new Error('Unable to initialize Pi project tool adapter');
  const resourceLoader={getExtensions:()=>extensionLoader.getExtensions(),getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>({agentsFiles:[]}),getSystemPrompt:()=>systemPrompt,getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources(){},reload:async()=>{}};
  const models=()=>modelRuntime.getModels('openai-codex'),requestedID=process.env.MORPH_MODEL||process.env.PI_MODEL;
  const model=models().find(m=>m.id===requestedID)||models().find(m=>m.id==='gpt-5.4')||models()[0];
  const {session}=await createAgentSession({cwd:dataDir,agentDir:dataDir,modelRuntime,model,noTools:'builtin',excludeTools:['bash','powershell','grep','find','ls'],customTools:tools,resourceLoader,sessionManager,settingsManager:SettingsManager.inMemory({retry:{enabled:true,maxRetries:1},compaction:{enabled:true,modelOverrides:Object.fromEntries(models().filter(m=>m.id==='gpt-6.1-sol').map(m=>['openai-codex/'+m.id,{reserveTokens:Math.max(16384,m.contextWindow-250000)}]))},cacheWarming:'off'}),thinkingLevel:'medium'});
  await session.bindExtensions({});
  attachOpenAIWeb(session.agent,{onActivity:webActivity});
  return {session,modelRuntime,models,projectTools};
}
