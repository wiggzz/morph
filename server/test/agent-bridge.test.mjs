import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeCapabilities} from '../src/runtime-capabilities.mjs';
import {AgentBridge,appPrompt,APP_PROMPT_PREFIX} from '../src/agent-bridge.mjs';
import {chatTranscript} from '../src/chat-presentation.mjs';
function setup(){const capabilities=new RuntimeCapabilities({});let time=Date.now();return {capabilities,bridge:new AgentBridge({capabilities,now:()=>time}),advance:ms=>time+=ms};}
test('sandbox messaging preserves native provenance and returns a receipt, never an agent answer',()=>{
  const {bridge,capabilities}=setup();const token=capabilities.issue('live',{appID:'first',id:'source-v1',version:1});
  const receipt=bridge.requestMessage(token,{text:'Summarize selection',context:{selected:['123']},source:{surface:'preview',appID:'forged'}});
  assert.equal(receipt.status,'queued');assert.equal(receipt.source.appID,'first');assert.equal(receipt.prompt,undefined);
  assert.equal(JSON.stringify(bridge.pending()).includes(token),false);
  const accepted=bridge.decide(receipt.requestId,'approve');const envelope=JSON.parse(accepted.prompt.slice(APP_PROMPT_PREFIX.length));
  assert.deepEqual(envelope.context,{selected:['123']});assert.match(envelope.instruction,/Credential\/OAuth management remains protected/);assert.throws(()=>bridge.decide(receipt.requestId,'approve'),/handled/);
});
test('sandbox live read/control and app links are free, but replaced/disconnected actors cannot act',()=>{
  const {bridge,capabilities}=setup();const a=capabilities.issue('live',{appID:'a',id:'v1'}),b=capabilities.issue('live',{appID:'b',id:'v2'});
  assert.equal(bridge.authorize('live','read','a'),null);assert.equal(bridge.authorize('live','control','b'),null);assert.equal(bridge.authorizeLink(a,'b','control'),null);assert.equal(bridge.pending().length,0);
  capabilities.issue('live',{appID:'a',id:'new'});assert.throws(()=>bridge.authorizeLink(a,'b','read'),/replaced/);assert.equal(capabilities.record(b).appID,'b');
  capabilities.clear();assert.throws(()=>bridge.authorize('live','read','b'),/No active/);
});
test('receipts expire, stale sources cannot enqueue, and input/rate limits remain in force',()=>{
  const {bridge,capabilities,advance}=setup();const token=capabilities.issue('preview',{appID:'a',id:'draft'});
  assert.throws(()=>bridge.requestMessage(token,{text:''}),/characters/);assert.throws(()=>bridge.requestMessage(token,{text:'a'.repeat(4001)}),/characters/);assert.throws(()=>bridge.requestMessage(token,{text:'Help',context:'x'.repeat(12001)}),/12 KiB/);
  const first=bridge.requestMessage(token,{text:'Help'});advance(600001);assert.throws(()=>bridge.decide(first.requestId,'approve'),/expired/);
  for(let i=0;i<4;i++){const r=bridge.requestMessage(token,{text:'Help '+i});bridge.decide(r.requestId,'approve');}assert.throws(()=>bridge.requestMessage(token,{text:'Too many'}),/Too many/);
  capabilities.issue('preview',{id:'new'});assert.throws(()=>bridge.requestMessage(token,{text:'Stale'}),/replaced/);
});
test('human chat shows app request text without dumping context while the model retains task data',()=>{
  const prompt=appPrompt({source:{appID:'a',surface:'live',snapshotID:'v1'},text:'Help with selection',context:{privateDetail:'task data'}});
  const human=chatTranscript([{role:'user',content:prompt,timestamp:5}]);assert.equal(human[0].text,'From app (live): Help with selection');assert.equal(JSON.stringify(human).includes('task data'),false);assert.match(prompt,/task data/);
});
