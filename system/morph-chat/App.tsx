import React,{useState} from 'react';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import {ChatComposer,ChatStatus,ChatScrollView,Markdown,useChat} from '@morph/chat';

function ToolCard({message}) {
  const [expanded,setExpanded]=useState(false);
  if(message.toolName==='chat_note'&&message.details?.note) return <View style={s.note}><Text style={s.label}>SAVED NOTE</Text><Markdown value={message.details.note}/></View>;
  const text=(message.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
  return <View style={s.tool}>
    <Pressable testID={'tool-'+message.toolCallId} onPress={()=>setExpanded(v=>!v)}><Text style={s.label}>{message.isError?'!':'✓'} {message.toolName} {expanded?'−':'＋'}</Text></Pressable>
    {expanded&&<Markdown value={text.slice(0,18000)}/>}
  </View>;
}
function Message({message}) {
  if(message.role==='toolResult') return <ToolCard message={message}/>;
  if(message.role==='assistant'&&(message.stopReason==='toolUse'||message.content?.some(block=>block.type==='toolCall')))return null;
  let text=(message.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('\n')||message.errorMessage||'',label=message.role==='user'?'You':'Morph';
  if(message.role==='user'&&text.startsWith('[Morph app request]\n')){try{const request=JSON.parse(text.slice('[Morph app request]\n'.length));if(typeof request.text==='string'){text=request.text;label='From app ('+(request.source?.surface||'unknown')+')';}}catch{}}
  if(!text)return null;
  return <View style={[s.message,message.role==='user'&&s.user]}><Text style={s.label}>{label}</Text><Markdown value={text.slice(0,18000)}/></View>;
}
export default function MorphChat() {
  const chat=useChat();
  return <View style={s.page}>
    <View style={s.heading}><Text style={s.title}>{chat.title||'Build together'}</Text><ChatStatus/></View>
    <ChatScrollView style={s.messages} contentContainerStyle={{padding:12,gap:10}}>
      {!chat.messages.length&&<Text style={s.label}>What would you like to build?</Text>}
      {chat.messages.map((message,i)=><Message key={message.toolCallId||i} message={message}/>)}
      {chat.truncated&&<Text style={s.label}>Recent messages shown. Safe mode keeps the original conversation view.</Text>}
    </ChatScrollView>
    <ChatComposer style={s.composer} placeholder="What shall we make?"/>
  </View>;
}
const s=StyleSheet.create({
  page:{flex:1,backgroundColor:'#14222c'},heading:{padding:12,gap:4,borderBottomWidth:1,borderColor:'#263b46'},
  title:{color:'#eaf4ee',fontSize:16,fontWeight:'700'},messages:{flex:1,minHeight:0},
  composer:{padding:10,borderTopWidth:1,borderColor:'#263b46'},message:{padding:10,gap:5},
  user:{backgroundColor:'#243d3d',borderRadius:12},label:{color:'#90a7b0',fontSize:11},
  tool:{padding:10,borderLeftWidth:2,borderColor:'#36505b',gap:8},note:{padding:14,borderRadius:12,backgroundColor:'#203c35',gap:8},
});
