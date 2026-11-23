import React, {useState} from 'react';
import {View,Text,Pressable,ScrollView,TextInput,Modal,Alert,StyleSheet} from 'react-native';
export function HomeScreen({library,runningApps = [],disabled,onOpen,onChat,onNewChat,onClose,onUpdate,onTrash,onRestore,onPurge}) {
  const [tab,setTab] = useState('Apps'), [editing,setEditing] = useState(null), [name,setName] = useState(''), [icon,setIcon] = useState('');
  const edit = (kind,p) => {setEditing({kind,...p});setName(p.name);setIcon(p.icon);};
  const button = (label,fn,danger = false) => <Pressable disabled={disabled} onPress={fn} style={s.action}><Text style={[s.link,danger && {color:'#ff9d9d'}]}>{label}</Text></Pressable>;
  const trash = p => Alert.alert('Move app to Trash?',`${p.name} will stop running. Its files, releases and saved data can be restored. Chats and connected accounts stay intact.`,[{text:'Cancel',style:'cancel'},{text:'Move to Trash',style:'destructive',onPress:()=>{setEditing(null);onTrash(p.id);setTab('Trash');}}]);
  const purge = p => Alert.alert('Permanently delete app?',`Delete ${p.name} and all its files, releases and saved data from Morph? This cannot be undone in Trash. Chats, connected accounts and separately retained backups are not deleted.`,[{text:'Cancel',style:'cancel'},{text:'Delete permanently',style:'destructive',onPress:()=>onPurge(p.id)}]);
  return <View style={s.page}>
    <View style={s.header}><View style={{flex:1}}><Text style={s.brand}>morph.</Text><Text style={s.muted}>Your apps. Your workshop.</Text></View><Pressable accessibilityLabel="New chat" disabled={disabled} onPress={onNewChat} style={s.plus}><Text style={s.plusText}>＋</Text></Pressable></View>
    <View style={s.tabs}>{['Apps','Plugins','Chats','Trash'].map(t => <Pressable key={t} onPress={() => setTab(t)} style={[s.tab,tab === t && s.selected]}><Text style={s.text}>{t === 'Trash' && library?.trash?.length ? `Trash (${library.trash.length})` : t}</Text></Pressable>)}</View>
    <ScrollView contentContainerStyle={{paddingBottom:100,gap:12}}>
      {tab === 'Apps' && <>
        <Text style={s.muted}>Tap to open. Build opens that app’s chat. Up to four live apps stay running while you use Home or chat.</Text>
        <View style={s.grid}>{[...(library?.systemApps || []),...(library?.apps || [])].map(p => {const running = runningApps.some(r => r.id === p.id);return <View key={p.id} style={s.tile}>
          <Pressable disabled={disabled} onPress={() => onOpen('app:'+p.id,false)} style={{gap:9}}><Text style={s.icon}>{p.icon}</Text><Text style={s.title}>{p.name}</Text><Text style={s.muted}>{running ? '● Running' : p.liveVersion ? 'v'+p.liveVersion : 'Draft'}</Text></Pressable>
          <View style={s.row}>{button('Build',() => onOpen('app:'+p.id,true))}{button('Edit',() => edit('app',p))}{running && !p.system && button('Close',() => onClose(p.id))}{!p.system && button('Delete',() => trash(p),true)}</View>
        </View>;})}</View>
      </>}
      {tab === 'Apps' && !library?.apps?.length && <Text style={s.muted}>No apps yet. Tap ＋ to start fresh, or restore an app from Trash.</Text>}
      {tab === 'Trash' && <>
        <Text style={s.muted}>Deleted apps stay here until you restore or permanently delete them. Chats and connected accounts are kept separately.</Text>
        {!library?.trash?.length && <Text style={s.muted}>Trash is empty.</Text>}
        {(library?.trash || []).map(p => <View key={p.id} style={s.item}><Text style={s.iconSmall}>{p.icon}</Text><View style={{flex:1}}><Text style={s.title}>{p.name}</Text><Text style={s.muted}>Deleted {new Date(p.deletedAt).toLocaleDateString()}</Text><View style={s.row}>{button('Restore',()=>onRestore(p.id))}{button('Delete permanently',()=>purge(p),true)}</View></View></View>)}
      </>}
      {tab === 'Plugins' && <><Text style={s.muted}>Reusable service packages. Files and releases belong to the plugin; account credentials stay protected.</Text>{(library?.plugins || []).map(p => <View key={p.id} style={s.item}><Text style={s.iconSmall}>{p.icon}</Text><View style={{flex:1}}><Text style={s.title}>{p.name}</Text><Text style={s.muted}>{p.path}</Text></View>{button('Build',() => onOpen('plugin:'+p.id,true))}{button('Edit',() => edit('plugin',p))}</View>)}</>}
      {tab === 'Chats' && <><Text style={s.muted}>Chats can work across projects. Their primary project gives relative file paths a home.</Text>{(library?.chats || []).map(c => <Pressable disabled={disabled} key={c.id} onPress={() => onChat(c.id)} style={s.item}><View style={{flex:1}}><Text style={s.title}>{c.title}</Text><Text style={s.muted}>{c.primary || 'No project yet'}{library?.trash?.some(p => c.primary === 'app:'+p.id) ? ' · In Trash' : ''}{c.projects.length > 1 ? ` · ${c.projects.length} projects` : ''}</Text></View><Text style={s.link}>↗</Text></Pressable>)}</>}
      <Text style={s.muted}>Start a chat with ＋ and describe an app or plugin. The builder creates its project; only account/credential setup needs protected input.</Text>
    </ScrollView>
    <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}><View style={s.scrim}><View style={s.sheet}>
      <Text style={s.title}>Project details</Text>
      <TextInput value={name} onChangeText={setName} maxLength={80} style={s.input} placeholder="Name" placeholderTextColor="#7e929c" />
      <TextInput value={icon} onChangeText={setIcon} maxLength={12} style={s.input} placeholder="Icon: emoji, glyph or initials" placeholderTextColor="#7e929c" />
      {editing?.kind === 'app' && <Text style={s.muted}>Apps can use any sandbox plugin instance. Each instance holds its own account/configuration. Manage credentials in Accounts & plugins; this project stores only instance IDs.</Text>}
      {editing?.kind === 'app' && !editing.system && button('Move to Trash',()=>trash(editing),true)}
      <View style={s.row}>{button('Save',() => {onUpdate(editing.kind+':'+editing.id,name,icon);setEditing(null);})}{button('Done',() => setEditing(null))}</View>
    </View></View></Modal>
  </View>;
}
const s = StyleSheet.create({page:{flex:1,padding:22,backgroundColor:'#101a22'},header:{flexDirection:'row',alignItems:'center',marginBottom:24},brand:{color:'#eaf4ee',fontWeight:'700',fontSize:36},muted:{color:'#8ea4ae',fontSize:11,lineHeight:17},plus:{backgroundColor:'#7de2ce',borderRadius:18,width:50,height:50,alignItems:'center',justifyContent:'center'},plusText:{fontSize:30,color:'#10242a'},tabs:{flexDirection:'row',gap:10,marginBottom:20},tab:{padding:10,borderRadius:10},selected:{backgroundColor:'#263943'},text:{color:'#dce8e5',fontSize:12},grid:{flexDirection:'row',flexWrap:'wrap',gap:12},tile:{backgroundColor:'#1a2b35',borderRadius:18,padding:16,width:'47%',gap:14},icon:{fontSize:34,color:'#b3efdf'},iconSmall:{fontSize:24,color:'#b3efdf'},title:{color:'#edf5ef',fontSize:14,fontWeight:'600'},row:{flexDirection:'row',alignItems:'center',gap:12,flexWrap:'wrap'},action:{paddingVertical:8},link:{color:'#7de2ce',fontSize:11},item:{padding:15,borderRadius:14,backgroundColor:'#1a2b35',flexDirection:'row',alignItems:'center',gap:12},scrim:{flex:1,backgroundColor:'#0009',justifyContent:'center',padding:24},sheet:{padding:22,borderRadius:20,backgroundColor:'#192b36',gap:16},input:{backgroundColor:'#0e1b24',color:'#e9f3ee',borderRadius:10,padding:12}});
