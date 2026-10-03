# Dom TTS 0.4 development build

4 October 2026, Asia/Dubai. Version 0.4.0-dev.1.

## Delivered

This branch publishes source for independent testing. Copies installed for Codex and Claude Code on the developer's Windows machine completed playback with Microsoft Hazel Desktop and returned to idle. Audibility remains unconfirmed. Private review evidence, runtime state, settings, recordings and the local ZIP are excluded from Git.

## Four baseline defect regressions

| Defect | Regression evidence in scripts/self-test.js |
|---|---|
| Prose lines dropped | Six explicit assertions preserve sentences beginning Git, Node, npm, Python, cd and PowerShell; separate commands remain filtered. |
| Double dash spoken as decrement | tests/corpus/golden.json contains dash inputs with literal expected output across eight modes. Text-output checks do not establish acoustic pronunciation. |
| Chunks exceed the two-minute budget | Explicit long-input tests enforce 720 characters at speed 1 and the 8 × speed × 90 budget at speeds 0.5, 1 and 2. Seeded cases test maximum and word boundaries. Character budgeting is a heuristic; actual voice durations need measurement. |
| Watcher silently loses messages | Failed speech retains cursor 0, marks failure and leaves deduplication empty; a successful retry advances the cursor and counts one message. |

## Assertion breakdown

The 9,244 counted assertions comprise 8,640 seeded chunk-property checks, 512 expected-output comparisons (64 synthetic inputs × eight modes), and 92 other regression, CLI, watcher, IPC, diagnostics and syntax checks. This is not a corpus of 9,244 distinct real assistant replies.

## Plan gates

| Gate | Candidate status |
|---|---|
| Merge baseline | Four defect regressions covered; full acceptance and merge remain open. |
| Windows verified | One machine only. Native stop-to-process-exit timings: 33 ms and 63 ms. Second machine or clean VM, acoustic timings and device cases remain open. |
| Release | Agent-in-the-loop scoring, listening tests and independent review quorum remain open. |
| Next version scoped | Cross-platform adapters followed the owner's expanded request before evidence gates closed. They remain experimental. |

From the repository's dom-tts directory, run npm test, node tests/install-check.cjs, and source manifest verification through require('./scripts/package').verify().

The root Actions workflow runs portable checks on Windows, macOS Intel/Apple Silicon and Linux x64/ARM64. Native macOS/Linux playback, injection, environment and stop tests remain outstanding.

## Behavior

- Windows SAPI, macOS say and Linux espeak-ng providers selected by the OS.
- Pure Node core with no architecture-specific npm modules or model SDKs.
- A shared stdin/file/text interface for any command-capable harness or model.
- Agent Skills installation for Codex/Claude and an explicit custom parent for other hosts.
- Codex final-answer JSONL, strictly end_turn-marked Claude JSONL, and generic JSONL readers.
- Corrected prose filtering, identifier/dash cleanup, abbreviation splitting and chunk limits.
- Failed watcher playback stays pending for retry; it is never counted or deduplicated as spoken.
- One Windows speech engine per request; local authenticated IPC stop without killing recorded PIDs.
- An IPC-connected native worker cancels its child when the calling process dies.
- Persistent private status contains operational fields, not spoken text or transcript paths.
- Typed diagnostic JSON, allowlisted child environments and source-manifest-verified installation.
- Fresh install, upgrade, retained rollback and reversible uninstall with unrelated skills preserved.

## Executed checks

