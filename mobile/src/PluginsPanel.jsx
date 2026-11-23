import React,{useEffect,useState} from 'react';
import {View,Text,TextInput,Pressable,ScrollView,Modal,Linking,StyleSheet} from 'react-native';
const Button = ({title,onPress,disabled}) => <Pressable disabled={disabled} onPress={onPress} style={[s.button,disabled && {opacity:.35}]}><Text style={s.buttonText}>{title}</Text></Pressable>;
export function PluginsPanel({visible,focusedInstance,focusedPlugin,onClose,state,send,onEdit,builds,auth,error}) {
  const [selected,setSelected] = useState(null),[pkg,setPkg] = useState('public-http'),[slot,setSlot] = useState('account-2'),[label,setLabel] = useState(''),[secret,setSecret] = useState(''),[clientID,setClientID] = useState(''),[origins,setOrigins] = useState('');
  const rows = state.pluginInstances || [], instance = rows.find(r => r.id === selected), packages = state.plugins || [];
  useEffect(() => {if(visible && focusedInstance) setSelected(focusedInstance);},[visible,focusedInstance]);
  useEffect(() => {if(visible && focusedPlugin) setPkg(focusedPlugin);},[visible,focusedPlugin]);
  useEffect(() => {setSecret('');setClientID('');setOrigins((instance?.origins || []).join('\n'));},[selected]);
  const keyed = ['bearer','api-key','token-exchange'].includes(instance?.auth.type), needsSecret = instance?.auth.type === 'oauth2' && instance.auth.clientAuth !== 'none';
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><View style={s.modal}>
    <View style={s.row}><Text style={[s.heading,{flex:1}]}>Accounts & plugins</Text><Button title="Done" onPress={() => {setSecret('');setClientID('');onClose();}} /></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:16,paddingBottom:50}}>
      {!!error && <Text style={s.error}>{error}</Text>}
      <Text style={s.help}>The agent can work throughout Morph. Only this protected screen manages keys, OAuth registration and account connections. Apps store instance IDs, never these credentials. Connecting an account lets trusted app/agent code use its permitted service operations, including writes where the package/API allows them.</Text>
      <Text style={s.heading}>Plugin instances</Text>
      <ScrollView horizontal contentContainerStyle={{gap:8}}>{rows.map(r => <Button key={r.id} title={`${r.connected ? '●' : '○'} ${r.label}`} onPress={() => setSelected(r.id)} />)}</ScrollView>
      {instance && <View style={s.card}>
        <Text style={s.title}>{instance.label}</Text><Text selectable style={s.help}>{instance.plugin} · v{instance.version} · {instance.id}\nApp: {instance.ownerAppID || 'imported shared account'}\nPackage {instance.hash.slice(0,12)}</Text>
        <Text style={s.status}>{instance.connected ? 'Connected' : 'Connection required'} · separate account/configuration</Text>
        <Text style={s.help}>API origin(s), bound to this instance:</Text><TextInput value={origins} onChangeText={setOrigins} editable={!instance.connected && !!instance.network.configurable} style={s.field} multiline autoCapitalize="none" autoCorrect={false} />
        {instance.auth.type === 'oauth2' && <>
          <Text selectable style={s.help}>Authorize: {instance.auth.authorizationUrl}\nToken exchange: {instance.auth.tokenUrl}\nScopes: {instance.auth.scopes.join(', ')}\nClient authentication: {instance.auth.clientAuth || 'client_secret_post'}</Text>
          <Text style={s.help}>{instance.auth.setup}</Text><Text selectable style={s.text}>Register this callback:\n{instance.callbackURL}</Text>
          <TextInput value={clientID} onChangeText={setClientID} style={s.field} placeholder="OAuth client ID" placeholderTextColor="#8198a2" autoCapitalize="none" autoCorrect={false} />
        </>}
        {instance.auth.type === 'token-exchange' && <>
          <Text selectable style={s.help}>Private key sent only to: {instance.auth.exchange.url}\nHeader: {instance.auth.exchange.header} · prefix: {instance.auth.exchange.prefix || '(none)'}\nOnly the derived Bearer token goes to the API origin above. Tokens stay inside the host and renew on demand.</Text>
          <Text style={s.help}>{instance.auth.setup}</Text>
        </>}
        {(keyed || needsSecret) && <TextInput value={secret} onChangeText={setSecret} secureTextEntry style={s.field} placeholder={keyed ? 'Private API key / token' : 'OAuth client secret'} placeholderTextColor="#8198a2" autoCapitalize="none" autoCorrect={false} />}
        {instance.auth.type !== 'none' && <Button title={keyed ? 'Save private credential' : 'Save OAuth registration'} disabled={keyed ? !secret : !clientID || (needsSecret && !secret)} onPress={() => {
          send({type:'instance_configure',id:instance.id,config:{origins:origins.split(/[\n,]/).map(s => s.trim()).filter(Boolean),...(keyed ? {key:secret} : {clientID,...(needsSecret ? {clientSecret:secret} : {})})}});setSecret('');setClientID('');
        }} />}
        {instance.auth.type === 'oauth2' && <>
          {!instance.configured && rows.filter(r => r.id !== instance.id && r.plugin === instance.plugin && r.configured).map(r => <Button key={r.id} title={`Use OAuth registration from ${r.label}`} onPress={() => send({type:'instance_copy_registration',id:instance.id,from:r.id})} />)}
          <Text style={s.help}>Reusing registration does NOT copy account tokens. Connect each account separately.</Text>
          <Button title="Connect this account in browser ↗" disabled={!instance.configured} onPress={() => send({type:'instance_connect',id:instance.id})} />
          {auth?.id === instance.id && <Button title="Reopen sign-in ↗" onPress={() => Linking.openURL(auth.url)} />}
        </>}
        {instance.auth.type === 'token-exchange' && <Button title="Connect using private token exchange" disabled={!instance.configured || instance.connected} onPress={() => send({type:'instance_exchange',id:instance.id})} />}
        {instance.configured && instance.auth.type !== 'none' && <Button title="Disconnect this instance locally" onPress={() => send({type:'instance_disconnect',id:instance.id})} />}
        <Text style={s.help}>Prototype storage: private mode-0600 Termux files, not encrypted Android Keystore storage yet. Local disconnect does not revoke authorization at the provider. No other instance’s credentials are removed.</Text>
      </View>}
      <View style={s.card}><Text style={s.title}>Add another instance / account</Text>
        <ScrollView horizontal contentContainerStyle={{gap:8}}>{packages.map(p => <Button key={p.id} title={p.name} onPress={() => setPkg(p.id)} />)}</ScrollView>
        <Text style={s.help}>Package: {pkg}. A stable slot identifies one account binding within the app. Choose another slot for another account.</Text>
        <TextInput style={s.field} value={slot} onChangeText={setSlot} placeholder="work-account" placeholderTextColor="#8198a2" autoCapitalize="none" />
        <TextInput style={s.field} value={label} onChangeText={setLabel} placeholder="Optional label" placeholderTextColor="#8198a2" />
        <Button title="Create instance" disabled={!slot} onPress={() => send({type:'instance_create',plugin:pkg,options:{slot,...(label ? {label} : {})},appID:state.library?.activeApp})} />
      </View>
      <Text style={s.heading}>Package source & releases</Text>
      <Text style={s.help}>Packages define the shared code and service recipe. Instances pin a release and keep their own configuration/tokens. Publishing source never silently moves credentials to a new provider or origin.</Text>
      {(state.pluginWorkspaces || []).map(w => <View key={w.id} style={s.card}><Text style={s.title}>{w.id}</Text>
        <View style={s.row}><Button title="Files" onPress={() => onEdit(w.id)} /><Button title="Build" disabled={state.busy} onPress={() => send({type:'plugin_build',plugin:w.id})} /><Button title="Publish version" disabled={state.busy || builds[w.id]?.hash !== w.draftID} onPress={() => send({type:'plugin_publish',plugin:w.id,hash:w.draftID})} /></View>
        {builds[w.id] && <Text style={s.help}>{builds[w.id].hash === w.draftID ? 'Current draft compiled; not API-tested.' : 'Draft changed since build.'}</Text>}
        {[...w.history.entries].reverse().map(v => <View key={v.version} style={s.row}><Text style={[s.help,{flex:1}]}>v{v.version}{w.history.active === v.version ? ' · selected' : ''} {v.label}</Text><Button title="Select" disabled={state.busy || w.history.active === v.version} onPress={() => send({type:'plugin_activate',plugin:w.id,version:v.version})} /></View>)}
      </View>)}
    </ScrollView>
  </View></Modal>;
}
const s = StyleSheet.create({modal:{flex:1,paddingTop:46,paddingHorizontal:18,backgroundColor:'#0a1219'},row:{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:12},heading:{fontSize:23,color:'#edf4ee',fontWeight:'700'},title:{fontSize:16,color:'#edf4ee',fontWeight:'600'},card:{padding:16,borderRadius:14,gap:12,backgroundColor:'#14242e'},help:{fontSize:11,lineHeight:18,color:'#91aab3'},text:{fontSize:13,color:'#dce9e5'},status:{fontSize:12,color:'#7de2ce'},field:{padding:12,backgroundColor:'#0b1821',color:'#e2efea',borderRadius:10,fontSize:12},button:{padding:11,backgroundColor:'#2a434b',borderRadius:10},buttonText:{color:'#b5e5d7',fontSize:11,fontWeight:'600'},error:{color:'#ffb3ab',fontSize:12}});
