import React, {memo,useMemo} from 'react';
import {View,Text,ScrollView,StyleSheet,Platform,Linking,Alert} from 'react-native';
import {parseChatMarkdown,chatLink} from './chatMarkdownParser';

function openLink(url) {
  const safe = chatLink(url);
  if (safe) Linking.openURL(safe).catch(()=>Alert.alert('Could not open link','Please try opening it in your browser.'));
}
function inline(nodes,path) {
  return nodes.map((n,i)=>{
    const key=path+'.'+i, children=()=>inline(n.children,key);
    if (n.type==='text') return n.content;
    if (n.type==='softbreak'||n.type==='hardbreak') return '\n';
    if (n.type==='code_inline') return <Text key={key} selectable style={s.inlineCode}>{n.content}</Text>;
    if (n.type==='strong'||n.type==='em'||n.type==='s') return <Text key={key} selectable style={n.type==='strong'?s.bold:n.type==='em'?s.italic:s.strike}>{children()}</Text>;
    if (n.type==='link') {
      const url=chatLink(n.attrs?.href);
      return <Text key={key} selectable style={url?s.link:undefined} accessibilityRole={url?'link':undefined} accessibilityHint={url?'Opens in your browser':undefined} onPress={url?()=>openLink(url):undefined}>{children()}</Text>;
    }
    if (n.type==='image') {
      const url=chatLink(n.attrs?.src);
      return <Text key={key} selectable style={url?s.link:s.muted} accessibilityRole={url?'link':undefined} onPress={url?()=>openLink(url):undefined}>[Image: {n.content||'image'}]</Text>;
    }
    return <Text key={key} selectable>{n.children?.length?children():n.content}</Text>;
  });
}
function block(n,key) {
  const children=()=>n.children.map((child,i)=>block(child,key+'.'+i));
  if (n.type==='paragraph'||n.type==='heading') {
    const level=n.type==='heading'?Number(n.tag.slice(1)):0;
    return <Text key={key} selectable accessibilityRole={level?'header':undefined} style={[s.text,level?s['h'+level]:n.hidden?s.tight:s.paragraph]}>{n.children.map((child,i)=>child.type==='inline'?inline(child.children,key+'.'+i):child.content)}</Text>;
  }
  if (n.type==='fence'||n.type==='code_block') return <View key={key} style={s.codeBlock}>
    {!!n.info?.trim()&&<Text style={s.language}>{n.info.trim().split(/\s/)[0].slice(0,32)}</Text>}
    <ScrollView horizontal nestedScrollEnabled contentContainerStyle={s.codeScroll}><Text selectable style={s.code}>{n.content.replace(/\n$/,'')}</Text></ScrollView>
  </View>;
  if (n.type==='bullet_list'||n.type==='ordered_list') {
    const start=Number(n.attrs?.start)||1;
    return <View key={key} style={s.list}>{n.children.map((item,i)=><View key={key+'.'+i} style={s.listItem}>
      <Text style={[s.text,s.marker]}>{n.type==='ordered_list'?`${start+i}.`:'•'}</Text><View style={s.listContent}>{item.children.map((child,j)=>block(child,key+'.'+i+'.'+j))}</View>
    </View>)}</View>;
  }
  if (n.type==='blockquote') return <View key={key} style={s.quote}>{children()}</View>;
  if (n.type==='hr') return <View key={key} style={s.hr}/>;
  if (n.type==='table') return <ScrollView key={key} horizontal nestedScrollEnabled style={s.tableScroll}><View style={s.table}>{children()}</View></ScrollView>;
  if (n.type==='thead'||n.type==='tbody') return <View key={key}>{children()}</View>;
  if (n.type==='tr') return <View key={key} style={s.tableRow}>{children()}</View>;
  if (n.type==='th'||n.type==='td') {
    const align=n.attrs?.style==='text-align:right'?'right':n.attrs?.style==='text-align:center'?'center':'left';
    return <View key={key} style={[s.cell,n.type==='th'&&s.headerCell]}><Text selectable style={[s.text,{textAlign:align},n.type==='th'&&s.bold]}>{n.children.map((child,i)=>child.type==='inline'?inline(child.children,key+'.'+i):child.content)}</Text></View>;
  }
  if (n.type==='inline') return <Text key={key} selectable style={s.text}>{inline(n.children,key)}</Text>;
  return n.children?.length?<View key={key}>{children()}</View>:<Text key={key} selectable style={s.text}>{n.content}</Text>;
}
export const ChatMarkdown = memo(function ChatMarkdown({text}) {
  const nodes=useMemo(()=>parseChatMarkdown(text),[text]);
  return <View style={s.body}>{nodes.map((node,i)=>block(node,String(i)))}</View>;
});
const mono=Platform.OS==='ios'?'Menlo':'monospace';
const s=StyleSheet.create({
  body:{minWidth:0,alignSelf:'stretch'},text:{color:'#e1e9e8',fontSize:14,lineHeight:21},paragraph:{marginBottom:7},tight:{marginBottom:3},
  h1:{fontSize:23,lineHeight:29,fontWeight:'700',marginTop:10,marginBottom:9},h2:{fontSize:20,lineHeight:26,fontWeight:'700',marginTop:9,marginBottom:8},h3:{fontSize:17,lineHeight:23,fontWeight:'700',marginTop:8,marginBottom:6},h4:{fontSize:15,lineHeight:22,fontWeight:'700',marginTop:7,marginBottom:5},h5:{fontSize:14,lineHeight:21,fontWeight:'700',marginTop:6,marginBottom:4},h6:{fontSize:14,lineHeight:21,fontWeight:'700',marginTop:6,marginBottom:4},
  bold:{fontWeight:'700'},italic:{fontStyle:'italic'},strike:{textDecorationLine:'line-through'},link:{color:'#7de2ce',textDecorationLine:'underline'},muted:{color:'#a4b8c0'},
  inlineCode:{fontFamily:mono,fontSize:12,backgroundColor:'#0c1922',color:'#b4efdf'},codeBlock:{backgroundColor:'#0c1922',borderRadius:9,marginVertical:6,overflow:'hidden'},language:{color:'#8ea4ae',fontSize:10,paddingHorizontal:11,paddingTop:8},codeScroll:{padding:11,flexGrow:1},code:{fontFamily:mono,fontSize:12,lineHeight:19,color:'#d9eae5'},
  list:{marginVertical:4},listItem:{flexDirection:'row',alignItems:'flex-start',marginBottom:3},marker:{minWidth:20,marginRight:6},listContent:{flex:1,minWidth:0},quote:{borderLeftWidth:3,borderLeftColor:'#568879',paddingLeft:11,marginVertical:6},hr:{height:1,backgroundColor:'#36505a',marginVertical:12},
  tableScroll:{marginVertical:7},table:{borderTopWidth:1,borderLeftWidth:1,borderColor:'#36505a'},tableRow:{flexDirection:'row'},cell:{width:150,padding:8,borderRightWidth:1,borderBottomWidth:1,borderColor:'#36505a'},headerCell:{backgroundColor:'#21363e'},
});
