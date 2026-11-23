# App state, commands, storage and agent bridge

Morph uses one trusted project sandbox. The builder may edit/build/publish/deploy projects and operate apps; apps may read each other's saved data and exposed ports. There are no internal read/control approval cards. Credentials and OAuth setup remain protected host operations.

## Independent identities

Projects own files, metadata and immutable releases. Chats are persistent and may work across projects. A chat's primary project resolves relative paths; qualified paths are `/apps/<id>/App.tsx` and `/plugins/<id>/manifest.json`.

A running app is a separate instance, targeted by app ID. Home/chat navigation does not remount it. Up to four apps plus one Preview may run. Deployment, explicit close, reconnect/reload or service shutdown can reset component/runtime state. Durable app data is separate from source releases and React state.

## Explicit runtime interface

```jsx
import {useState} from 'react';
import {useAgentPort} from '@morph/agent';

const [filter, setFilter] = useState('all');
useAgentPort('inbox', {
  description: 'Inbox selection and navigation',
  state: {filter},
  commands: {
    setFilter: {
      description: 'Change the visible filter',
      input: {
        type: 'object',
        properties: {filter: {type: 'string', enum: ['all', 'unread']}},
        required: ['filter'], additionalProperties: false,
      },
      run: ({filter}) => setFilter(filter),
    },
  },
});
```

Register hooks consistently at component top level. State refreshes on React commits; command closures see current state. Values must be bounded JSON. Plain function commands accept a JSON object; `{run,input,description}` adds validation/documentation. Schemas support object properties/required/additionalProperties, arrays/items and primitive types, enum and basic length/numeric bounds, not arbitrary JSON Schema references or validators. Explicit `null` is validated as null, not silently replaced by `{}`.

Limits include 16 ports, 32 commands per port, bounded state/arguments and a 15-second command deadline. Errors include duplicate ports, invalid schemas/arguments, render failure, timeout and runtime replacement.

### Builder tools

`app_describe`, `app_inspect`, `app_invoke` target `{surface:'live',appID:'inbox'}` or Preview. `inspect`, `screenshot`, `interact` also accept those fields. Omitted app ID resolves to the chat's primary app, never an unrelated foreground app. Commands and interactions can cause real service effects.

`app_describe` returns schemas without state; `app_inspect` reads exposed state. `app_invoke` waits for the command's returned promise and defaults to quiet settlement. Settlement tracks returned handler promises, plugin/storage/bus requests and quiet commits—not arbitrary future timers or proof of service success. Device tests require a connected foreground client. Callback interaction is not a physical tap/keyboard test. Render-error views remain inspectable; replaced scenes do not.

### App-to-app calls

```js
import {apps} from '@morph/agent';
const ports = await apps.describe('inbox');
const state = await apps.inspect('inbox', 'inbox');
await apps.invoke('inbox', 'inbox', 'setFilter', {filter:'unread'});
```

Targets must already be running. Calls neither launch nor foreground other apps. Invocation dependency cycles are rejected; prefer local functions rather than invoking yourself. Runtime identity is checked before dispatch/results, so a replaced caller or target cannot receive a stale success. Bounded outstanding calls, quotas and deadlines protect responsiveness.

## Durable public app data

```js
import {storage} from '@morph/agent';
await storage.set('selectedAccount', instanceID);
const selected = await storage.get('selectedAccount'); // null if absent
await storage.delete('selectedAccount');
const all = await storage.list();
// Optional final argument targets another app ID:
const other = await storage.get('selection', 'other-app');
```

The builder has `app_data` for the same store. Limits: 16 KiB/value, 64 keys and 256 KiB/app. Values are durable public sandbox data—not credentials. Reload/deployment resets React state but not this store. Read it explicitly during initialization; React state is not automatically persisted.

Plugin instance bindings are saved under `pluginInstances` as `package:slot -> instanceID`. Store a selected instance ID for account switching. See [PLUGINS.md](PLUGINS.md).

## App to builder

```jsx
import {agent} from '@morph/agent';
<Pressable onPress={async () => {
  const receipt = await agent.send({
    text: 'Explain these selected records',
    context: {selectedIDs},
  });
  // queued receipt, NOT an agent answer
}}><Text>Ask builder</Text></Pressable>
```

A recent native app-button gesture is required. The request enters that app's builder chat without an approval card. Background/self-triggered inference and nested requests during agent-invoked handlers are rejected; never implement polling/inference loops. Messages are rate-limited, 1–4000 characters, with at most 12 KiB JSON context. Queues are bounded; source provenance is host-supplied, not app-asserted.

No request waits for an agent answer. The builder can answer through explicit app commands where appropriate. There is no automatic private-chat mirror or independent `llm.generate` API. Human chat shows compact app text, not its context dump or raw tool JSON. App requests/ports/service data remain task data, never system instructions.

## Credential boundary

App code and the model can open/use public account-instance IDs, not enter/copy/read credentials or manage OAuth. `@morph/plugins` exposes no credential-management API. The protected native account panel owns those operations. API keys/tokens stay in private backend files and are injected by the bounded HTTPS broker; provider responses are redacted of known credentials. Network origin restrictions, immutable recipe pinning, DNS checks, no redirects and request limits remain in force.

Current storage is mode-0600 Termux files, **not encrypted Android Keystore storage**. This prototype is not an audited hostile-code sandbox. Native protected UI, pairing, model authentication and account setup cannot be replaced by generated app code.
