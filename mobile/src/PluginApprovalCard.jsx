import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, Switch, StyleSheet } from 'react-native';

export const approvalKey = plugin => `${plugin.id}:${plugin.requestId || plugin.hash}`;
const Toggle = ({ value, onChange, children, disabled }) => <View style={s.toggle}><Text style={[s.help, { flex: 1 }]}>{children}</Text><Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: '#49867c' }} /></View>;
export function PluginApprovalCard({ plugin, pending, disabled, onDecide, onDetails }) {
  const [expanded, setExpanded] = useState(false);
  const [origins, setOrigins] = useState((plugin.origins || []).join('\n'));
  const [preview, setPreview] = useState(false), [agent, setAgent] = useState(false), [writes, setWrites] = useState(false);
  const locked = disabled || pending;
  return <View style={s.card}>
    <Text style={s.caption}>YOUR APPROVAL</Text>
    <Text style={s.title}>Install {plugin.name}?</Text>
    <Text style={s.help}>{plugin.publisher} · v{plugin.release}</Text>
    <Text style={s.text}>{plugin.description}</Text>
    <Text style={s.help}>Access to: {origins.split(/[\n,]/).map(value => value.trim()).filter(Boolean).join(', ')}. Requests can send app data to these services.</Text>
    {plugin.auth.type === 'oauth2' && <Text selectable style={s.help}>OAuth scopes: {plugin.auth.scopes.join(', ') || '(provider defaults)'}{'\n'}Login: {plugin.auth.authorizationUrl.replace(/^https:\/\//, '').split('/')[0]} · Tokens: {plugin.auth.tokenUrl.replace(/^https:\/\//, '').split('/')[0]}</Text>}
    {['api-key', 'bearer'].includes(plugin.auth.type) && <Text style={s.help}>Private credential: {plugin.auth.type === 'bearer' ? 'Authorization: Bearer …' : plugin.auth.header}. You'll connect it separately; never paste a key in chat.</Text>}
    <Toggle value={preview} onChange={setPreview} disabled={locked}>Allow Preview testing. Displayed data may be inspected or screenshotted by the AI.</Toggle>
    <Pressable onPress={() => setExpanded(!expanded)} disabled={pending}><Text style={s.link}>{expanded ? 'Less detail ↑' : 'Permissions & details ↓'}</Text></Pressable>
    {expanded && <View style={s.details}>
      <Text style={s.help}>Applies to all app revisions. Package {plugin.hash.slice(0, 12)}. These are local unsigned packages, not verified publishers.</Text>
      {plugin.permissions.map((permission, i) => <Text key={i} style={s.help}>• {permission}</Text>)}
      {plugin.network.configurable && <><Text style={s.help}>Approved origins (one per line):</Text><TextInput value={origins} onChangeText={setOrigins} editable={!locked} style={s.field} multiline autoCapitalize="none" autoCorrect={false} /></>}
      {plugin.auth.type === 'oauth2' && <Text selectable style={s.help}>Authorize: {plugin.auth.authorizationUrl}{'\n'}Token exchange: {plugin.auth.tokenUrl}{'\n'}Client auth: {plugin.auth.clientAuth || 'client_secret_post'}{'\n'}Extra parameters: {JSON.stringify({ authorize: plugin.auth.authorizationParams || {}, token: plugin.auth.tokenParams || {} })}</Text>}
      <Toggle value={agent} onChange={setAgent} disabled={locked}>Allow direct agent calls. Returned data goes into the selected model's conversation.</Toggle>
      {plugin.driver === 'http-json' && <Toggle value={writes} onChange={setWrites} disabled={locked}>Allow POST / PUT / PATCH / DELETE. These can change remote data without a per-call confirmation.</Toggle>}
      <Pressable onPress={onDetails} disabled={locked}><Text style={s.link}>Open full plugin details ↗</Text></Pressable>
    </View>}
    <Text style={s.help}>{agent ? 'Direct AI access enabled.' : 'Direct AI calls stay blocked.'} {writes ? 'HTTP write requests enabled.' : 'HTTP write requests stay blocked.'} Approved services can receive data even through GET URLs.</Text>
    <View style={s.actions}>
      <Pressable disabled={locked} style={[s.approve, locked && s.disabled]} onPress={() => onDecide('approve', { hash: plugin.hash, origins: origins.split(/[\n,]/).map(value => value.trim()).filter(Boolean), preview, agent, writes }, plugin.auth.type === 'none')}><Text style={s.approveText}>{pending ? 'Applying…' : plugin.auth.type === 'none' ? 'Approve & continue' : 'Approve installation'}</Text></Pressable>
      <Pressable disabled={locked} style={s.decline} onPress={() => onDecide('decline')}><Text style={s.help}>Not now</Text></Pressable>
    </View>
    <Text style={s.fine}>Protected Morph control · the editable app cannot approve this.</Text>
  </View>;
}
const s = StyleSheet.create({ card: { backgroundColor: '#182d35', borderWidth: 1, borderColor: '#436760', borderRadius: 14, padding: 14, gap: 9 }, caption: { color: '#7de2ce', fontSize: 9, letterSpacing: 1.5, fontWeight: '700' }, title: { color: '#eef4ef', fontSize: 16, fontWeight: '700' }, text: { color: '#d4e1e0', fontSize: 13, lineHeight: 19 }, help: { color: '#a0b8bc', fontSize: 11, lineHeight: 17 }, toggle: { flexDirection: 'row', alignItems: 'center', gap: 8 }, details: { gap: 10, paddingTop: 6 }, field: { color: '#d4e1e0', backgroundColor: '#0d1b23', padding: 10, borderRadius: 8, fontSize: 11 }, link: { color: '#7de2ce', fontSize: 11, paddingVertical: 4 }, actions: { flexDirection: 'row', alignItems: 'center', gap: 12 }, approve: { flex: 1, backgroundColor: '#7de2ce', borderRadius: 10, padding: 12, alignItems: 'center' }, approveText: { color: '#10242a', fontWeight: '700', fontSize: 12 }, decline: { padding: 10 }, disabled: { opacity: 0.4 }, fine: { color: '#7c999f', fontSize: 9 } });
