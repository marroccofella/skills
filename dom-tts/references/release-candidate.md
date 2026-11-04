# Dom TTS 0.5.0-rc.2 — expanded source candidate

This prerelease consolidates the public browser/core candidate with the expanded local programme source. It is an unsigned source archive, not a finished stable 0.5 release or trusted Windows installer. The reviewed manifest and SHA256 receipt identify its exact bytes.

## Included

- Local browser speech with same-document connection recovery, bounded per-chat scheduler sources, queue-pressure draining and provider-specific Stop.
- Display-first supplied live-paragraph relay and supplied completion notifier. Both use identities explicitly provided by their owning caller; neither discovers chats or reads transcripts.
- Managed installer transaction recovery, explicit native-settings migration and supplied Codex/Claude/OpenClaw event adapters.
- Windows native speech, tray, setup and signing/readiness source; no compiled executable or certificate.
- Optional local voice-studio source with separate recording/remote-request consent and opt-in provider selection; no microphone, cloud request or credential is activated by install.

## Run the local browser provider

Use Node 18 or newer, preferably a maintained LTS. No npm install is required. Run `node scripts/experimental/browser-session.js`, open its private loopback link, choose a local voice and explicitly Enable spoken replies. Keep that page open. Check `node scripts/doctor.js --browser true`, then submit supplied text with `node scripts/browser-speak.js --text "A supplied reply." --enqueue true --wait false`. A queued job is not completed audio or human hearing. Use wait=true only for an explicit voice test.

Stop through `node scripts/browser-speak.js --command stop`. It clears queued input and suppresses further delivery until explicit Restart. A fresh page or restarted server requires Enable.

## Stable acceptance still required

The relay exports `hostForwardingRequired:true` and `automaticDesktopSubscription:false`. Every-chat progressive speech requires the owning Desktop client to forward its live public events. The completion-only notification route cannot create paragraph events. The source package does not attach itself to existing Desktop chats.

Exact-candidate live multi-chat/browser lifecycle and listening tests, native Windows clean-second-host/macOS/Linux audio receipts, actual harness trigger scoring, independent release acceptance and trusted signed Windows component/setup tests remain gates. Portable hosted CI and injected media/provider tests do not replace those results. Track [issue 70](https://github.com/marroccofella/skills/issues/70).

Historical evidence in EVOLUTION.md and COMPATIBILITY.md applies only to its named versions. Existing source and protocol regressions are retained; new expanded-source checks exercise consent, cancellation, trust refusal, package integrity, managed recovery and explicit adapter boundaries without using a live microphone or cloud account.
