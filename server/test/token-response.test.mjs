import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readResponse} from '../src/plugin-network.mjs';

test('real exchange body reader supports bounded text without weakening ordinary JSON responses', async()=>{
  const text='header.payload.signature';
  assert.equal(await readResponse(new Response(text,{headers:{'content-type':'application/jwt'}}),'text'),text);
  await assert.rejects(readResponse(new Response(text)),/did not return JSON/);
  assert.deepEqual(await readResponse(new Response('{"ok":true}',{headers:{'content-type':'application/json'}})),{ok:true});
  await assert.rejects(readResponse(new Response('{not-json}',{headers:{'content-type':'application/json'}})),/invalid JSON/);
  assert.equal((await readResponse(new Response('x'.repeat(16000)),'text')).length,16000);
  for(const body of ['x'.repeat(16001),'é'.repeat(8001)])await assert.rejects(readResponse(new Response(body),'text'),/output limit/);
  await assert.rejects(readResponse(new Response('"'+'x'.repeat(256*1024)+'"',{headers:{'content-type':'application/json'}})),/output limit/);
  const chunks=[new Uint8Array(10000),new Uint8Array(6001)];let cancelled=false;
  const stream=new ReadableStream({pull(controller){if(chunks.length)controller.enqueue(chunks.shift());},cancel(){cancelled=true;}});
  await assert.rejects(readResponse(new Response(stream),'text'),/output limit/);assert.equal(cancelled,true,'oversized stream is cancelled');
  const failed=new Response('PRIVATE-RESPONSE-BODY',{status:401});
  await assert.rejects(readResponse(failed,'text'),e=>e.message==='Remote service returned HTTP 401');assert.equal(failed.bodyUsed,true);
  assert.equal(await readResponse(new Response(null,{status:204}),'text'),null);
});
