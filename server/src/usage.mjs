import fs from 'node:fs';
import path from 'node:path';
export class UsageLog {
  constructor(directory){this.file=path.join(directory,'usage.json');try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));this.events=Array.isArray(saved)?saved.slice(-2000):[];}catch{this.events=[];}this.timer=null;}
  record(record,input){
    if(!['tap','press','toggle','shown','hidden','test'].includes(input?.event))throw new Error('Unknown usage event');
    const event={time:Date.now(),appID:record.appID,release:record.snapshotID,surface:record.surface,event:input.event,origin:input.event==='test'?'automation':'native'};
    for(const key of ['nodeID','testID','component'])if(typeof input[key]==='string')event[key]=input[key].slice(0,120);
    for(const key of ['x','y'])if(Number.isFinite(input[key]))event[key]=Math.round(input[key]);
    this.events.push(event);this.events=this.events.slice(-2000);if(!this.timer)this.timer=setTimeout(()=>this.flush(),500);
  }
  query({appID,after=0,limit=200}={}){const events=this.events.filter(e=>(!appID||e.appID===appID)&&e.time>after);return {retention:'Last 2000 events, local only; no events before capture began. No inference from missing events is definitive.',oldest:this.events[0]?.time||null,events:events.slice(-Math.max(1,Math.min(500,limit)))};}
  flush(){clearTimeout(this.timer);this.timer=null;try{fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.events),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}catch{/* Telemetry failure must not interrupt the app. */}}
}
