import React, { useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
export function AgentBridgeCard({ request, pending, connected, authenticated, deviceBusy, onDecide, onSignIn }) {
  const [expanded, setExpanded] = useState(false);
  const [control, setControl] = useState(request.scope === 'control');
  const message = request.kind === 'message';
  const locked = pending || !connected || deviceBusy || (message && !authenticated);
  const context = message && request.context !== null ? JSON.stringify(request.context, null, 2) : '';
  return <View style={s.card}>
    <Text style={s.caption}>PROTECTED AGENT BRIDGE</Text>
    <Text style={s.title}>{message ? 'Send this app request to the agent?' : 'Let the agent access the live app?'}</Text>
    <Text style={s.help}>{request.source.surface === 'live' ? 'App' : 'Preview'}{request.source.version ? ` · v${request.source.version}` : ''} · source {request.source.snapshotID?.slice(0, 12)}</Text>
    {message ? <>
      <Text selectable style={s.text}>{request.text}</Text>
      {!!context && <>
        <Text style={s.help}>The app also proposes sharing this context:</Text>
        <Text selectable style={s.context}>{expanded ? context : context.slice(0, 400) + (context.length > 400 ? '…' : '')}</Text>
        {context.length > 400 && <Pressable onPress={() => setExpanded(!expanded)}><Text style={s.link}>{expanded ? 'Collapse context ↑' : 'Review all context ↓'}</Text></Pressable>}
      </>}
      <Text style={s.help}>Sends the prompt/context to your selected model and may use quota. The agent can work on the task using existing tools/grants. This is not approval to install plugins, promote code, connect accounts or change permissions.</Text>
      {!authenticated && <Pressable onPress={onSignIn}><Text style={s.link}>Sign in to the main agent first ↗</Text></Pressable>}
    </> : <>
      <Text style={s.text}>Exposed state, interface details and app screenshots may be sent to your selected model. This can include private data from any service connected to the app.</Text>
      <View style={s.toggle}><Text style={[s.help, { flex: 1 }]}>Also allow commands and control interactions. These may trigger service actions/writes already permitted to the app.</Text><Switch value={control} onValueChange={setControl} disabled={pending} trackColor={{ true: '#49867c' }} /></View>
      <Text style={s.help}>Permission applies only to this source version. Revoke it in Control room. Preview remains a separate agent testing workspace.</Text>
    </>}
    <View style={s.row}>
      <Pressable disabled={locked} style={[s.approve, locked && { opacity: 0.4 }]} onPress={() => onDecide('approve', { control, continue: authenticated })}><Text style={s.buttonText}>{pending ? 'Applying…' : message ? 'Send to agent' : authenticated ? 'Allow & continue' : 'Allow access'}</Text></Pressable>
      <Pressable disabled={pending || !connected} onPress={() => onDecide('decline', {})} style={{ padding: 10 }}><Text style={s.help}>Not now</Text></Pressable>
    </View>
    <Text style={s.fine}>App code cannot approve this or read your private chat. Requests return receipts—not agent answers.</Text>
  </View>;
}
const s = StyleSheet.create({ card: { backgroundColor: '#192b38', borderWidth: 1, borderColor: '#456675', borderRadius: 14, padding: 14, gap: 10 }, caption: { color: '#9bd5e5', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 }, title: { color: '#eef4ef', fontSize: 16, fontWeight: '700' }, text: { color: '#d4e1e0', fontSize: 13, lineHeight: 20 }, help: { color: '#a0b8bc', fontSize: 11, lineHeight: 17 }, context: { color: '#c1d6db', backgroundColor: '#0f1d26', padding: 9, borderRadius: 8, fontFamily: 'monospace', fontSize: 10, lineHeight: 16 }, link: { color: '#9bd5e5', fontSize: 11, paddingVertical: 4 }, toggle: { flexDirection: 'row', alignItems: 'center', gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, approve: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#9bd5e5', alignItems: 'center' }, buttonText: { color: '#10242a', fontWeight: '700', fontSize: 12 }, fine: { color: '#7e9aa4', fontSize: 9, lineHeight: 14 } });
