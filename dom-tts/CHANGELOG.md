# 0.5.0-rc.4 — reliability source candidate

- Preserve sanitized transport classifications when a response body is interrupted after headers, while malformed data and cryptographic failures remain unverified. Revalidate an ambiguous connection through bounded fresh authenticated read-only status checks before disabling an enabled document; never replay an admission or automatically Enable/Restart. Stop/Disable, cancellation acknowledgement and Stop-generation checks remain authoritative.
- Accept a late speaking acknowledgement for a retained settled job as an idempotent no-op after the current-client check. Completion can overtake this asynchronous acknowledgement; it must not disable the page, refresh the lease, alter another active job or undo Stop. Wrong-client and unknown-job acknowledgements remain refused.
- Split supplied speech at sentence/word boundaries within UTF-8 limits, preserving graphemes when a token itself exceeds the limit. Replace absolute two-minute expiry with bounded healthy-playback activity renewal; stalled, paused, disconnected and abandoned work still expires. Scale playback deadlines with text length and rate while retaining a finite startup deadline. An explicit wait timeout preserves the admitted job identity and does not stop other replies.
- Keep sealed reply-stream observation separate from playback ownership: its optional 125-second wait timeout or receipt transport failure reports uncertainty with the original identity instead of cancelling speech. Explicit interruption still cancels the owned reply; ordinary wait=false delivery does not wait for playback.
- Retire only fully settled harness/OpenClaw histories so 64 retained records are not a lifetime turn quota. Preserve pending and uncertain delivery and keep a bounded retired-identity window. Make expected Claude hook no-ops nonblocking, normalize before speech limits and visibly excerpt oversized prose rather than silently skipping it.
- Classify definitive native output-device and voice failures even after a zero engine exit, bound child output and parse voice identifiers. Doctor exposes missing-engine reasons and does not equate a process check with audible playback. Separate the reporting build from a persisted playback build.
- Anchor native/helper/setup/tray trust to reviewed source publisher pins and actual PE product/version. The source policy is empty until a publisher is reviewed; no certificate or provider is activated. Refuse new arbitrary-path tray autostart registration and honor private state overrides.
- Restore local artifact exclusions and require a bounded reviewed source-file recipe before packaging. Add `npm run test:all`, new regression suites and accurate version labels. Remove obsolete one-time RC2 cleanup/publication jobs; CI builds exact-head source artifacts without retagging an existing release.
- Preserve rollback to the exact published RC2 snapshot through a separate source-pinned historical verifier, without executing backup code or weakening new-package checks. Refuse unknown legacy snapshots, linked source ancestors and hardlinked source files. Use the new external installer for restoration and rollforward.
- Prove a descriptor-driven Node listener on one exact socket before token/text delivery. Protect an already-loaded trusted browser page with authenticated encrypted RPC, bounded replay refusal and no persistent token. Refuse the tray's older browser transport/opener. Fresh trusted HTML bootstrap remains required; old saved URLs are not authenticated. Upgrade client/server/page together and explicitly Enable the fresh link.
- Invalidate older speech-admission and queue-control authority at global Stop, valid Disable and close. Bind Node request-entry monotonic intent to its v2 proof and check again after body reads; bind browser controls to a Stop generation captured before asynchronous previews. Late responses cannot lower the browser's generation. Fresh explicit controls still work; read-only receipts and owned cancellation remain available. Mixed-runtime clock compatibility is not universally certified.
- Check authenticated speech responses again at use, discard older poll commands after observing Stop, cancel an older active job without losing its acknowledgement, stop an older Enable preview once, and refuse late Enable UI success. Preserve fresh post-Restart delivery. A submitted network Stop is not a completed playback acknowledgement.
- Inspect Windows Assembly version metadata as bounded PE bytes instead of loading unsigned images through Reflection. Keep actual product/file resource assertions and malformed-input checks; this does not establish signing or application-control acceptance.
- Stable 0.5 remains gated on owning-client Desktop forwarding, exact-candidate listening/platform acceptance and trusted signed distribution. Controlled fixtures and compile-only checks do not certify those capabilities.

# 0.5.0-rc.3 — unreleased, superseded source candidate

- Embed a consistent Dom TTS product name, exact informational package version, numeric file/assembly version and component description in Windows speech, tray and setup builds. Validate version input before generating compiler metadata and remove temporary source files after compilation.
- Add portable version validation and actual Windows compile-only PE resource checks to the hosted matrix. Product metadata prepares trusted signing; outputs remain unsigned until a trusted signing provider is configured. Desktop live attachment and stable native/platform acceptance remain open.
- Clarify the skill's recording/transcription/cloning exclusion and distinguish an explicit voice-test instruction from test/control words inside supplied readout text, preserving nonwaiting speech admission for ordinary replies.
- Make the discovery description explicitly about speech output and exclude microphone listening, recognition and creating or imitating voices before the skill is loaded.

# 0.5.0-rc.2 — 4 November 2026

