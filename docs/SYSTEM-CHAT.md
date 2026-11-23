# Editable system chat

`app:morph-chat` is a versioned **system app**, listed as **Chat UI** in Home. Edit `/apps/morph-chat/App.tsx` and optional `/apps/morph-chat/tools.ts` (or `tools.js`) with the ordinary qualified VFS/build/Preview/deploy/versions workflow. Focus `app:morph-chat` before deploying its Preview. The initial project is installed once; restarts never overwrite user edits.

The chat runtime runs independently of four ordinary apps and Preview. Dock/Full/Close change its overlay, not the running apps. The system project cannot be trashed or closed by project tools.

## Custom React presentation

Compose your own React components using the supported native controls. **No fixed transcript or composer widget is required.** The starter renders custom messages and expandable tool cards, including a dedicated saved-note card.

```jsx
import {View, Text} from 'react-native';
import {useChat, Markdown, ChatScrollView, ChatComposer} from '@morph/chat';
export default function Chat() {
  const chat = useChat();
  return <View style={{flex:1}}>
    <Text>{chat.title}</Text>
    <ChatScrollView style={{flex:1}}>
      {chat.messages.map((m,i) => <View key={i}>
        <Text>{m.role === 'toolResult' ? m.toolName : m.role}</Text>
        <Markdown value={m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').slice(0,18000)}/>
      </View>)}
    </ChatScrollView>
    <ChatComposer/>
  </View>;
}
```

`useChat()` returns a deeply frozen display snapshot:
- `title`, `busy`, `connected`, `messageCount`, `mode` (`docked`, `full`, `preview`);
- `messages`: recent Pi `user`/`assistant`/`toolResult` records, projected to text/tool-call blocks, timestamps, tool names/IDs, errors, bounded `details` and `structuredContent`;
- `event`: the latest coalesced Pi message/tool/lifecycle event, including bounded partial/final tool results when available;
- `truncated`: history exceeded the display budget.

`getChatSnapshot()` reads the same snapshot outside React (including in tool handlers). Display data is bounded: up to 100 messages/~192 KB, 18,000 characters per text block, 8 KB tool arguments and 16 KB detail objects. Thinking/provider/auth metadata is omitted; images become placeholders. This is a display projection, not the complete session log. Updating the projection cannot modify host records. Custom presentation can omit or mislabel data; the protected **Safe** view remains authoritative.

Optional defaults: `ChatMessages` (original native conversational transcript), `ChatComposer` (real native input/send), `ChatStatus`, `Markdown` (safe native Markdown), and `ChatScrollView` (native scrolling with scroll-to-end). All accept bounded styles as applicable. `ChatMessages` also accepts `userStyle`/`assistantStyle`; `ChatComposer` accepts `placeholder`/`inputStyle`/`buttonStyle`. At most one host composer is allowed. The host draft and send callback are never exposed to generated JavaScript. A separate custom composer may use ordinary app-origin `agent.send`, but does not gain authentic human-message provenance or bypass gesture/rate limits.

`@morph/chat` and chat-native primitives are reserved for system-chat snapshots; ordinary apps and package code cannot import this API.

## Pi-native project tools

Pi remains the agent engine. The optional tools file exports a registration factory using **Pi's `registerTool`, parameter schemas, execute signature, partial updates, cancellation and result format**:

```ts
import {Type} from 'typebox';
import {storage} from '@morph/agent';
export default function tools(pi) {
  pi.registerTool({
    name:'chat_note', label:'Save note', description:'Save a useful note.',
    parameters:Type.Object({note:Type.String({maxLength:2000})}),
    async execute(toolCallId, {note}, signal, onUpdate) {
      signal.throwIfAborted();
      onUpdate?.({content:[{type:'text',text:'Saving…'}],details:{pending:true}});
      await storage.set('latest-note',{note});
      signal.throwIfAborted();
      return {content:[{type:'text',text:'Saved.'}],details:{note}};
    },
  });
}
```

The host registers these definitions with Pi's actual extension runtime; Pi owns model declarations, argument validation and execution events. Only serializable definitions/results cross the bridge. Handler functions execute in the editable WebView, **never credential-bearing Node**. Use existing storage/app-port/plugin clients there. The fifth `execute` argument is a minimal context (`cwd` as the virtual project path and `signal`), not a privileged Pi/Node context. This is not a loader for arbitrary Node extensions or the full Pi extension API; TUI render callbacks, filesystem/shell access, session mutation and privileged context methods are not available.

Transported definition fields: `name`, `label`, `description`, `parameters`, `outputSchema`, `promptSnippet`, `promptGuidelines`, `annotations`, `defaultActive`. Execution is host-policy sequential. Limits: 32 definitions, 16 KB each/128 KB total, names matching `[a-z][a-z0-9_]{0,63}` without host-tool collisions, 16 KB arguments, 64 KB text/image results (32 blocks), and 15-second execution. Cancellation is cooperative, not transactional rollback of already-issued storage/network operations.

Only the **live selected chat release** contributes tools; Preview can load factories but cannot register tools into the real session or execute them. Deploy/reload replaces definitions, chat switches bind them into the new Pi session, and Safe mode/disconnect/runtime failure withdraws them and aborts outstanding calls. A stale runtime cannot complete a replacement tool call. Host filesystem/shell tools remain excluded; project names cannot override protected host tools.

## Protected authority and recovery

- Native host owns canonical records, active-chat selection, the real draft/send/Stop path, credentials, pairing/account connection and recovery. No arbitrary host-source editing is added.
- Preview uses synthetic conversation data and an inert host composer. Model inspection/interactions cannot create a genuine native gesture or submit inference. Live chat screenshots are refused; fixture Preview screenshots are available.
- Existing app-origin inference safeguards still require a recent real native button gesture, preserve provenance and enforce rate/context limits. Tools cannot start background inference loops.
- A UI deployment preserves the host draft, conversation and ordinary app runtimes. Failed mounts do not publish a release and attempt to restore the previous UI.
- Protected header/menu controls offer **Safe** (native chat and tool withdrawal), **Custom** (reload selected UI), Dock/Full, Stop, Close and **Chat recovery**. Safe mode clears generated code and stays active until the user chooses Custom. Recovery controls do not depend on editable code or a healthy backend.
- Local credentials remain prototype mode-0600 private files, not encrypted Keystore storage. This is trusted user-owned code with bounded bridges, not an audited hostile-code isolation boundary; blocking JavaScript can still hang its execution realm.

Tests cover persistence, scoped imports/widgets, custom React, read-only data, actual Pi registration/schema validation, sandbox callbacks/updates/cancellation, withdrawal, session rebinding, deployment/rollback/recovery and empty-library restart. VM/native stubs and simulated paired clients do not establish physical Android correctness. Check keyboard, scrolling, overlays and Safe/Custom switching on the phone.
