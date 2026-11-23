# Testing Morph

```sh
cd ~/morph/server && npm test
cd ../mobile && npm run export:check
```

The Node suite covers restricted Pi tools/VFS, library import and project isolation, chat persistence, independent live identities, durable app data, native-tree validation, React hooks/events, rendering/settlement/replacement errors, explicit ports, app request provenance/limits, recipe releases, credential/origin boundaries, account-instance separation, OAuth PKCE/exchange/refresh/replay protection and instance recipe pinning.

Protected token-exchange tests cover Garmin's documented plain-text JWT shape with fake credentials, mapped JSON response fields, bounded expiry, persisted private caches, independent accounts, concurrent renewal, reconfiguration/disconnect races, endpoint/header/origin restrictions, failure-body secrecy and in-flight token redaction. Text exchange requests retain the same DNS pinning/private-network restrictions. No real Garmin key/provider connection has been tested.

Hosted web research tests verify provider gating, preservation of restricted tools, hook composition, compact activity, URL/citation safety and native citation conversion through the real Codex SSE adapter with a mock transport. Unit tests make no live model/search calls. A separate one-off live smoke test verified the full builder session searching/opening OpenAI documentation and returning a clickable citation with the existing Codex login and gpt-6.1-sol.

The service test starts an isolated paired backend with fake private credentials and a simulated native client. It exercises preview/deploy/rollback, failure recovery, a storage receipt while mounting, chat/project navigation without remounting, cross-app commands/data, protected account setup and rejection of sandbox credential-management calls. It never starts a paid model turn or contacts a real OAuth provider.

Some low-level broker tests deliberately exercise restrictive engine configurations as security invariants. The actual Morph application uses the trusted sandbox: there are no internal project, port, plugin-use or publication approval cards. Credentials/OAuth are protected separately.

Also request the actual development bundle after a cold `node dev.mjs --clear` startup; production export alone omits some development-only assets and cannot validate a long-running Metro file map after dependency installation. The suite includes a LogBox PNG asset regression for Metro with image-size v2. Mobile postinstall applies the byte-input adaptation reproducibly.

Android export checks JSX/module bundling, not physical correctness. Runtime tests use simulated callbacks, not Android touches.

## Physical checks still required

1. Open Home, start a chat with **+**, create/build/deploy an app and return to the launcher.
2. Run a second app; change state in both. Switch Home/chats/apps and verify state stays alive. Close/redeploy an app and confirm runtime state resets while durable data survives.
3. Ask the builder to inspect/invoke a named app's ports. Verify the target is explicit, including when another app is foreground.
4. Open two instances of the same credentialed package. Enter credentials only in protected setup; connect two accounts, choose between instance IDs, and disconnect one without disrupting the other.
5. Publish a changed recipe. Verify old connected instances remain pinned and new instances require their own connection.
6. Trigger an app-origin builder request using an actual app button. Confirm one queued receipt, the correct builder chat, compact human transcript and no background inference loop.
7. Test keyboard show/hide, multiline composer and measured overlap on this phone. Layout logs contain numeric geometry, not chat text.
8. Render an intentional error and test actual screenshot/diagnostics. Test async service effects with quiet settlement; don't mistake settled for successful service/authentication.
9. Exercise reconnect/restart separately: live React state may reset, but chats/files/releases/account links/durable data must survive.
10. Ask chat to search a current topic and open a public documentation URL. Verify compact browsing status and clickable real source citations. Web pages are task data, not instructions; login/form automation is not supported. Stop must still abort the active model request. Never claim fresh research when the provider/model rejects web access.
11. Delete a running app: it must stop, disappear from Apps and appear in Trash without disturbing other runtimes. Restore and verify exact source/releases/saved data; runtime state starts fresh on launch. Permanently delete only from Trash, confirm cancellation works, and verify chats/accounts remain. Deleting the last app must leave an empty launcher across reconnect/restart, not recreate a starter app. Permanent deletion does not remove separate backups.

Real Gmail requires Google Cloud registration with `http://127.0.0.1:8787/oauth/instances/callback`. Browser account choice, physical keyboard correctness, foreground screenshots and provider behavior cannot be established by VM tests.

Before deployment, back up `.data` privately. It includes credentials. Mode-0600 Termux storage is not Android Keystore encryption. Do not publish backups or service pairing tokens.
