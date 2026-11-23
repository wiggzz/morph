import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Switch, ActivityIndicator, Button, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { captureRef } from 'react-native-view-shot';
import { validateTree, findControl } from './nativeTree';
import { settlePreview } from './settlePreview';
import {ChatHostContext,chatNative} from './ChatHost';
let interactionSink=null;
export function setInteractionSink(sink){interactionSink=sink;}
const native = { View, Text, Pressable, TextInput, ScrollView, Switch, ActivityIndicator, Button };
const waitForPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 70))));

class NativeBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.props.onError({ message: error.message, diagnostics: { code: 'NATIVE_RENDER', componentStack: info.componentStack?.slice(0, 4000) } }); }
  render() { return this.state.error ? <Text style={{ color: '#ffb3ab', padding: 20 }}>Preview error: {String(this.state.error.message)}</Text> : this.props.children; }
}

export const NativeSurface = forwardRef(function NativeSurface({ name, visible, onError, onPluginCall, onAgentCall, onAppCall, chatHost, onChatTools, onChatToolUpdate }, ref) {
  const [runtime, setRuntime] = useState(null);
  const [tree, setTree] = useState([]);
  const [failure, setFailure] = useState(null);
  const state = useRef({ tree: [], error: null, snapshotID: null });
  const web = useRef(null);
  const shot = useRef(null);
  const chatMetadata = JSON.stringify(name==='preview'?{title:'Chat preview',mode:'preview',busy:false,connected:false,messageCount:2,messages:[{role:'user',content:[{type:'text',text:'Build a custom conversation view.'}],timestamp:1},{role:'toolResult',toolName:'example',toolCallId:'fixture',content:[{type:'text',text:'Example result'}],details:{count:3},timestamp:2}]}:{title:chatHost?.title,busy:!!chatHost?.busy,connected:!!chatHost?.connected,messageCount:chatHost?.messages?.length||0,mode:chatHost?.mode,messages:chatHost?.view?.messages||[],event:chatHost?.view?.event||null,truncated:chatHost?.view?.truncated});
  const updateChat = () => {if(runtime?.chatUI) web.current?.injectJavaScript(`window.__morphSetChatState && window.__morphSetChatState(${chatMetadata});true;`);};
  useEffect(updateChat,[chatMetadata,runtime?.key]);
  const recordUsage=event=>{if(state.current.capabilityID)interactionSink?.({capabilityID:state.current.capabilityID,...event});};
  useEffect(()=>{const capabilityID=state.current.capabilityID;if(runtime&&visible&&capabilityID)interactionSink?.({capabilityID,event:'shown'});return()=>{if(runtime&&visible&&capabilityID)interactionSink?.({capabilityID,event:'hidden'});};},[visible,runtime?.key]);
  const mount = useRef(null);
  const describe = () => ({ tree: state.current.tree, error: state.current.error || state.current.interactionError || null, diagnostics: state.current.diagnostics || null, snapshotID: state.current.snapshotID, revision: state.current.revision || 0, pendingTasks: state.current.pendingTasks || 0 });
  const eventWaiters = useRef(new Map());
  const portWaiters = useRef(new Map());
  const toolWaiters = useRef(new Map());
  const cancelTools = () => {for(const waiter of toolWaiters.current.values())waiter.reject(new Error('Chat runtime replaced'));toolWaiters.current.clear();};
  const portState = () => state.current.ports || [];
  const cancelPorts = () => { cancelTools(); for (const waiter of portWaiters.current.values()) waiter.reject(new Error('Runtime replaced')); portWaiters.current.clear(); };
  const sequence = useRef(0);
  const fail = error => {
    const message = String(error?.message || error);
    cancelPorts();
    state.current.error = message; state.current.diagnostics = error?.diagnostics || { code: 'RUNTIME_ERROR' }; state.current.lastActivity = Date.now(); setFailure(message);
    mount.current?.reject(new Error(message)); mount.current = null;
    onError?.({ surface: name, capabilityID:state.current.capabilityID, snapshotID: state.current.snapshotID, viewEpoch: state.current.viewEpoch, error: message, diagnostics: state.current.diagnostics });
  };
  const emit = (event, value, id) => {
    if (!web.current) throw new Error('Runtime is not mounted');
    web.current.injectJavaScript(`window.__morphEvent && window.__morphEvent(${JSON.stringify(event)},${JSON.stringify(value ?? null)},${JSON.stringify(id || null)});true;`);
  };
  const draw = (node, i) => {
    if (typeof node === 'string') return node;
    const Component = native[node.type] || (runtime?.chatUI ? chatNative[node.type] : null);
    const props = { ...node.props, key: node.id || i };
    for (const key of ['onPress', 'onChangeText', 'onValueChange']) {
      if (props[key]?.event) {
        const event = props[key].event;
        props[key] = value => { if(key!=='onChangeText')recordUsage({event:key==='onPress'?'press':'toggle',nodeID:node.id,testID:node.props.testID,component:node.type}); if (key === 'onPress') state.current.agentGesture = Date.now(); emit(event, key === 'onPress' ? { nativeEvent: {} } : value); };
      }
    }
    return React.createElement(Component, props, ...node.children.map(draw));
  };
  useImperativeHandle(ref, () => ({
    clear() {
      mount.current?.reject(new Error('Preview cleared after plugin access/version change')); mount.current = null;
      for (const waiter of eventWaiters.current.values()) waiter.reject(new Error('Preview cleared'));
      eventWaiters.current.clear(); cancelPorts();
      state.current = { tree: [], error: null, snapshotID: null, runtimeKey: ++sequence.current };
      setTree([]); setFailure(null); setRuntime(null);
    },
    diagnostic(payload) {
      if (state.current.viewEpoch !== undefined && state.current.viewEpoch !== payload.viewEpoch) return;
      mount.current?.reject(new Error(payload.error)); mount.current = null;
      for (const waiter of eventWaiters.current.values()) waiter.reject(new Error(payload.error));
      eventWaiters.current.clear(); cancelPorts();
      state.current = { ...state.current, error: payload.error, diagnostics: payload.diagnostics, snapshotID: payload.snapshotID, viewEpoch: payload.viewEpoch, runtimeKey: ++sequence.current, pendingTasks: 0, lastActivity: Date.now() };
      setRuntime(null); setFailure(payload.error);
    },
    async load(payload) {
      if (mount.current) mount.current.reject(new Error('Render superseded'));
      for (const waiter of eventWaiters.current.values()) waiter.reject(new Error('Runtime replaced'));
      eventWaiters.current.clear(); cancelPorts();
      const key = ++sequence.current;
      state.current = { tree: [], error: null, diagnostics: null, snapshotID: payload.snapshotID, runtimeKey: key, viewEpoch: payload.viewEpoch, capabilityID: payload.capabilityID, revision: 0, pendingTasks: 0, lastActivity: Date.now() };
      setTree([]); setFailure(null);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { if (mount.current?.resolve === done) { mount.current = null; reject(new Error('Runtime mount timed out')); } }, 15000);
        const done = result => { clearTimeout(timeout); resolve(result); };
        const failed = error => { clearTimeout(timeout); reject(error); };
        mount.current = { resolve: done, reject: failed };
        setRuntime({ ...payload, key });
      });
    },
    executeTool(payload) {
      if(!runtime?.chatUI||name==='preview'||state.current.error||!web.current)throw new Error('Tools execute only in the healthy live system chat');
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{toolWaiters.current.delete(payload.requestId);web.current?.injectJavaScript(`window.__morphPiCancel && window.__morphPiCancel(${JSON.stringify(payload.requestId)});true;`);reject(new Error('Project tool timed out'));},15000);
        toolWaiters.current.set(payload.requestId,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
        web.current?.injectJavaScript(`window.__morphPiExecute && window.__morphPiExecute(${JSON.stringify(payload)});true;`);
      });
    },
    cancelTool(requestId) {const waiter=toolWaiters.current.get(requestId);toolWaiters.current.delete(requestId);waiter?.reject(new Error('Tool cancelled'));web.current?.injectJavaScript(`window.__morphPiCancel && window.__morphPiCancel(${JSON.stringify(requestId)});true;`);},
    appDescribe() {
      return { snapshotID: state.current.snapshotID, error: state.current.error, revision: state.current.revision || 0, ports: portState().map(({ state: _state, ...port }) => port) };
    },
    appInspect({ port } = {}) {
      const ports = port ? portState().filter(item => item.name === port) : portState();
      if (port && !ports.length) throw new Error('Unknown port: ' + port);
      return { snapshotID: state.current.snapshotID, error: state.current.error, diagnostics: state.current.diagnostics, pendingTasks: state.current.pendingTasks || 0, revision: state.current.revision || 0, ports };
    },
    async appInvoke({ port, command, args = {}, waitUntilSettled = true, timeoutMs = 8000, quietMs = 200 }) {
      recordUsage({event:'test',component:'port',nodeID:port});
      if (state.current.error) return { ...describe(), settled: false, reason: 'render_error' };
      const spec = portState().find(item => item.name === port);
      if (!spec?.commands.some(item => item.name === command)) throw new Error('Unknown port or command');
      const generation = state.current.runtimeKey, started = Date.now();
      const budget = Math.max(100, Math.min(15000, timeoutMs)), requestId = 'port-' + (++sequence.current);
      let result;
      try {
        result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { portWaiters.current.delete(requestId); reject(new Error('Port command timed out')); }, budget);
          portWaiters.current.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
          web.current?.injectJavaScript(`window.__morphPortCommand && window.__morphPortCommand(${JSON.stringify({ requestId, port, command, args })});true;`);
        });
      } catch (error) { return { error: state.current.error || error.message, diagnostics: state.current.diagnostics, settled: false, reason: state.current.runtimeKey !== generation ? 'runtime_replaced' : state.current.error ? 'render_error' : 'command_error' }; }
      const settled = waitUntilSettled ? await settlePreview(() => state.current, { timeoutMs: Math.max(0, budget - (Date.now() - started)), quietMs, generation }) : { settled: false, reason: 'not_requested' };
      await waitForPaint();
      if (state.current.runtimeKey !== generation) return { error: 'Runtime replaced during command', settled: false, reason: 'runtime_replaced' };
      return { port, command, result, state: portState().find(item => item.name === port)?.state ?? null, error: state.current.error, pendingTasks: state.current.pendingTasks || 0, ...settled, ...(state.current.error ? { settled: false, reason: 'render_error' } : {}) };
    },
    inspect() { return describe(); },
    async screenshot() {
      if (!state.current.snapshotID || !shot.current) throw new Error('Render a preview first');
      await waitForPaint();
      const image = await captureRef(shot, { format: 'png', quality: 1, result: 'base64' });
      return { image, ...describe() };
    },
    async interact({ testID, event, value, waitUntilSettled = false, timeoutMs = 8000, quietMs = 200 }) {
      if (state.current.error) return { ...describe(), settled: false, reason: 'render_error' };
      recordUsage({event:'test',testID});
      state.current.interactionError = null;
      if (state.current.diagnostics?.code === 'INTERACTION_ERROR') state.current.diagnostics = null;
      const started = Date.now(), generation = state.current.runtimeKey;
      const budget = Math.min(15000, Math.max(100, timeoutMs));
      const control = findControl(state.current.tree, testID);
      if (!control) throw new Error('No Preview control with testID ' + testID);
      if (control.props.disabled || control.props.editable === false) throw new Error('Control is disabled');
      const key = { press: 'onPress', changeText: 'onChangeText', valueChange: 'onValueChange' }[event];
      if (!control.props[key]?.event) throw new Error('Control has no ' + key);
      if (event === 'changeText' && typeof value !== 'string') throw new Error('changeText requires a string');
      if (event === 'valueChange' && typeof value !== 'boolean') throw new Error('valueChange requires a boolean');
      const id = String(++sequence.current);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { eventWaiters.current.delete(id); reject(new Error('Interaction callback timed out')); }, Math.min(5000, budget));
          eventWaiters.current.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: e => { clearTimeout(timer); reject(e); } });
          emit(control.props[key].event, event === 'press' ? { nativeEvent: {} } : value, id);
        });
      } catch (error) {
        if (state.current.runtimeKey !== generation) return { settled: false, reason: 'runtime_replaced', error: 'Runtime replaced during interaction' };
        state.current.interactionError = error.message;
        state.current.diagnostics ||= { code: 'INTERACTION_ERROR' };
        return { ...describe(), settled: false, reason: state.current.error ? 'render_error' : 'interaction_error' };
      }
      const settled = waitUntilSettled ? await settlePreview(() => state.current, { timeoutMs: Math.max(0, budget - (Date.now() - started)), quietMs: Math.max(50, Math.min(1000, quietMs)), generation }) : { settled: false, reason: 'not_requested' };
      await waitForPaint();
      if (state.current.runtimeKey !== generation) return { settled: false, reason: 'runtime_replaced', error: 'Runtime replaced during interaction' };
      return { ...describe(), ...settled, ...(state.current.error ? { settled: false, reason: 'render_error' } : {}) };
    },
  }));
  const onMessage = async event => {
    const messageGeneration = runtime?.key;
    if (messageGeneration !== state.current.runtimeKey) return;
    try {
      if (event.nativeEvent.data.length > 600000) throw new Error('Runtime bridge message too large');
      const message = JSON.parse(event.nativeEvent.data);
      if(message.type==='pi_tools') {
        if(!runtime?.chatUI)throw new Error('Pi tools are reserved for system chat');
        if(name!=='preview')onChatTools?.({capabilityID:state.current.capabilityID,tools:message.tools});
      } else if(message.type==='pi_tool_update'||message.type==='pi_tool_result') {
        if(!runtime?.chatUI||name==='preview')throw new Error('Project tool execution is live-only');
        const waiter=toolWaiters.current.get(message.requestId);if(!waiter)return;
        if(message.type==='pi_tool_update')onChatToolUpdate?.({id:message.requestId,capabilityID:state.current.capabilityID,result:message.result});
        else {toolWaiters.current.delete(message.requestId);message.error?waiter.reject(new Error(message.error)):waiter.resolve(message.result);}
      } else if (message.type === 'app_call') {
        if (typeof message.requestId !== 'string' || message.requestId.length > 80 || JSON.stringify(message.payload).length > 18000) throw new Error('Invalid app call');
        let reply;
        try {reply = {requestId:message.requestId,data:await onAppCall({capabilityID:state.current.capabilityID,payload:message.payload})};}
        catch(error) {reply = {requestId:message.requestId,error:error.message};}
        if (state.current.runtimeKey === messageGeneration && web.current) web.current.injectJavaScript(`window.__morphAgentResult && window.__morphAgentResult(${JSON.stringify(reply)});true;`);
      } else if (message.type === 'agent_send') {
        if (typeof message.requestId !== 'string' || message.requestId.length > 80 || typeof message.text !== 'string' || message.text.length > 4000 || JSON.stringify(message.context ?? null).length > 12000) throw new Error('Invalid agent request');
        let reply;
        try {
          if(toolWaiters.current.size)throw new Error('Nested agent requests are blocked during Pi tool execution');
          if (!state.current.agentGesture || Date.now()-state.current.agentGesture > 5000) throw new Error('Press an app button to request the agent. Background/self-triggered agent loops are blocked.');
          state.current.agentGesture = null;
          reply = { requestId: message.requestId, data: await onAgentCall({ capabilityID: state.current.capabilityID, humanInitiated:true, payload: { text: message.text, context: message.context ?? null } }) };
        }
        catch (error) { reply = { requestId: message.requestId, error: error.message }; }
        if (state.current.runtimeKey === messageGeneration && web.current) web.current.injectJavaScript(`window.__morphAgentResult && window.__morphAgentResult(${JSON.stringify(reply)});true;`);
      } else if (message.type === 'ports') {
        if (!Array.isArray(message.ports) || message.ports.length > 16 || JSON.stringify(message.ports).length > 128000) throw new Error('Invalid/oversized agent ports');
        state.current.ports = message.ports; state.current.lastActivity = Date.now();
      } else if (message.type === 'port_result') {
        const waiter = portWaiters.current.get(message.requestId); portWaiters.current.delete(message.requestId);
        message.error ? waiter?.reject(new Error(message.error)) : waiter?.resolve(message.result);
      } else if (message.type === 'plugin_instance') {
        if (typeof message.requestId !== 'string' || message.requestId.length > 80 || JSON.stringify(message.options || {}).length > 16000) throw new Error('Invalid instance request');
        let reply;
        try {reply = {requestId:message.requestId,data:await onPluginCall({capabilityID:state.current.capabilityID,payload:{action:message.action,plugin:message.plugin,options:message.options}})};}
        catch(error) {reply = {requestId:message.requestId,error:error.message};}
        if (state.current.runtimeKey === messageGeneration && web.current) web.current.injectJavaScript(`window.__morphPluginResult && window.__morphPluginResult(${JSON.stringify(reply)});true;`);
      } else if (message.type === 'plugin_call') {
        if (typeof message.requestId !== 'string' || message.requestId.length > 80 || typeof message.plugin !== 'string' || typeof message.method !== 'string' || JSON.stringify(message.args || {}).length > 16000) throw new Error('Invalid plugin bridge request');
        const key = state.current.runtimeKey;
        let reply;
        try {
          const data = await onPluginCall({ capabilityID: state.current.capabilityID, payload: { plugin: message.plugin, method: message.method, args: message.args || {} } });
          reply = { requestId: message.requestId, data };
        } catch (error) { reply = { requestId: message.requestId, error: error.message }; }
        if (state.current.runtimeKey === key && web.current) web.current.injectJavaScript(`window.__morphPluginResult && window.__morphPluginResult(${JSON.stringify(reply)});true;`);
      } else if (message.type === 'activity') {
        state.current.pendingTasks = Math.max(0, Math.min(64, Number(message.pendingTasks) || 0)); state.current.lastActivity = Date.now();
      } else if (message.type === 'tree') {
        const next = validateTree(message.tree,{chatUI:runtime?.chatUI===true});
        state.current.tree = next; state.current.revision = message.revision || 0; state.current.pendingTasks = message.pendingTasks || 0; state.current.lastActivity = Date.now(); setTree(next);
        await waitForPaint();
        if (messageGeneration !== state.current.runtimeKey || state.current.error) return;
        mount.current?.resolve({ tree: next, snapshotID: state.current.snapshotID }); mount.current = null;
      } else if (message.type === 'error') fail({ message: message.error, diagnostics: message.diagnostics });
      else if (message.type === 'event_done') {
        const waiter = eventWaiters.current.get(message.requestId);
        eventWaiters.current.delete(message.requestId);
        message.error ? waiter?.reject(new Error(message.error)) : waiter?.resolve();
      }
    } catch (error) { fail(error); }
  };
  return <ChatHostContext.Provider value={runtime?.chatUI ? name==='preview'?{preview:true}:chatHost : null}><View style={[styles.surface, !visible && styles.hidden]} pointerEvents={visible ? 'auto' : 'none'}>
    <View ref={shot} collapsable={false} style={styles.canvas} onTouchEnd={event=>recordUsage({event:'tap',x:event.nativeEvent.locationX,y:event.nativeEvent.locationY})}>
      <NativeBoundary key={runtime?.key} onError={error => { if (runtime?.key === state.current.runtimeKey) fail(error); }}>
        {failure ? <Text style={styles.error}>{failure}</Text> : tree.length ? tree.map(draw) : <View style={styles.empty}><Text style={styles.hint}>No {name} yet</Text></View>}
      </NativeBoundary>
    </View>
    {runtime && <View style={styles.engine} pointerEvents="none">
      <WebView key={runtime.key} ref={web} source={{ html: runtime.html, baseUrl: 'about:blank' }}
        originWhitelist={['about:*']} onMessage={onMessage} onLoadEnd={updateChat} javaScriptEnabled
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never" javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false} domStorageEnabled={false} sharedCookiesEnabled={false}
        onError={e => { if (runtime?.key === state.current.runtimeKey) fail({ message: e.nativeEvent.description, diagnostics: { code: 'WEBVIEW_LOAD' } }); }}
        onRenderProcessGone={() => { if (runtime?.key === state.current.runtimeKey) fail({ message: 'Preview runtime stopped. Render again to recover.', diagnostics: { code: 'WEBVIEW_PROCESS_GONE' } }); }}
      />
    </View>}
  </View></ChatHostContext.Provider>;
});
const styles = StyleSheet.create({
  surface: { ...StyleSheet.absoluteFillObject },
  hidden: { opacity: 0, zIndex: -1 },
  canvas: { flex: 1, backgroundColor: '#101a22' },
  engine: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: '#7d929c', fontSize: 16 }, error: { color: '#ffb3ab', padding: 20 },
});
