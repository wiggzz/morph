// Transport adapter only: registration, schema validation and model tool lifecycle belong to Pi.
const clone=value=>JSON.parse(JSON.stringify(value));
export function toolResult(value) {
  if(!value||!Array.isArray(value.content)||value.content.length>32)throw new Error('Return a Pi tool result {content,details}');
  if(Buffer.byteLength(JSON.stringify(value))>64000)throw new Error('Project tool result exceeds 64 KiB; truncate or save larger data in app storage');
  for(const block of value.content)if(!block||!((block.type==='text'&&typeof block.text==='string')||(block.type==='image'&&typeof block.data==='string'&&['image/png','image/jpeg','image/webp','image/gif'].includes(block.mimeType))))throw new Error('Invalid Pi text/image content');
  return clone(Object.fromEntries(['content','details','structuredContent','usage','isError','terminate'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]])));
}
export class ProjectTools {
  constructor(){this.entries=new Map();this.pi=null;this.reserved=new Set(['bash','powershell','grep','find','ls']);this.owned=new Set();}
  bind(pi){this.pi=pi;}
  sync(definitions,identity,execute) {
    if(!this.pi)throw new Error('Pi registration is not initialized');
    if(!Array.isArray(definitions)||definitions.length>32||Buffer.byteLength(JSON.stringify(definitions))>128000)throw new Error('At most 32 bounded Pi tool definitions');
    for(const t of this.pi.getAllTools())if(!this.owned.has(t.name))this.reserved.add(t.name);
    const names=new Set();
    for(const d of definitions){
      if(!d||! /^[a-z][a-z0-9_]{0,63}$/.test(d.name)||this.reserved.has(d.name)||names.has(d.name))throw new Error('Project tool name collides with a host tool or another definition');
      if(typeof d.description!=='string'||d.description.length>4000||!d.parameters||d.parameters.type!=='object'||Buffer.byteLength(JSON.stringify(d))>16000)throw new Error('Pi tool needs a bounded description and object parameters schema');
      if((d.label!==undefined&&(typeof d.label!=='string'||d.label.length>200))||(d.promptSnippet!==undefined&&(typeof d.promptSnippet!=='string'||d.promptSnippet.length>4000))||(d.promptGuidelines!==undefined&&(!Array.isArray(d.promptGuidelines)||d.promptGuidelines.length>16||d.promptGuidelines.some(v=>typeof v!=='string'||v.length>1000)))||(d.defaultActive!==undefined&&typeof d.defaultActive!=='boolean'))throw new Error('Invalid Pi tool presentation metadata');
      if(Object.keys(d).some(k=>!['name','label','description','parameters','outputSchema','promptSnippet','promptGuidelines','annotations','defaultActive'].includes(k)))throw new Error('Unsupported transported Pi definition field');
      names.add(d.name);
    }
    for(const name of [...this.entries.keys()])if(!names.has(name))this.hide(name);
    for(const d of definitions){
      const signature=JSON.stringify(d),old=this.entries.get(d.name);
      if(old?.identity===identity&&old.signature===signature)continue;
      old?.controller.abort();this.owned.add(d.name);const entry={identity,signature,definition:clone(d),controller:new AbortController()};this.entries.set(d.name,entry);
      this.pi.registerTool({...entry.definition,label:d.label||d.name,executionMode:'sequential',execute:async(id,args,signal,onUpdate)=>{
        if(this.entries.get(d.name)!==entry)throw new Error('Project tool release changed');
        if(Buffer.byteLength(JSON.stringify(args))>16000)throw new Error('Project tool arguments exceed 16 KiB; pass references or smaller batches');
        const combined=signal?AbortSignal.any([signal,entry.controller.signal]):entry.controller.signal;combined.throwIfAborted();
        const result=await execute(identity,d.name,id,args,combined,partial=>{combined.throwIfAborted();onUpdate?.(toolResult(partial));});
        combined.throwIfAborted();if(this.entries.get(d.name)!==entry)throw new Error('Project tool release changed');
        return toolResult(result);
      }});
    }
  }
  hide(name){const old=this.entries.get(name);if(!old)return;old.controller.abort();this.pi.registerTool({...old.definition,label:old.definition.label||name,exposure:'hidden',defaultActive:false,execute:async()=>{throw new Error('Project tool is unavailable');}});this.entries.delete(name);}
  clear(){for(const name of [...this.entries.keys()])this.hide(name);}
}
