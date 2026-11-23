import React,{createContext,useContext,useRef,useCallback} from 'react';
import {View,Text,TextInput,Pressable,ScrollView,ActivityIndicator} from 'react-native';
import {ChatMarkdown} from './ChatMarkdown';
export const ChatHostContext=createContext(null);
const exampleMessages=[{role:'user',text:'Let’s build something useful.'},{role:'assistant',text:'This is a **preview** of your editable chat. Real messages and sending remain host-managed.'}];
export function ChatMessages({style,userStyle,assistantStyle}) {
  const c=useContext(ChatHostContext),scroll=useRef(null);
  const messages=c?.preview?exampleMessages:c?.messages||[];
  return <ScrollView ref={scroll} style={[{flex:1,minHeight:0},style]} contentContainerStyle={{padding:14,gap:12}} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onContentSizeChange={()=>scroll.current?.scrollToEnd({animated:!c?.preview})}>
    {!messages.length && <Text style={{color:'#90a7b0'}}>What would you like to build?</Text>}
    {messages.map((m,i)=><View key={i} style={[{padding:10,borderRadius:12,backgroundColor:m.role==='user'?'#243d3d':'#14222c'},m.role==='user'?userStyle:assistantStyle]}>
      <Text style={{color:'#90a7b0',fontSize:10,marginBottom:5}}>{m.role==='user'?'You':'Morph'}</Text><ChatMarkdown text={m.text}/>
    </View>)}
  </ScrollView>;
}
export function ChatStatus({style}) {
  const c=useContext(ChatHostContext);
  return <View style={[{flexDirection:'row',gap:8},style]}>{c?.busy && <ActivityIndicator size="small" color="#7de2ce"/>}<Text style={{color:'#90a7b0',fontSize:11}}>{c?.preview?'Preview · sending disabled':c?.activity||(!c?.connected?'Offline':'Ready')}</Text></View>;
}
export function ChatComposer({style,placeholder,inputStyle,buttonStyle}) {
  const c=useContext(ChatHostContext),ownedRef=useRef(null),composerRef=c?.keyboard?.composerRef;
  const setComposer=useCallback(node=>{
    if(composerRef) {if(node)composerRef.current=node;else if(composerRef.current===ownedRef.current)composerRef.current=null;}
    ownedRef.current=node;
  },[composerRef]);
  return <View ref={c?.preview?undefined:setComposer} collapsable={false} onLayout={c?.preview?undefined:c?.keyboard?.onComposerLayout} style={[{flexDirection:'row',gap:8,alignItems:'center'},style]}>
    <TextInput testID="host-chat-input" style={[{flex:1,minHeight:44,maxHeight:110,padding:10,color:'#f4f3ec',backgroundColor:'#0e1b23',borderRadius:10},inputStyle]} value={c?.preview?'Preview composer':c?.draft||''} editable={!c?.preview} onChangeText={c?.preview?undefined:c?.setDraft} multiline maxLength={32000} placeholder={placeholder||'Message Morph'} placeholderTextColor="#78909a" />
    <Pressable testID="host-chat-send" accessibilityLabel="Send message to Morph" disabled={c?.preview||!c?.connected||c?.busy||!c?.draft?.trim()} onPress={c?.preview?undefined:c?.submit} style={[{padding:12,borderRadius:10,backgroundColor:'#7de2ce'},buttonStyle,{opacity:c?.preview||c?.busy||!c?.connected||!c?.draft?.trim() ? .65:1}]}><Text style={{color:'#10242a',fontWeight:'700'}}>Send ↑</Text></Pressable>
  </View>;
}
const Markdown=({value})=><ChatMarkdown text={value||''}/>;
function ChatScrollView({children,style,contentContainerStyle}){const ref=useRef(null);return <ScrollView ref={ref} style={style} contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onContentSizeChange={()=>ref.current?.scrollToEnd({animated:true})}>{children}</ScrollView>;}
export const chatNative={ChatMessages,ChatComposer,ChatStatus,ChatMarkdown:Markdown,ChatScrollView};
