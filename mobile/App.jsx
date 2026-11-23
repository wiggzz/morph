import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, StyleSheet, StatusBar as NativeStatusBar, Platform, Linking, Keyboard, ActivityIndicator, Switch } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NativeSurface, setInteractionSink } from './src/NativeSurface';
import { PluginsPanel } from './src/PluginsPanel';
import { VersionsPanel } from './src/VersionsPanel';
import { useChatKeyboard } from './src/useChatKeyboard';
import { HomeScreen } from './src/HomeScreen';
import { ChatMarkdown } from './src/ChatMarkdown';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const TinyButton = ({ title, onPress, disabled, accent }) => <Pressable onPress={onPress} disabled={disabled} style={[s.button, accent && s.accent, disabled && { opacity: 0.35 }]}><Text style={[s.buttonText, accent && { color: '#10242a' }]}>{title}</Text></Pressable>;
export default function App() {
  const keyboard = useChatKeyboard(Platform.OS === 'android' ? NativeStatusBar.currentHeight || 24 : 50);
  const [url, setURL] = useState('ws://127.0.0.1:8787');
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_MORPH_TOKEN || '');
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState('Offline');
  const [state, setState] = useState({ models: [], files: {} });
  const [surface, setSurface] = useState('preview');
  const [homeOpen,setHomeOpen] = useState(true);
  const [runtimeApps,setRuntimeApps] = useState([]);
  const [frontApp,setFrontApp] = useState('my-app');
  const [chatOpen, setChatOpen] = useState(false);
  const [safeChat,setSafeChat] = useState(false);
  const [fullChat,setFullChat] = useState(false);
  const systemChat = useRef(null);
  const safeChatRef = useRef(false);safeChatRef.current=safeChat;
  const recoverChat=useCallback(()=>{safeChatRef.current=true;setSafeChat(true);},[]);
  const [chatView,setChatView]=useState({messages:[]});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [editingPlugin, setEditingPlugin] = useState(null);
  const [pluginBuilds, setPluginBuilds] = useState({});
  const [pluginAuth, setPluginAuth] = useState(null);
  const [focusedPlugin, setFocusedPlugin] = useState(null);
  const [focusedInstance,setFocusedInstance] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [tool, setTool] = useState('');
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [filename, setFilename] = useState('/App.tsx');
  const [source, setSource] = useState('');
  const socket = useRef(null);
  const preview = useRef(null);
  const live = useRef(Object.create(null));
  const liveQueues = useRef(new Map());
  const history = useRef(null);
  const operationQueue = useRef(Promise.resolve());
  const pluginRequests = useRef(new Map());
  const rpcSequence = useRef(0);
  const fileTarget = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAllowed = useRef(true);
  const connectRef = useRef(null);
  const connectionAttempt = useRef(0);
  const send = useCallback(message => {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Connect to the local service first'); return; }
    socket.current.send(JSON.stringify(message));
  }, []);
  useEffect(()=>{setInteractionSink(event=>{if(socket.current?.readyState===WebSocket.OPEN)send({type:'usage_event',...event});});return()=>setInteractionSink(null);},[send]);
  useEffect(()=>{if(safeChat){systemChat.current?.clear();if(connected)send({type:'system_chat_safe'});}},[safeChat,connected,send]);
  useEffect(() => {
    if (connected && state.layoutDiagnostics) send({ type: 'ui_layout', layout: keyboard.diagnostics });
  }, [connected, state.layoutDiagnostics, keyboard.diagnostics, send]);
  const onPluginCall = useCallback(request => new Promise((resolve, reject) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return reject(new Error('Local service disconnected'));
    if (pluginRequests.current.size >= 32) return reject(new Error('Too many pending plugin requests'));
    const id = 'rpc-' + Date.now() + '-' + (++rpcSequence.current);
    const timer = setTimeout(() => { pluginRequests.current.delete(id); reject(new Error('Plugin request timed out')); }, 28000);
    pluginRequests.current.set(id, { resolve: data => { clearTimeout(timer); resolve(data); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.current.send(JSON.stringify({ type: 'plugin_rpc', id, ...request }));
  }), []);
  const onAgentCall = useCallback(request => new Promise((resolve, reject) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return reject(new Error('Local service disconnected'));
    if (pluginRequests.current.size >= 32) return reject(new Error('Too many pending bridge requests'));
    const id = 'agent-rpc-' + (++rpcSequence.current);
    const timer = setTimeout(() => { pluginRequests.current.delete(id); reject(new Error('Agent receipt timed out')); }, 7500);
    pluginRequests.current.set(id, { resolve: data => { clearTimeout(timer); resolve(data); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.current.send(JSON.stringify({ type: 'agent_rpc', id, ...request }));
  }), []);
  const onAppCall = useCallback(request => new Promise((resolve,reject) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return reject(new Error('Service disconnected'));
    if (pluginRequests.current.size >= 32) return reject(new Error('Too many pending requests'));
    const id = 'app-rpc-' + (++rpcSequence.current);
    const timer = setTimeout(() => {pluginRequests.current.delete(id);reject(new Error('App call timed out'));},19000);
    pluginRequests.current.set(id,{resolve:data => {clearTimeout(timer);resolve(data);},reject:error => {clearTimeout(timer);reject(error);}});
    socket.current.send(JSON.stringify({type:'app_rpc',id,...request}));
  }),[]);
  const runHostRequest = async (message, ws) => {
    try {
      let result;
      const targetSurface = message.payload?.surface === 'live' ? 'live' : 'preview';
      const appID = message.payload?.appID || 'my-app';
      if (message.op === 'deploy' && appID!=='morph-chat' && !live.current[appID]) {
        setRuntimeApps(ids => ids.includes(appID) ? ids : [...ids,appID]);
        for (let i=0;i<50 && !live.current[appID];i++) await pause(20);
      }
      const target = targetSurface === 'live' ? appID==='morph-chat'?systemChat:{current:live.current[appID]} : preview;
      if(message.op==='chat_tool_execute') {
        if(safeChatRef.current)throw new Error('Native chat recovery is active');
        result=await systemChat.current.executeTool({...message.payload,requestId:message.id});
      } else if (message.op === 'render') {
        setSurface('preview'); if (!message.payload.background) setHomeOpen(false);
        result = await preview.current.load(message.payload);
      } else if (message.op === 'deploy' && appID==='morph-chat') {
        if(!safeChatRef.current) result = await systemChat.current.load(message.payload);
        else throw new Error('Native chat recovery is active; choose Custom to reload this release');
      } else if (message.op === 'deploy') {
        if (!message.payload.background) {setSurface('live');setFrontApp(appID);setHomeOpen(false);}
        result = await live.current[appID].load(message.payload);
      } else if (message.op === 'inspect') result = target.current.inspect();
      else if (message.op === 'app_describe') result = target.current.appDescribe();
      else if (message.op === 'app_inspect') result = target.current.appInspect(message.payload);
      else if (message.op === 'app_invoke' || message.op === 'screenshot' || message.op === 'interact') {
        if (!message.payload.background) {setSurface(targetSurface);if (targetSurface === 'live') setFrontApp(appID);setHomeOpen(false);} await pause(150);
        result = message.op === 'screenshot' ? await target.current.screenshot() : message.op === 'app_invoke' ? await target.current.appInvoke(message.payload) : await target.current.interact(message.payload);
      } else throw new Error('Unknown host operation');
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'host_result', id: message.id, data: result }));
    } catch (e) {
      if(message.payload?.appID==='morph-chat' && message.op==='deploy') recoverChat();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'host_result', id: message.id, error: e.message }));
    }
  };
  const connect = useCallback(async () => {
    clearTimeout(reconnectTimer.current);
    const attempt = ++connectionAttempt.current;
    if (!/^ws:\/\/127\.0\.0\.1:\d+$/.test(url)) { setError('For now use a loopback URL: ws://127.0.0.1:8787'); return; }
    for (const pending of pluginRequests.current.values()) pending.reject(new Error('Reconnecting to local service'));
    pluginRequests.current.clear();
    const previous = socket.current; socket.current = null;
    previous?.close(); setConnected(false); setConnection('Connecting…'); setError('');
    if (previous) await pause(200);
    if (attempt !== connectionAttempt.current || !reconnectAllowed.current) return;
    const ws = new WebSocket(url, undefined, { headers: { Authorization: 'Bearer ' + token.trim() } });
    socket.current = ws;
    ws.onopen = () => {
      if (socket.current !== ws) return;
      setConnected(true); setConnection('Local agent connected'); ws.send(JSON.stringify({ type: 'hello' }));
    };
    ws.onclose = event => { if (socket.current === ws) {
      setConnected(false); setTool(''); setConnection(event.reason || 'Disconnected — reconnect in Settings');
      for (const pending of pluginRequests.current.values()) pending.reject(new Error('Local service disconnected'));
      pluginRequests.current.clear();
      if (reconnectAllowed.current && event.code !== 1008) reconnectTimer.current = setTimeout(() => connectRef.current?.(), 2000);
    } };
    ws.onerror = () => { if (socket.current === ws) setConnection('Could not connect. Check service and pairing token.'); };
    ws.onmessage = event => {
      if (socket.current !== ws) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'plugin_rpc_result' || message.type === 'agent_rpc_result' || message.type === 'app_rpc_result') {
          const pending = pluginRequests.current.get(message.id); pluginRequests.current.delete(message.id);
          message.error ? pending?.reject(new Error(message.error)) : pending?.resolve(message.data);
        } else if (message.type === 'show_chat') setChatOpen(true);
        else if(message.type==='system_chat_failed') recoverChat();
        else if (message.type === 'show_home') setHomeOpen(true);
        else if (message.type === 'show_app') {setFrontApp(message.appID);setSurface('live');setHomeOpen(false);}
        else if (message.type === 'close_app') {live.current[message.appID]?.clear();setRuntimeApps(ids => ids.filter(id => id !== message.appID));}
        else if (message.type === 'instance_setup') {setFocusedInstance(message.id);setPluginsOpen(true);}
        else if (message.type === 'instance_auth') {setPluginAuth(message);Linking.openURL(message.url).catch(e => setError(e.message));}
        else if (message.type === 'show_plugin') {setHomeOpen(true);if(message.build) setChatOpen(true);else openPluginFiles(message.id);}
        else if(message.type==='chat_view') setChatView(message);
        else if(message.type==='chat_tool_cancel') systemChat.current?.cancelTool(message.id);
        else if (message.type === 'chat_changed') {setChatView({messages:[]});Keyboard.dismiss();setMessages([]);setInput('');setError('');setChatOpen(true);}
        else if (message.type === 'plugin_file') {
          if (fileTarget.current?.plugin === message.plugin && fileTarget.current?.path === message.path) setSource(message.content);
        } else if (message.type === 'plugin_build_result') setPluginBuilds(previous => ({ ...previous, [message.id]: message }));
        else if (message.type === 'plugin_auth') { setPluginAuth(message); Linking.openURL(message.url).catch(e => setError(e.message)); }
        else if (message.type === 'clear_preview') preview.current?.clear();
        else if (message.type === 'preview_diagnostic') preview.current?.diagnostic(message);
        else if (message.type === 'state') {setState(message);setTool(message.activity || '');}
        else if (message.type === 'transcript') setMessages(message.messages);
        else if (message.type === 'error') setError(message.error);
        else if (message.type === 'tool') setTool(message.phase === 'start' ? message.label || 'Working…' : '');
        else if (message.type === 'host_request') {
          // Render, event dispatch and capture are serialized, so a screenshot cannot race a render.
          if (['app_describe','app_inspect','inspect','chat_tool_execute'].includes(message.op)) void runHostRequest(message,ws);
          else if (message.op === 'app_invoke') {
            const key = message.payload?.appID || 'preview';
            const queue = (liveQueues.current.get(key) || Promise.resolve()).catch(() => {}).then(() => runHostRequest(message,ws)); liveQueues.current.set(key,queue);
          } else operationQueue.current = operationQueue.current.catch(() => {}).then(() => runHostRequest(message, ws));
        }
      } catch (e) { setError(e.message); }
    };
  }, [url, token]);
  connectRef.current = connect;
  useEffect(() => {
    reconnectAllowed.current = true;
    if (process.env.EXPO_PUBLIC_MORPH_TOKEN) connect();
    else setSettingsOpen(true);
    return () => { reconnectAllowed.current = false; clearTimeout(reconnectTimer.current); socket.current?.close(); };
  }, []);
  const reportError = useCallback(event => send({ type: 'runtime_error', ...event }), [send]);
  const reportChatError = useCallback(event=>{recoverChat();setError('Custom chat failed. Native recovery is available.');send({type:'runtime_error',...event});},[send,recoverChat]);
  const submit = () => {
    if (!input.trim() || state.busy || !connected) return;
    const text = input.trim(); setInput(''); setError('');
    setMessages(current => [...current, { role: 'user', text, timestamp: Date.now() }]);
    send({ type: 'chat', text });
  };
  const openFiles = () => { if (state.library?.primary?.startsWith('plugin:')) return openPluginFiles(state.library.primary.slice(7)); fileTarget.current = null; setEditingPlugin(null); setFilename('/App.tsx'); setSource(state.files['/App.tsx'] || ''); setFilesOpen(true); setMenuOpen(false); };
  const openPluginFiles = id => {
    setEditingPlugin(id); setFilename('/manifest.json'); setSource('');
    fileTarget.current = { plugin: id, path: '/manifest.json' };
    setPluginsOpen(false); setFilesOpen(true);
    send({ type: 'plugin_read_file', plugin: id, path: '/manifest.json' });
  };
  const auth = state.auth;
  const canPromote = connected && state.preview?.status === 'ready' && state.preview.id === state.draftID && !state.busy;
  const activity = tool || (state.busy ? 'Thinking…' : '');
  const timeline = messages.map((message,index)=>({...message,key:'message-'+index}));
  const editorFiles = editingPlugin ? state.pluginWorkspaces?.find(w => w.id === editingPlugin)?.files || [] : Object.keys(state.files);
  return <View ref={keyboard.rootRef} collapsable={false} onLayout={keyboard.onRootLayout} style={s.root}>
    <StatusBar style="light" />
    <View style={s.topbar}>
      <Pressable accessibilityLabel="Home" onPress={() => {Keyboard.dismiss();setHomeOpen(true);setMenuOpen(false);setChatOpen(false);}}><Text style={s.smallBrand}>⌂</Text></Pressable>
      <Pressable onPress={() => setMenuOpen(!menuOpen)} style={s.modeButton}><Text style={s.smallBrand}>morph<Text style={{ color: '#7de2ce' }}>.</Text></Text><Text numberOfLines={1} style={[s.modeLabel,{maxWidth:140}]}>{homeOpen ? 'Home' : surface === 'live' ? state.library?.apps.find(a => a.id === frontApp)?.name || 'App' : `Preview · ${state.preview?.appID || state.library?.activeApp || ''}`}   ⌄</Text></Pressable>
      <View style={{ flex: 1 }} />
      {!connected ? <Pressable onPress={() => setSettingsOpen(true)}><Text style={s.indicator}>Offline · connect</Text></Pressable> : state.busy ? <Text style={s.indicator}>Building…</Text> : surface === 'preview' && state.preview?.status === 'invalidated' ? <Pressable onPress={() => send({ type: 'render' })}><Text style={s.indicator}>Render needed ↻</Text></Pressable> : null}
      {state.deployRequested && <Pressable onPress={() => setVersionsOpen(true)}><Text style={s.indicator}>Review ↑</Text></Pressable>}
      <Pressable onPress={() => setSettingsOpen(true)} style={s.iconButton}><Text style={s.modeLabel}>⚙</Text></Pressable>
    </View>
    {menuOpen && <View style={s.toolbar}>
      <TinyButton title="App" accent={surface === 'live'} onPress={() => { setSurface('live'); setMenuOpen(false); }} />
      <TinyButton title="Preview" accent={surface === 'preview'} onPress={() => { setSurface('preview'); setMenuOpen(false); }} />
      <TinyButton title="Files" onPress={openFiles} />
      <TinyButton title="Chat recovery" onPress={()=>{recoverChat();setChatOpen(true);setMenuOpen(false);}} />
      <TinyButton title="Accounts / plugins" onPress={() => { setPluginsOpen(true); setMenuOpen(false); }} />
      <TinyButton title="Versions" onPress={() => { setVersionsOpen(true); setMenuOpen(false); }} />
      <TinyButton title="Render" disabled={!connected || state.busy} onPress={() => { setError(''); send({ type: 'render' }); setMenuOpen(false); }} />
      <TinyButton title="Promote ↑" accent disabled={!canPromote} onPress={() => { setVersionsOpen(true); setMenuOpen(false); }} />
    </View>}
    <View style={s.canvas}>
      {runtimeApps.map(id => <NativeSurface key={id} ref={value => {if(value) live.current[id]=value;else delete live.current[id];}} name={id} visible={!homeOpen && surface === 'live' && frontApp === id} onError={reportError} onPluginCall={onPluginCall} onAgentCall={onAgentCall} onAppCall={onAppCall} />)}
      <NativeSurface ref={preview} name="preview" visible={!homeOpen && surface === 'preview'} onError={reportError} onPluginCall={onPluginCall} onAgentCall={onAgentCall} onAppCall={onAppCall} />
      {homeOpen && <HomeScreen library={state.library} runningApps={state.runningApps} disabled={!connected || state.busy} onOpen={(project,build) => send({type:'open_project',project,build})} onChat={id => send({type:'open_chat',id})} onNewChat={() => send({type:'new_chat'})} onClose={appID => send({type:'close_app',appID})} onTrash={appID => send({type:'trash_app',appID})} onRestore={appID => send({type:'restore_app',appID})} onPurge={appID => send({type:'purge_app',appID,confirm:true})} onUpdate={(project,name,icon) => send({type:'project_update',project,name,icon})} />} 
    </View>
    {!keyboard.keyboardVisible && <Pressable style={s.chatFab} onPress={() => setChatOpen(!chatOpen)}><Text style={s.chatFabText}>{chatOpen ? 'Close ↓' : 'Chat ↗'}</Text></Pressable>}
    {!!error && !chatOpen && <Pressable style={s.errorBanner} onPress={() => setError('')}><Text style={s.errorText}>{error} · tap to dismiss</Text></Pressable>}
    <View pointerEvents={chatOpen?'auto':'none'} style={[s.chat, { bottom: keyboard.bottom, height: fullChat?Math.max(150,keyboard.diagnostics.rootHeight-keyboard.bottom-80):keyboard.height },!chatOpen && {opacity:0,height:0}]}>
      <View style={s.chatHeader}>
        {state.busy && <ActivityIndicator size="small" color="#7de2ce" />}
        <Text numberOfLines={1} style={s.chatActivity}>{activity || state.library?.chats.find(c => c.id === state.library.activeChat)?.title || 'Chat'}</Text>
        <TinyButton title={fullChat?'Dock':'Full'} onPress={()=>{Keyboard.dismiss();setFullChat(v=>!v);}} />
        <TinyButton title={safeChat?'Custom':'Safe'} onPress={()=>{if(safeChat){safeChatRef.current=false;setSafeChat(false);send({type:'system_chat_load'});}else recoverChat();}} />
        <TinyButton title="＋" disabled={state.busy} onPress={() => send({type:'new_chat'})} />
        {state.busy && <TinyButton title="Stop" onPress={() => send({ type: 'stop' })} />}
        <TinyButton title="×" onPress={() => { Keyboard.dismiss(); setChatOpen(false); }} />
      </View>
      {!!error && !safeChat && <Pressable onPress={()=>setError('')}><Text style={s.errorText}>{error} · dismiss</Text></Pressable>}
      <View style={{flex:1,minHeight:0,overflow:'hidden'}}>
        <NativeSurface ref={systemChat} name="morph-chat" visible={chatOpen && !safeChat} onError={reportChatError} onChatTools={request=>send({type:'chat_tools',...request})} onChatToolUpdate={request=>send({type:'chat_tool_update',...request})} chatHost={{view:chatView.chatID===state.library?.activeChat?chatView:{messages:[]},messages,draft:input,setDraft:setInput,submit,busy:!!state.busy,connected,activity,title:state.library?.chats.find(c=>c.id===state.library.activeChat)?.title||'Chat',mode:fullChat?'full':'docked',keyboard}} onPluginCall={onPluginCall} onAgentCall={onAgentCall} onAppCall={onAppCall}/>
        {safeChat && <><ScrollView ref={history} style={{ flex: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 14, gap: 12 }} onLayout={() => history.current?.scrollToEnd({ animated: false })} onContentSizeChange={() => history.current?.scrollToEnd({ animated: true })}>
        {!timeline.length && <Text style={s.help}>What would you like to build?</Text>}
        {!!error && <Pressable onPress={() => setError('')}><Text style={s.errorText}>{error} · dismiss</Text></Pressable>}
        {timeline.map(item => <View key={item.key} style={[s.bubble,item.role === 'user' && s.userBubble]}><ChatMarkdown text={item.text}/></View>)}
      </ScrollView>
      <View ref={keyboard.composerRef} collapsable={false} onLayout={keyboard.onComposerLayout} style={s.composer}><TextInput style={s.chatInput} value={input} onChangeText={setInput} placeholder="What shall we make?" placeholderTextColor="#78909a" multiline maxLength={32000} /><TinyButton title="Send ↑" accent disabled={!connected || state.busy || !input.trim()} onPress={submit} /></View></>}
      </View>
    </View>
    <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
      <View style={s.modal}><View style={s.modalHeader}><Text style={s.heading}>Control room</Text><TinyButton title="Done" onPress={() => setSettingsOpen(false)} /></View>
        <ScrollView contentContainerStyle={{ paddingBottom: 50, gap: 14 }} keyboardShouldPersistTaps="handled">
          <Text style={s.section}>LOCAL CONNECTION</Text><Text style={s.help}>{connection}. Keep Termux running on this phone.</Text>
          <TextInput style={s.field} value={url} onChangeText={setURL} autoCapitalize="none" autoCorrect={false} />
          <TextInput style={s.field} value={token} onChangeText={setToken} secureTextEntry placeholder="Pairing token" placeholderTextColor="#78909a" autoCapitalize="none" autoCorrect={false} />
          <TinyButton title={connected ? 'Reconnect' : 'Connect'} accent onPress={connect} />
          <Text style={s.section}>CODEX ACCOUNT</Text><Text style={s.help}>{state.authenticated ? 'Codex credentials are stored privately in Termux, not in the editable app.' : 'Sign in with your ChatGPT / Codex account. No API key needed.'}</Text>
          <View style={s.row}><TinyButton title="Browser login" disabled={!connected || state.busy} onPress={() => send({ type: 'login', method: 'browser' })} /><TinyButton title="Device code" disabled={!connected || state.busy} onPress={() => send({ type: 'login', method: 'device_code' })} />{state.authenticated && <TinyButton title="Log out" disabled={state.busy} onPress={() => send({ type: 'logout' })} />}</View>
          {auth && <View style={s.authBox}>
            <Text selectable style={s.message}>{auth.message || auth.instructions || (auth.type === 'device_code' ? `Enter this code: ${auth.userCode}` : auth.type)}</Text>
            {!!(auth.url || auth.verificationUri) && <TinyButton title="Open sign-in browser ↗" accent onPress={() => Linking.openURL(auth.url || auth.verificationUri)} />}
            {auth.userCode && <Text selectable style={s.code}>{auth.userCode}</Text>}
            {auth.type === 'prompt' && <><TextInput style={s.field} value={answer} onChangeText={setAnswer} placeholder="Paste final redirect URL if needed" placeholderTextColor="#78909a" autoCapitalize="none" autoCorrect={false} /><TinyButton title="Submit redirect" onPress={() => { send({ type: 'auth_answer', id: auth.id, answer }); setAnswer(''); }} /></>}
            {!['complete', 'error'].includes(auth.type) && <TinyButton title="Cancel sign-in" onPress={() => send({ type: 'cancel_login' })} />}
          </View>}
          <Text style={s.section}>MODEL</Text>
          {state.models.map(model => <Pressable key={model.id} style={[s.model, state.model === model.id && s.selectedModel]} disabled={!connected || state.busy} onPress={() => send({ type: 'select_model', id: model.id })}><Text style={s.message}>{model.name || model.id}{model.image ? '  ◉' : ''}</Text><Text style={s.help}>{model.id}{state.model === model.id ? ' · selected' : ''}</Text></Pressable>)}
          <Text style={s.section}>WEB RESEARCH</Text>
          <Text style={s.help}>Built-in chat can use OpenAI-hosted live search and public-page reading with your existing Codex sign-in. Ask it to search or browse a URL; sources appear as clickable citations. This is not a logged-in browser or form automation. Availability depends on the selected model/account.</Text>
          <Text style={s.section}>TRUSTED SANDBOX</Text>
          <Text style={s.help}>The agent can edit/build/deploy sandbox projects and operate running apps. App-to-app state/commands also work without approval cards. Credentials and OAuth management stay in protected account setup; generated code receives only instance IDs and service results. Network, execution and runaway-agent limits still apply.</Text>
          <TinyButton title="Manage account instances" onPress={() => {setSettingsOpen(false);setPluginsOpen(true);}} />
          <Text style={s.section}>RECOVERY</Text><Text style={s.help}>Preview and App use separate JS runtimes. Promote resets component state. Rollback restores the previous deployed source. The editable app cannot replace these controls.</Text>
          <TinyButton title="Roll back deployed app" disabled={!state.previousID || state.busy} onPress={() => send({ type: 'rollback' })} />
          <Text style={s.help}>This prototype offers a restricted native component bridge, not arbitrary React Native modules. It is not an audited hostile-code sandbox. Screenshots require the app in the foreground; interactions are component callbacks, not physical taps.</Text>
        </ScrollView>
      </View>
    </Modal>
    <Modal visible={filesOpen} animationType="slide" onRequestClose={() => setFilesOpen(false)}>
      <View style={s.modal}><View style={s.modalHeader}><Text style={[s.heading, { fontSize: 21 }]}>{editingPlugin ? `Plugin: ${editingPlugin}` : 'Virtual files'}</Text><TinyButton title="Done" onPress={() => setFilesOpen(false)} /></View>
        <ScrollView horizontal style={{ maxHeight: 50 }} contentContainerStyle={{ gap: 8 }}>
          {editorFiles.map(name => <TinyButton key={name} title={name} accent={filename === name} onPress={() => {
            setFilename(name);
            if (editingPlugin) { setSource(''); fileTarget.current = { plugin: editingPlugin, path: name }; send({ type: 'plugin_read_file', plugin: editingPlugin, path: name }); }
            else setSource(state.files[name]);
          }} />)}
        </ScrollView>
        <Text style={s.help}>{editingPlugin ? 'Separate plugin draft. Build and publish in Plugins; releases are immutable.' : 'App draft only. Agent tools never see your Termux home or credentials.'}</Text>
        {!!error && <Text style={s.errorText}>{error}</Text>}
        <TextInput style={s.codeInput} value={source} onChangeText={setSource} multiline autoCapitalize="none" autoCorrect={false} textAlignVertical="top" />
        <TinyButton title="Save draft" accent disabled={!connected || state.busy} onPress={() => send(editingPlugin ? { type: 'plugin_save_file', plugin: editingPlugin, path: filename, content: source } : { type: 'save_file', path: filename, content: source })} />
      </View>
    </Modal>
    <PluginsPanel focusedInstance={focusedInstance} focusedPlugin={focusedPlugin} visible={pluginsOpen} onClose={() => setPluginsOpen(false)} state={state} send={send} onEdit={openPluginFiles} builds={pluginBuilds} auth={pluginAuth} error={error} />
    <VersionsPanel visible={versionsOpen} onClose={() => setVersionsOpen(false)} state={state} send={send} canPromote={canPromote} error={error} />
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a1219', paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight || 24 : 50, paddingBottom: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 14 },
  brand: { color: '#f4f3ec', fontWeight: '800', fontSize: 30, letterSpacing: -1 }, subtitle: { color: '#7d929c', fontSize: 11, marginTop: 2 },
  button: { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#1b2a34', borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  accent: { backgroundColor: '#7de2ce' }, buttonText: { color: '#cbd8dc', fontSize: 12, fontWeight: '700' },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 38, gap: 12, backgroundColor: '#0a1219' },
  modeButton: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 }, smallBrand: { color: '#b6c6ca', fontSize: 14, fontWeight: '800' }, modeLabel: { color: '#8ca3ac', fontSize: 11 }, indicator: { color: '#7de2ce', fontSize: 10 }, iconButton: { padding: 9 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 12, paddingBottom: 10, paddingTop: 4, alignItems: 'center' },
  canvas: { flex: 1, overflow: 'hidden', backgroundColor: '#101a22' },
  chatFab: { position: 'absolute', bottom: 28, right: 16, backgroundColor: '#7de2ce', paddingHorizontal: 17, paddingVertical: 12, borderRadius: 24, elevation: 5 }, chatFabText: { color: '#10242a', fontSize: 12, fontWeight: '700' },
  footer: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 14 }, footerText: { color: '#7d929c', fontSize: 10, letterSpacing: 1 }, approval: { color: '#7de2ce', fontSize: 10, marginTop: 5 },
  chat: { position: 'absolute', bottom: 85, left: 10, right: 10, height: '53%', borderRadius: 18, backgroundColor: '#14222c', borderWidth: 1, borderColor: '#36505b', overflow: 'hidden', elevation: 10 },
  chatHeader: { flexDirection: 'row', flexShrink: 0, alignItems: 'center', padding: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: '#263b46' },
  section: { color: '#7de2ce', fontSize: 11, letterSpacing: 1.5, fontWeight: '700', marginTop: 3 }, modelLabel: { flex: 1, color: '#91a8b1', fontSize: 10 },
  chatActivity: { flex: 1, color: '#a5bbbf', fontSize: 12 },
  bubble: { paddingVertical: 5, paddingHorizontal: 2 }, userBubble: { backgroundColor: '#243d3d', padding: 11, borderRadius: 13, alignSelf: 'flex-end', width: '92%', maxWidth: '92%' },
  decisionNote: { gap: 8, borderLeftWidth: 2, borderLeftColor: '#7de2ce', paddingLeft: 10, paddingVertical: 5 }, dismissNote: { color: '#799298', fontSize: 10 },
  message: { color: '#e1e9e8', fontSize: 14, lineHeight: 21 }, composer: { flexDirection: 'row', flexShrink: 0, alignItems: 'center', padding: 10, gap: 8, borderTopWidth: 1, borderTopColor: '#263b46' },
  chatInput: { flex: 1, maxHeight: 100, minHeight: 44, color: '#f4f3ec', fontSize: 14, padding: 9, backgroundColor: '#0e1b23', borderRadius: 10 },
  help: { color: '#90a7b0', fontSize: 12, lineHeight: 19 }, errorBanner: { position: 'absolute', top: 130, left: 15, right: 15, backgroundColor: '#633d3d', borderRadius: 12, padding: 14, zIndex: 50 }, errorText: { color: '#ffe4de', fontSize: 12 },
  modal: { flex: 1, backgroundColor: '#0a1219', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 30 }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }, heading: { color: '#f4f3ec', fontSize: 26, fontWeight: '700' },
  field: { color: '#e1e9e8', padding: 14, borderWidth: 1, borderColor: '#2a414c', borderRadius: 10, fontSize: 13 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  authBox: { backgroundColor: '#142630', borderRadius: 12, padding: 14, gap: 12 }, code: { fontSize: 27, fontWeight: '700', color: '#7de2ce', letterSpacing: 3 },
  model: { padding: 14, borderWidth: 1, borderColor: '#243943', borderRadius: 12 }, selectedModel: { borderColor: '#7de2ce', backgroundColor: '#142f30' },
  codeInput: { flex: 1, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo', color: '#cbe9df', backgroundColor: '#101c24', padding: 12, borderRadius: 12, fontSize: 12, marginVertical: 15 },
});
