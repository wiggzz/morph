// A read-only display projection of Pi messages. Never provider metadata or thinking blocks.
const bounded=(value,limit)=>{if(value===undefined)return undefined;const text=JSON.stringify(value);return text&&Buffer.byteLength(text)<=limit?JSON.parse(text):undefined;};
export function viewMessage(message){
  if(!message||!['user','assistant','toolResult'].includes(message.role))return null;
  const content=(typeof message.content==='string'?[{type:'text',text:message.content}]:message.content||[]).flatMap(block=>{
    if(block.type==='text')return [{type:'text',text:String(block.text||'').slice(0,18000)}];
    if(block.type==='toolCall'){const args=bounded(block.arguments,8000);return [{type:'toolCall',id:block.id,name:block.name,arguments:args||{}}];}
    if(block.type==='image')return [{type:'text',text:'[Image omitted from display projection]'}];
    return [];
  });
  const result={role:message.role,content,timestamp:message.timestamp||0};
  if(message.role==='assistant'){if(message.stopReason)result.stopReason=message.stopReason;if(message.errorMessage)result.errorMessage=String(message.errorMessage).slice(0,1000);}
  if(message.role==='toolResult')Object.assign(result,{toolCallId:message.toolCallId,toolName:message.toolName,isError:!!message.isError,details:bounded(message.details,16000),structuredContent:bounded(message.structuredContent,16000)});
  return result;
}
export function chatView(messages,streaming=null,event=null){
  const source=[...messages];if(streaming && !(source.at(-1)?.role==='assistant'&&source.at(-1)?.timestamp===streaming.timestamp))source.push(streaming);
  const kept=[];let size=0,truncated=false;
  for(const message of source.slice(-100).reverse()){
    const safe=viewMessage(message);if(!safe)continue;const length=Buffer.byteLength(JSON.stringify(safe));
    if(size+length>192000){truncated=true;break;}size+=length;kept.unshift(safe);
  }
  const safeEvent=event?{type:event.type,toolCallId:event.toolCallId,toolName:event.toolName,isError:event.isError}:null;
  if(safeEvent&&event.partialResult)safeEvent.partialResult=bounded(event.partialResult,16000);
  if(safeEvent&&event.result)safeEvent.result=bounded(event.result,16000);
  return {messages:kept,event:safeEvent,truncated:truncated||source.length>100};
}