- Report typed metadata for failed, timed-out, signalled and empty speech child launches without automatically retrying uncertain admission. This improves diagnosis; it does not establish the cause or cure of the reported intermittent silent launcher exit.
- Derive installer crash-test child deadlines from the unchanged production permission-check bound and the exact number of checks. Preserve real Windows ACL checks and give the expanded Windows CI job its measured runtime allowance.
- Consolidate expanded programme source with public rc.1 without replacing its stronger ZIP integrity checks or browser regression fixtures.
- Include managed installer recovery, native-settings migration, Windows speech/tray/setup builders, supplied host adapters and consented optional studio. Optional components remain dormant, unsigned native components remain refused and no runtime/settings/credential/evidence files are distributed.
- Restore the browser speech reference in the expanded package and make current version/scope explicit. All-chat paragraph attachment remains dependent on the owning client; stable native and hardware gates remain open.

# 0.5.0-rc.1 — supplied paragraph delivery and queue isolation

Fix stranded unsaid tails under128-segment pressure, nonterminal receipts, shared-identity receipt mixing, dynamic source isolation and Stop revocation. Retire settled sources within a32-source bound while preserving manual, failed and open work. Add a host-owned live paragraph relay, final-only Codex event adapter, queue-aware doctor and reproducible portable source packaging. No Desktop global subscription is installed. Stable/native/setup acceptance remains open.

# 0.5.0-dev.3-browser.2 — rolling browser delivery history

Fix long-running enabled companions refusing new speech once 64 message histories accumulated, even with an empty healthy queue. Roll out only closed, fully completed/cancelled messages before capacity is exhausted; retain pending/failed/open streams. Clean completed expiry bookkeeping, bound metadata and reject 256 recent retired identities without replay. Receipts are a rolling window and old identities beyond it are not a durable deduplication store. Native security checks, explicit Stop/restart, two-minute text expiry and local-only playback stay intact.

# 0.5.0-dev.3-browser.1 — browser recovery and nonblocking supplied speech

Adds the local browser companion and its required queue/renderer dependencies. Keeps retrying same-document transport health with bounded backoff, preserves cancellation and offline Stop, adds idempotent terminal acknowledgements and typed metadata-only readiness diagnostics. Browser CLI defaults to nonblocking admission. Supplied paragraph/sentence streams can speak before completion; no automatic Desktop subscription or watcher. Saved speed accepts0.5–2. Development only; protocol history remains bounded.

# 0.5.0-dev.1 — bug-fix evolution

Based on reviewed 0.4.0-dev.2 (75ba1ce, PR #39). Failure-first terminal summaries,
saved inclusion settings and watcher precedence, filename/path status summaries,
fresh-process Windows ACL checks, POSIX mode revalidation, recovery cleanup ownership,
relative/project-local Linux engine rejection, sanitized blocked-policy/install errors,
meaningful settings preservation, native privacy/latency verdicts and checked-in native
boundary tests. No new providers, global watcher, microphone, tray or Duplex features.
The previous golden/reply corpus stays; five expectations changed after output review.
See EVOLUTION.md for migration and open release gates.

# Changes

## 0.5.0-dev.1 follow-up: permission cache removed

- The Windows ACL check runs on every call. The in-process cache and the
  `.private-verified` marker are removed (legacy markers are deleted after a
  successful check). An ACL change on the same folder in the same process, or a
  folder replaced at a checked path, is now refused instead of skipped.
- tests/permission-cache-checks.cjs adds the regression tests; tests/windows-privacy.cjs
  changes a real ACL and rechecks in the same process.
- The self-test reports shared, POSIX-only and Windows-only assertion counts separately.
- An attempt to create the install stage inside the checked backups folder (eecca32) was
  reverted: a backups folder that is private but has non-inheritable ACL entries passes its
  check, yet a stage created inside it is not private. The stage keeps its own explicit
  permission check. tests/windows-privacy.cjs now installs under such a folder and checks
  the installed destination.

## 0.4.0-dev.2

- Windows permission check: 60-second limit, typed failure reasons, and a folder-bound
  marker so it runs once per state folder instead of before every playback.
- Automatic recovery of a dead owner's playback lock, orphaned speech files and stale
  "speaking" status; live owners and locks still being written are never removed.
- Markdown tables spoken row by row; blockquote markers removed; unified diffs and
  Python stack frames skipped in informative mode; log modes read fenced output and
  match names such as FileNotFoundError.
- A POSIX state directory too long for the stop socket (over about 85 characters;
  macOS allows 104 bytes per socket path) now fails with a clear message instead of
  a truncated socket.
- 30 realistic multi-paragraph replies added to the corpus with per-mode expectations.
- One path-filtered CI workflow; the 0.3.2 workflow and the inert nested copy removed.
  CI verifies the committed manifest instead of regenerating it.

## 0.4.0-dev.1

- Portable CLI and Agent Skill, with Windows SAPI, macOS say and Linux espeak-ng adapters.
- Golden text corpus, strict options, abbreviation-aware summaries, word-aware bounded chunks.
- Retain failed watcher messages for retry; consent-gated commentary and normalized JSONL.
- One Windows speech process per request; authenticated local IPC stop without PID killing.
- Private, atomic runtime state without stored speech snippets or transcript paths.
- Allowlisted child environment and portable typed diagnostics.
- Hash-verified source installation with retained upgrade/rollback/uninstall snapshots.

Native macOS/Linux audio, a second Windows host, agent trigger scoring and listener
quality evaluation remain required before a stable release.