| Check | Result |
|---|---|
| Node 22.16.0 offline suite | 9,244 assertions passed |
| Node 24.19.0 offline suite | 9,244 assertions passed |
| Golden corpus | 64 synthetic inputs × eight modes; not the full real-reply/listener corpus |
| Chunk properties | 1,000 fixed-seed strings; maximum, reconstruction and word boundaries |
| CLI | Strict modes/profiles/options, equals text values, speed boundaries, stdin/file equivalence |
| Watcher | Partial/CRLF records, failed speaker retention/retry, dedupe cap, stop, truncation, deletion and format filtering |
| IPC interruption | Fake-owner test under 500 ms; native Windows runs 33 ms and 63 ms to process exit |
| Windows process safety | Unrelated recorded PID survived; locks and temporary speech files removed |
| Windows injection | Hostile speech and voice values created no sentinel file; invalid voice failed visibly |
| Owner crash | Native child ended; dead-owner recovery removed lock and temporary speech |
| Diagnostics | Sanitized fields only; private directory checks passed |
| Install lifecycle, Node 22/24 | Preview, install, repeat/upgrade, settings preservation, rollback, uninstall and unmanaged refusal passed |
| Fresh ZIP extraction | Manifest verification and all 9,244 assertions passed |
| Skill Creator validation | Passed; PyYAML installed only into the isolated test-dependency folder |

Local environment: Windows 11 Home Single Language build 26300, x64;
Windows PowerShell 5.1.26100.9444. Speech voices available: David, Hazel, Zira,
Helena and Sabina Desktop. Process completion does not establish audibility or
listener quality; owner listening confirmation remains pending. Stop measurements
are process-exit durations, not recorded acoustic latency or first-sound latency.

An initial new-adapter native run failed; direct diagnostic and subsequent
same-source native runs passed. Its underlying transient cause was not conclusively
isolated. The failed attempt is retained in the chat/tool record; it is not a pass.

## Compatibility limits

The macOS Intel/Apple Silicon and Linux x64/ARM64 adapters are implemented,
but native audio receipts from those hosts are outstanding. Windows ARM64 is also
unverified. No functioning WSL distribution was available here. Linux needs an
installed espeak-ng and audio route. CI covers Windows, macOS Intel/ARM and Linux
x64/ARM with Node 18/20/22/24, but it has not been dispatched to hosted runners.

Direct commands are model-independent. Native discovery and transcript schemas
vary by harness; this does not establish automatic integration with every agent
product. A Claude transcript lacking end_turn needs direct invocation or a generic
producer. No microphone, cloud voice, barge-in, avatar or Duplex feature is enabled.

The supplied plan's second Windows machine, clean non-admin setup, Bluetooth/sleep
and device cases, acoustic timings, outbound-traffic audit, complete Tier 3 agent
scoring and Tier 4 listener evaluation remain outstanding. Their thresholds have
not been declared met, and no evolution decision is based on invented measurements.

## Independent review

The owner explicitly approved source sharing to Claude, Antigravity, Copilot and
Grok after automatic approval review initially rejected the provider destinations.
Only source artifacts were submitted. Three OAuth-only MOMM attempts ran:

| Run | Scope | Outcome |
|---|---|---|
| rev_20261003201602_87155fc6e9af | Full Git diff | Claude/Copilot/Grok timeout; Antigravity invalid output; quorum 0/2 |
| rev_20261003202222_bcd7e521bf7f | Complete final source/tests/docs | Claude/Copilot/Grok timeout; Antigravity invalid output after one retry; quorum 0/2 |
| rev_20261003202925_482f7699dc9d | Executable runtime safety | All four external routes timed out; quorum 0/2 |

Codex was self-excluded as governor in each run. There were no usable findings or
suggestions, no agreement score, verdict split, unique catches or risk heatmap.
These are transport/output statuses, not evidence of a clean review or authentication
failure. No login change or quota workaround was attempted. Usage was unavailable,
not zero. Actual final test executions and source hashes were recorded with MOMM
checks; no completion receipt is issued when external quorum is unmet.

The disposition table has no entries because no valid findings or suggestions
were returned. No fabricated disposition rows were appended. Reviewer outcome
ratings and all attempts remain in the private `.ensemble_reviews` ledger.

**This is a locally usable development candidate. Independent review and cross-host
release gates remain open; it is not a stable, universally certified 0.4 release.**
