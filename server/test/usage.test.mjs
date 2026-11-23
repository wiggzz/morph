import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {UsageLog} from '../src/usage.mjs';
test('automatic usage log is raw, bounded, persisted, scoped and omits arbitrary content',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'morph-usage-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const log=new UsageLog(directory);t.after(()=>clearTimeout(log.timer));const runtime={appID:'example',snapshotID:'release1',surface:'live'};
 log.record(runtime,{event:'press',testID:'open',text:'SECRET',value:'SECRET',appID:'forged'});log.record(runtime,{event:'test',testID:'open'});log.flush();const restored=new UsageLog(directory);assert.equal(restored.query().events[0].appID,'example');assert.equal(restored.query().events[1].origin,'automation');assert.doesNotMatch(JSON.stringify(restored.query()),/SECRET|forged/);assert.equal(restored.query({appID:'other'}).events.length,0);assert.equal(fs.statSync(log.file).mode&0o777,0o600);
 for(let i=0;i<2100;i++)log.record(runtime,{event:'tap',x:i});assert.equal(log.query({limit:500}).events.length,500);assert.equal(log.events.length,2000);log.flush();assert.throws(()=>log.record(runtime,{event:'input'}),/Unknown/);
});
