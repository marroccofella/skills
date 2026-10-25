# Sanitization and provenance

49 files were copied from the installed legacy source/static allowlist. Their
pre-publication SHA256 values are in original-source-hashes.json. No installed
configuration or operational state was copied. The verifier records the
published bytes independently in packet-manifest.json.

Publication-only changes:

1. scripts/export-distribution.ps1: replace a hardcoded owner's workspace output
   directory with a user-profile-relative DomTTS-dist default.
2. scripts/install-dom-tts.ps1: omit a personal email from generated author
   metadata; preserve Prof Dom Marrocco and https://42.uk attribution.

Everything else in the original allowlist retains its installed bytes. New
example settings are deliberately conservative: no global transcript discovery,
no microphone, no automatic voice shell, no cloud provider and no startup speech.
These examples are **not** evidence of the installed hosts' current settings.

Historical labels Bob/Bab and SB2/SB3 in UI source are product example identities,
not published machine addresses. No private home paths, transcript contents,
microphone recordings or LAN endpoints are included. Public vendor URLs and
package integrity strings are not credentials. Package-lock.json includes
dependency resolution/integrity metadata, not installed dependencies.

The old support-bundle.js and installer/export code are included for completeness
but are not endorsed as privacy-safe release utilities. Review them before use;
old status/settings/log collection can include user speech and local paths.
Hashes establish byte equality, not authorship, trusted signing or safety.
