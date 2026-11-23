// Pi ToolDefinition factories execute here, never in the credential-bearing Node process.
const tools=new Map(),running=new Map();
const post=value=>window.ReactNativeWebView.postMessage(JSON.stringify(value));
const copy=value=>JSON.parse(JSON.stringify(value));
const metadata=tool=>Object.fromEntries(['name','label','description','parameters','outputSchema','promptSnippet','promptGuidelines','annotations','defaultActive'].filter(k=>tool[k]!==undefined).map(k=>[k,tool[k]]));
export async function loadTools(factory) {
  if(typeof factory!=='function')throw new Error('/tools.ts must export a default Pi tool-registration factory');
  let loading=true;
  await factory({registerTool(definition){
    if(!definition||typeof definition.execute!=='function'||! /^[a-z][a-z0-9_]{0,63}$/.test(definition.name))throw new Error('Pi tool requires name and execute');
    if(!tools.has(definition.name)&&tools.size>=32)throw new Error('At most 32 project tools');
    const spec=copy(metadata(definition));
    if(JSON.stringify(spec).length>16000)throw new Error('Tool definition exceeds 16 KiB');
    tools.set(definition.name,definition);
    if(!loading)post({type:'pi_tools',tools:[...tools.values()].map(metadata)});
  }});
  loading=false;
  post({type:'pi_tools',tools:[...tools.values()].map(metadata)});
}
if(__MORPH_CHAT__) {
window.__morphPiCancel=requestId=>{running.get(requestId)?.abort();running.delete(requestId);};
window.__morphPiExecute=async request=>{
  const controller=new AbortController();running.set(request.requestId,controller);
  try {
    const tool=tools.get(request.name);if(!tool)throw new Error('Project tool is unavailable');
    const result=await tool.execute(request.toolCallId,copy(request.args),controller.signal,partial=>{
      if(!controller.signal.aborted)post({type:'pi_tool_update',requestId:request.requestId,result:copy(partial)});
    },Object.freeze({cwd:'/apps/morph-chat',signal:controller.signal}));
    if(!controller.signal.aborted)post({type:'pi_tool_result',requestId:request.requestId,result:copy(result)});
  } catch(error) {if(!controller.signal.aborted)post({type:'pi_tool_result',requestId:request.requestId,error:String(error.message||error).slice(0,2000)});}
  finally {running.delete(request.requestId);}
};
}
