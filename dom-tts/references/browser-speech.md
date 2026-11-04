# Experimental local browser speech

Version 0.5.0-rc.2 retains the public browser recovery, queue and paragraph fixes and adds the expanded programme source. Personal notification settings, runtime state, credentials, recordings and native binaries are excluded. Optional companions are dormant until explicitly invoked. It is not a stable release.

Start with Node18+: run `node scripts/experimental/browser-session.js`, open its printed private local link, choose a local voice and click Enable spoken replies. Keep the page open. Never publish the access fragment or connection descriptor. The voice uses local browser speech synthesis, no microphone or cloud service. Speed accepts0.5–2; the initial default is0.9. Saved preferences do not enable a fresh page.

Run `node scripts/doctor.js --browser true` or `node scripts/browser-speak.js --command status`. Regular supplied speech uses `node scripts/browser-speak.js --text "A concise supplied reply." --enqueue true --wait false`. The browser CLI now defaults to wait=false. Retain the queued ID; retrieve its outcome with --command queue-receipt --id ID. Queued is not played or heard. Use --wait true for an explicit playback test only.

Stop with `node scripts/browser-speak.js --command stop`; it clears queued text and requires explicit --command restart. Disable revokes the browser connection. Boundary pause/resume/skip are available on the page. Do not interrupt another queued message merely to narrate your own reply.

An enabled document keeps retrying transient health requests with backoff capped at10seconds. Visibility/online events wake one polling loop. Interrupted speech is cancelled, terminal acknowledgement is reconciled and never automatically replayed. Stop requested offline settles before another speech poll. Reload, server restart, Disable, authentication or session change requires explicit Enable. This is same-document recovery, not a permanent speech grant.

Doctor distinguishes state-not-found, state-inaccessible, descriptor-invalid, owner-unobservable, loopback-denied, transport-unreachable/timeout, browser-page-not-enabled/disabled, lease-expired and build mismatch. A restricted caller's owner-unobservable or inaccessible result does not prove the service died. Check the actual authorized context before restarting; never bypass owner/ACL checks or kill a saved PID. DOM_TTS_STATE_DIR explicitly selects one shared private state location for launcher, CLI and notification integration.

## Speech during the reply

The final-only notification route cannot receive earlier progress. With only chat tools, display a useful commentary paragraph, submit that supplied paragraph with --wait false, and continue composing. That is agent-driven paragraph delivery, not automatic token capture. Avoid duplicate final narration.

An application that actually owns a selected live prose stream can pipe flushed UTF-8 to `node scripts/reply-stream.js --format plain --wait false`. Plain prose admits completed sentence/paragraph boundaries before stdin ends; Markdown waits for completed blank-line blocks and holds open fences/reference tails. EOF seals only the unsaid suffix. No model is called, transcript watched or other chat discovered. The owning client may use createReplyRelay from scripts/reply-stream.js; append waits only for HTTP admission, finish seals input, receipt is optional audio diagnostics and cancel revokes the owned reply. Do not await terminal audio on the text-display path.

Codex notify currently exposes agent-turn-complete: https://learn.chatgpt.com/docs/config-file/config-advanced . An application-owned selected app-server integration can receive item/agentMessage/delta: https://learn.chatgpt.com/docs/app-server . This candidate does not attach to the running Desktop application's event stream.

## Bounds and acceptance

Supplied speech is bounded; the CLI accepts1000characters, the manual queue6000characters within the HTTP limit, and reply-stream16000UTF-8 bytes. Text expires after2minutes, including while queued/paused/active. In-memory protocol history remains bounded at64messages/128tracked segments; admission may refuse at those limits and receipts are lost on restart. Do not claim unlimited default delivery. No automatic replay or reset is introduced to conceal that limitation.

The status health ring contains at most24state/time records and last-poll age; no speech text, token, path or transcript. It is live metadata, not a retrospective diagnosis of every disconnect.

Historical Windows listening of local hal.8 was human-confirmed at rate1.8. An isolated actual browser recovered after two batches of7 and10 dropped HTTP poll requests and completed a new sentence. Local hal.8 passed9914core assertions plus focused recovery/protocol checks. Those results are separate from validation of this newly packaged public candidate and its hosted CI. OS sleep/resume, real background discard, non-Windows listening, other-context delivery, sustained bounded-history behavior and release review remain open.
