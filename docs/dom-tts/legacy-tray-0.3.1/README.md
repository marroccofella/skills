# Dom TTS legacy tray: complete source and review handoff

By Prof Dom Marrocco / 42.uk. Evidence collected 2026-10-04.

**ARCHIVAL REVIEW SOURCE, NOT A STABLE RELEASE OR AUTOMATIC INSTALLER.**
This is a sanitized snapshot of the owner's installed Windows `read-aloud`
0.3.1 companion. It is deliberately outside the active `dom-tts` skill.
Do not install it over an existing skill, start its watchers against private
transcripts, or run its installer/export/support tools just to inspect it.

## Start here

- [Full provenance, operations, controls and gaps](TRAY-APPLICATION.md)
- [Cross-harness, streaming, web control and release specification](NEXT-PROGRAMME.md)
- [Independent acceptance protocol](ACCEPTANCE.md)
- [All implementation source](source/scripts/)
- [Original installed-file hashes](original-source-hashes.json)
- [Sanitization record](SANITIZATION.md)
- [Reproducible packet verifier](verify-packet.cjs)

The packet includes all 41 legacy scripts, provider adapters, package and lock
files, voice catalog, avatar HTML, and four icon formats. Operational state,
installed settings, voice-runtime configuration, avatar preferences, transcripts,
audio, logs, credentials, node_modules and duplicate nested skill installations
are excluded. Fresh example configurations are supplied, not copied user data.

Run the offline packet verification from this directory:

```powershell
node verify-packet.cjs
```

This checks file hashes and JavaScript syntax. It does not install dependencies,
start audio, activate microphones, monitor conversations or prove menu actions.
Windows PowerShell parsing and the historical command-shape smoke test are
separate checks described in ACCEPTANCE.md.

## Answer to the source-publication question

The published `codex/dom-tts-standard-baseline` commit
`fd2811ef640b4e6cf29a0d2dc281a55022e1e164` contains a deliberately smaller
0.3.2-dev.1 Standard core, not the installed 0.3.1 tray companion. Its committed
tree has no tray-app.ps1, settings.ps1, control-panel.ps1, global watcher,
avatar server, Duplex runtime or legacy installer. Current main at
`f5113f163e9f4f0810512c8663b99bb9098b936f` has no committed dom-tts tree.
The 0.4/0.5 candidates live on development branches/PRs, not main.

This establishes missing files on those exact trees, **not** that no other
branch or repository ever contained them. The original installed companion's
Git commit and immutable distribution receipt remain unidentified. Package
version alone is inadequate provenance. This packet preserves exact original
file hashes and records the two publication-only sanitizations.

## Known limitations

Source inventory is not functionality certification. Neither two hosts' hash
inventories nor two reports written by one reviewer satisfy independent reviewer
quorum. No human listening, screen recording, native Linux/macOS verification,
signed executable or store publication is claimed by this handoff.

Edge sends narration text to an online speech service. It must not be described
as local-only simply because playback occurs on Windows. SAPI is the offline
legacy path; the new core uses OS-native offline providers.
