import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Alert, StyleSheet } from 'react-native';
const Button = ({ title, onPress, disabled }) => <Pressable disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.35 }]}><Text style={s.buttonText}>{title}</Text></Pressable>;
export function VersionsPanel({ visible, onClose, state, send, canPromote, error }) {
  const [label, setLabel] = useState('');
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><View style={s.modal}>
    <View style={s.header}><Text style={s.heading}>App versions</Text><Button title="Done" onPress={onClose} /></View>
    <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 50 }}>
      {!!error && <Text style={{ color: '#ffb3ab' }}>{error}</Text>}
      <Text style={s.help}>Each promotion creates an immutable numbered release. Selecting an older release changes App, not your working draft. Permissions, account tokens and ephemeral UI state are not restored by code rollback.</Text>
      <TextInput style={s.field} value={label} onChangeText={setLabel} placeholder="Label the next promotion (optional)" placeholderTextColor="#78909a" maxLength={120} />
      <Button title="Promote tested preview as a new version" disabled={!canPromote} onPress={() => send({ type: 'promote', label })} />
      {!state.history?.entries?.length && <Text style={s.help}>No releases yet. Render a preview, then promote it.</Text>}
      {[...(state.history?.entries || [])].reverse().map(entry => <View key={entry.version} style={s.card}>
        <Text style={s.title}>v{entry.version}{state.liveVersion === entry.version ? ' · live' : ''}{entry.label ? ` — ${entry.label}` : ''}</Text>
        <Text style={s.help}>{entry.createdAt.slice(0, 16).replace('T', ' ')} · source {entry.id.slice(0, 12)}</Text>
        {!!entry.dependencies?.length && <Text style={s.help}>Pinned plugins: {entry.dependencies.map(p => `${p.id} v${p.version} (${p.hash.slice(0, 8)})`).join(', ')}</Text>}
        <Button title={state.liveVersion === entry.version ? 'Currently active' : `Activate v${entry.version}`} disabled={state.busy || state.liveVersion === entry.version} onPress={() => Alert.alert('Activate this app version?', `Load v${entry.version}? Draft source stays unchanged. Plugin source versions are pinned, but revoked/replaced plugin permissions may need review. UI state resets.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Activate', onPress: () => send({ type: 'activate_version', version: entry.version }) }])} />
      </View>)}
    </ScrollView>
  </View></Modal>;
}
const s = StyleSheet.create({ modal: { flex: 1, backgroundColor: '#0a1219', paddingHorizontal: 20, paddingTop: 46 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }, heading: { color: '#f4f3ec', fontSize: 26, fontWeight: '700' }, card: { backgroundColor: '#13222b', borderRadius: 14, padding: 16, gap: 12 }, title: { color: '#e1e9e8', fontSize: 17, fontWeight: '700' }, help: { color: '#90a7b0', fontSize: 12, lineHeight: 20 }, field: { color: '#e1e9e8', padding: 14, borderWidth: 1, borderColor: '#2a414c', borderRadius: 10 }, button: { padding: 12, backgroundColor: '#253a45', borderRadius: 10, alignItems: 'center' }, buttonText: { color: '#7de2ce', fontSize: 12, fontWeight: '700' } });
