# MOMM 1.18.1 — release candidate

Sealed for release on 4 November 2026 at the owner's request ("get 1.18.1 reviewed and
released"), to be merged and signed only once every gate passes on the sealed commit; see the
[gate record](gates-1.18.1.md). Until the signed tag `momm-1.18.1` exists, 1.18.0 remains the
stable release.

1.18.1 is a small patch to 1.18.0. One writer, read-only reviewers, account logins only and
automatic updates off: none of that changes, and neither does the review contract.

## What changes

- **A Bumbler can be switched off for default reviews.** A saved Bumbler joins every review
  unless you name reviewers. You can now keep one saved but out of default runs: untick
  **Joins default reviews** in the Setup Center (Bumblers in the review pool), or set
  `"enabled": false` for it in `bumblers.json`. It stays saved and listed, marked
  "off: used only when named", is left out of the default preflight, and is used only when
  you name it, for example `--reviewers codex,grok,bab`. Leaving the setting out means on, so
  existing setups behave exactly as before. Any value other than `true` or `false` is refused
  when the file is read. Saving a name replaces its whole entry, so typing the name of a saved
  Bumbler in the Setup Center sets the box from that entry: re-saving a switched-off Bumbler to
  change its model keeps it off.
- **A refused summary says which rule it broke.** A review or a second look whose summary is
  unusable was refused with "missing or oversized summary" whatever the cause. It now says
  `missing summary`, `blank summary`, `summary is not text (number)` (or the type it was), or
  `summary is 1001 characters (UTF-16 units), over the 1000 limit`. Only the type or length is
  given, never the summary text. Both validators share one rule. Which answers are accepted is unchanged: a summary of 1 to 1000 UTF-16
  code units that is not blank. This came from a live review in which Antigravity's answer was
  refused and the old message could not say why.

## Not in 1.18.1

- Bab is not registered as a default reviewer. A shared model server that is called
  automatically by every default review needs the operator's standing agreement first; that
  is separate from this release. The switch above makes a registered-but-off Bab possible
  once that is agreed.
- Native Bumbler transport, and Bab's engine and sampling work, are not part of 1.18.1.
