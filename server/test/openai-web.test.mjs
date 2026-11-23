import {test} from 'node:test';
import assert from 'node:assert/strict';
import {streamSimple} from '@earendil-works/pi-ai/api/openai-codex-responses';
import {withOpenAIWeb,citeWebText,attachOpenAIWeb} from '../src/openai-web.mjs';
const model={provider:'openai-codex',api:'openai-codex-responses',id:'gpt-6.1-sol',baseUrl:'https://chatgpt.com/backend-api',name:'Test',reasoning:true,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:500000,maxTokens:32000};
test('hosted web tools preserve restricted sandbox functions and are added once, only for OpenAI APIs',()=>{
  const p={tools:[{type:'function',name:'read'}],instructions:'protected',store:false};
  const next=withOpenAIWeb(p,model);assert.equal(next.tools[0],p.tools[0]);assert.deepEqual(next.tools[1],{type:'web_search',external_web_access:true});assert.equal(next.instructions,'protected');assert.equal(p.tools.length,1);assert.equal(withOpenAIWeb(next,model),next);
  assert.equal(withOpenAIWeb(p,{provider:'other',api:'openai-completions'}),p);assert.equal(withOpenAIWeb(p,{provider:'openai',api:'openai-responses',baseUrl:'https://proxy.example'}),p);assert.equal(withOpenAIWeb(p,{provider:'openai',api:'openai-responses',baseUrl:'https://api.openai.com/v1'}).tools.length,2);
});
test('citations preserve existing Markdown, bridge native markers and reject unsafe source URLs',()=>{
  const part={type:'output_text',text:'A fact. citeturn0search0',annotations:[{type:'url_citation',url:'https://example.com/docs(a)',title:'Docs [official]'}, {type:'url_citation',url:'javascript:alert(1)',title:'No'}, {type:'url_citation',url:'https://user:secret@example.com',title:'No'}]};
  citeWebText(part);assert.equal(part.text.includes('cite'),false);assert.match(part.text,/Sources:/);assert.match(part.text,/https:\/\/example.com\/docs%28a%29/);assert.equal(part.text.includes('javascript:'),false);assert.equal(part.text.includes('secret'),false);const once=part.text;citeWebText(part);assert.equal(part.text,once);
  const md={type:'output_text',text:'See [docs](https://example.com/).',annotations:[{type:'url_citation',url:'https://example.com/',title:'Docs'}]};citeWebText(md);assert.equal(md.text,'See [docs](https://example.com/).');
});
test('request/event hooks compose and only expose compact activity, never queries or provider reasoning',async()=>{
  const seen=[],prior=[],agent={onPayload:async p=>({...p,instructions:'prior hook'}),onProviderStreamEvent:async e=>prior.push(e.type)};attachOpenAIWeb(agent,{onActivity:s=>seen.push(s)});
  assert.equal((await agent.onPayload({tools:[]},model)).instructions,'prior hook');
  await agent.onProviderStreamEvent({type:'response.web_search_call.searching',query:'do not show raw queries'},model);await agent.onProviderStreamEvent({type:'response.web_search_call.searching'},model);await agent.onProviderStreamEvent({type:'response.completed'},model);
  assert.deepEqual(seen,['Browsing the web…',null]);assert.equal(prior.length,3);assert.equal(JSON.stringify(seen).includes('query'),false);
});
test('real Codex SSE adapter accepts hosted search/page events and persists readable citations in normalized text (mock transport)',async()=>{
  const activities=[],agent={};attachOpenAIWeb(agent,{onActivity:s=>activities.push(s)});
  const part={type:'output_text',text:'Verified public documentation. citeturn0search0',annotations:[{type:'url_citation',url:'https://example.com/docs',title:'Documentation'}]};
  const message={type:'message',id:'m1',role:'assistant',phase:'final_answer',content:[part]};
  const events=[
    {type:'response.created',response:{id:'r1'}},
    {type:'response.output_item.added',output_index:0,item:{type:'web_search_call',id:'w1',action:{type:'search'}}},
    {type:'response.web_search_call.searching',item_id:'w1',output_index:0},
    {type:'response.output_item.done',output_index:0,item:{type:'web_search_call',id:'w1',status:'completed',action:{type:'open_page',url:'https://example.com/docs'}}},
    {type:'response.output_item.added',output_index:1,item:{...message,content:[]}},
    {type:'response.output_text.delta',output_index:1,content_index:0,delta:part.text},
    {type:'response.output_item.done',output_index:1,item:message},
    {type:'response.completed',response:{id:'r1',status:'completed',end_turn:true,output:[message],usage:{input_tokens:2,output_tokens:8,total_tokens:10}}},
  ];
  let payload;
  const token='x.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fake-account'}})).toString('base64url')+'.x';
  const result=await streamSimple(model,{messages:[{role:'system',content:'Protected Morph prompt',timestamp:0,toolsAdded:[{name:'read',description:'Virtual source only',parameters:{type:'object',properties:{}}}]},{role:'user',content:'Research public docs',timestamp:1}]},{apiKey:token,reasoning:'low',transport:'sse',maxRetries:0,onPayload:async(p,m)=>{payload=await agent.onPayload(p,m);return payload;},onProviderStreamEvent:agent.onProviderStreamEvent,fetch:async()=>{return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});}}).result();
  assert.equal(result.stopReason,'stop',result.errorMessage);assert.ok(payload.tools.some(t=>t.type==='web_search'));assert.ok(payload.tools.some(t=>t.name==='read'));const text=result.content.filter(c=>c.type==='text').map(c=>c.text).join('');assert.match(text,/\[Documentation\]\(https:\/\/example.com\/docs\)/);assert.equal(text.includes('cite'),false);assert.deepEqual(activities,['Browsing the web…',null]);
});
