# Morph

An Android app launcher and protected Pi-backed builder. Apps own the screen; chat presentation and tools are editable. The host protects conversation records, pairing, model authentication, credentials, recovery and navigation.

## Model

- **Projects:** apps/plugins with virtual files, name/icon, drafts and immutable numbered releases.
- **Trash:** Delete stops/hides an app but preserves files, releases and saved data. Restore it or permanently delete it from Home → Trash. Chats and connected accounts are kept; permanent deletion does not erase separate backups.
- **Chats:** persistent conversations with a primary project and cross-project working set. Home **+** starts a new chat, not an empty app. Messages render native Markdown with selectable text, lists, headings, tables, quotes and horizontally scrolling code blocks. Web links open only when tapped; images are shown as alt-text links rather than automatically fetched.
- **Chat UI:** `app:morph-chat` is an editable, versioned system app: custom React messages/cards/panels from read-only conversation/tool data, plus sandbox handlers registered through Pi's native tool API. Optional native widgets and protected Safe recovery remain available. See [System chat](docs/SYSTEM-CHAT.md).
- **Running apps:** independent live instances retained across Home/chat navigation. Up to four apps and one Preview, plus independent system chat.
- **Runtime state:** React state and explicit `useAgentPort` state/commands. Reload/deployment may reset it.
- **Durable app data:** JSON storage independent of source releases. Save selected account IDs and other public app state here.
- **Plugin instances:** separate accounts/configurations, pinned to immutable recipes. An app can use several accounts and switch by instance ID.

The sandbox is trusted: the builder can edit/build/publish/deploy projects and operate apps without approval cards. Apps can access exposed state/commands and durable data across the sandbox. Credential/OAuth management alone remains protected. Generated code/model tools cannot read the vault, change OAuth registrations or enter credentials.

## Automatic usage history

The native host records a simple local raw stream for generated apps: taps (coordinates), control presses/toggles (native node ID and optional testID), surface shown/hidden transitions, and separate automation/test markers. No app instrumentation is required. The agent queries `usage_query({appID?,after?,limit?})`; history persists locally in `.data/usage.json`, bounded to the last 2,000 events (up to 500 per query). It records while connected, starting with this version—not past or offline activity. No typed values, labels, chat content, credentials or protected account UI are captured. Native IDs are transient; visibility means the host surface flag, not proof a section was actually seen. A tap and its control press can produce two raw records, not two distinct intentions. Model tests are not user activity. Never-encountered sections are useful non-use evidence too, but gaps in this bounded stream do not explain intent or prove a capability is unwanted. No background inference or external analytics is added.

## Built-in web research

The chat uses OpenAI's hosted `web_search` for live search and public-page opening/reading/find operations, using the existing Codex sign-in. Ask it to research a topic or browse a URL. It shows a compact browsing status and clickable Markdown source citations. Search/page opening were live-verified with `gpt-6.1-sol`; availability and usage limits depend on the selected model/account. No separate search API key or silent paid-provider fallback is configured.

This is not a logged-in browser, website form automation, a local-network fetcher, or independent app-runtime inference. Web content remains untrusted task data. Credentials never enter search queries or generated code. The hosted tool is added alongside—not instead of—the restricted sandbox tools; website execution happens at OpenAI, not in a privileged phone browser.

## Current prototype

Expo SDK 54 / React Native shell running in Expo Go, with a same-phone Termux Node backend. Generated React 18 executes in isolated WebViews and renders validated **actual native controls**, not DOM widgets. Preview and deployed app runtimes are separate. Esbuild compiles only virtual source and allowed modules. The builder uses restricted Pi SDK tools, not shell/host-file tools.

Supported primitives include View, Text, Pressable, TextInput, ScrollView, Switch, Button and ActivityIndicator. Apps use `@morph/agent` for ports, cross-app operations, storage and user-initiated builder requests; `@morph/plugins` for account-instance service calls.

The network broker validates declarative recipes, pins credentials to an instance's recipe/origins, uses bounded public HTTPS with DNS checks/no redirects, and redacts known credentials from responses. Included recipes: public HTTP, Bearer HTTP, read-only Gmail and Garmin Personal API. A generic protected private-header token exchange captures text JWTs or mapped JSON tokens inside the host and renews them on demand. Garmin uses this recipe with a Personal API key entered only in Accounts & plugins; neither the key nor derived token reaches app code/chat. Real Gmail OAuth needs the user's Google Cloud registration. A generic protected browser OAuth primitive also supports provider-page login/MFA and fixed callback interception, with host-owned PKCE and token renewal. The bundled unofficial Ecobee reference uses it for thermostat Home/Away holds; real sign-in, scope acceptance and device commands still require testing. See [plugin authentication](docs/PLUGINS.md#protected-browser-oauth-generic-primitive).

## Development

In Termux:

```sh
cd ~/morph
node dev.mjs
# After dependency changes, rebuild Metro's file map/cache:
node dev.mjs --clear
```

Backend: `127.0.0.1:8787`; Metro: `127.0.0.1:8081`; Expo URL: `exp://127.0.0.1:8081`. Keep both services private. The native shell pairs using a private local token; Codex login happens in the protected Control room. `--reuse-pi-auth` explicitly opts into existing Pi auth.

```sh
cd server && npm test
cd ../mobile && npm run export:check
```

The mobile postinstall script adapts Metro's legacy image-path call to the security-patched `image-size` v2 byte API. Keep it enabled when installing dependencies; cold development bundles include LogBox PNG assets that production export may omit.

Data lives under `.data/`: project workspaces/releases, library/chats, public app data, private credentials and account-instance records. Back up before changing the format. One-time import preserves old data; old APIs and permission workflows are not maintained for backwards compatibility.

## Documentation

- [Editable system chat and Pi tools](docs/SYSTEM-CHAT.md)
- [App/runtime/agent bridge](docs/AGENT-BRIDGE.md)
- [Plugin account instances](docs/PLUGINS.md)
- [Testing](docs/TESTING.md)

## Boundaries

This is not an audited hostile-code sandbox. Blocking generated JS can hang a WebView. Credential files are mode-0600 in Termux, **not encrypted Android Keystore storage**. Disconnect is local, not provider-side revocation. Native screenshots/component callbacks do not prove physical tapping or keyboard behavior. A connected foreground device is needed for real rendering/testing.

Standalone APK, embedded backend, encrypted native credential storage and independent per-app LLM inference are future work. Device/reconnect/service reload may reset live state; durable app data survives.
