---
name: yorkshire-pudding
description: Translate owt and everything — prose, jokes, READMEs, commit messages, error strings, comments, docstrings, even whole code files — into authentic Yorkshire dialect at three gravy levels (mild, proper, broad) without ever breaking the code. Use when a user asks for Yorkshire speak, Yorkshire accent or dialect, to "yorkshirify" something, t'northern version of a text, or invokes yorkshire pudding by name. Includes a zero-dependency deterministic script for plain prose and strict safety rules that keep identifiers, keys, URLs, placeholders, and program logic untouched.
---

# Yorkshire Pudding

Turns owt and everything into Yorkshire speak — jokes, prose, documentation,
and code — wi'out breaking a single build. Reet good fun, engineered like it
matters, because it does: a joke that breaks t'pipeline in't funny.

## The two golden rules

1. **Never break owt.** When the input is code, translate only the zones a
   compiler ignores and a human reads: comments, docstrings, and human-facing
   message strings. Identifiers, keywords, keys, URLs, regexes, SQL, format
   placeholders, i18n keys, and exact-match test fixtures stay exactly as they
   were. The full zone map is in
   [references/code-translation.md](references/code-translation.md).
2. **Affection, never mockery.** Yorkshire dialect is a living variety of
   English with its own grammar, not a comedy accent. Write it the way
   Yorkshire writers write it — warm, dry, economical. Keep to genuine
   Yorkshire forms and avoid stray Geordie, Scouse, or Lancashire words; the
   authenticity notes in
   [references/dialect-guide.md](references/dialect-guide.md) mark the borders.

## Gravy levels

Ask the user which level they want if they haven't said; default to **proper**.

| Level | Nickname | What it applies |
|---|---|---|
| `mild` | a splash o' gravy | Greetings and lexicon words only ("ey up", "champion", "chuffed", "ta"). Grammar untouched. Safe for text that must stay broadly readable. |
| `proper` | proper gravy (default) | Everything in mild, plus definite article reduction ("t'"), were-levelling ("I were"), g-dropping ("doin'"), "o'"/"wi'", owt/nowt/summat. |
| `broad` | swimmin' in gravy | Everything in proper, plus thee/tha/thi, -sen reflexives, h-dropping ("'ave", "'ouse"), allus, baht, 'appen, nobbut, bairn. Full-strength; readers may need a translation back. |

## Workflow

### Plain prose, jokes, and markdown

1. For a fast deterministic pass, pipe the text through the bundled script:

   ```bash
   echo "The cat sat on the mat" | node scripts/yorkshirify.mjs --level proper
   node scripts/yorkshirify.mjs --input README.md --level broad
   ```

   The script protects fenced code blocks, inline code, URLs, emails, and
   placeholders (`${var}`, `%s`) automatically. It spawns no subprocesses and
   makes no network calls. `--self-test` runs its deterministic suite.

2. Then improve on it by hand. The script is mechanical seasoning; you are the
   cook. Reorder for Yorkshire rhythm (short, dry, understated), choose idioms
   from [references/dialect-guide.md](references/dialect-guide.md), and land
   punchlines on the dialect word, not before it. For jokes specifically:
   translate the setup lightly and spend the dialect budget on the punchline —
   see [references/examples.md](references/examples.md).

### Code

Do **not** pipe source files through the script. Work by hand, zone by zone:

1. Read [references/code-translation.md](references/code-translation.md) for
   the translate/never-touch zone map.
2. Translate comments and docstrings freely at the requested gravy level.
3. Translate human-facing strings (log messages, CLI help, UI copy) only
   after confirming nothing parses or asserts on their exact content — grep
   for the string in tests and consumers first.
4. Leave every identifier, key, URL, regex, SQL statement, format
   placeholder, and i18n key untouched.
5. Run the project's tests afterwards. If owt fails, the translation went
   somewhere it shouldn't — revert that zone.

**Full-pudding mode** (renaming identifiers too — `fetchData` →
`fetchTGubbins`) is available only for throwaway joke code, requires the user
to opt in explicitly after a warning that it changes the public API, and must
never touch anything on a branch that ships.

### Anything else

Commit messages, PR descriptions, error pages, presentations, poems: treat as
prose. Keep required structure intact (conventional-commit prefixes, issue
numbers, semver strings stay as-is — "fix: mend t'flaky login test" is
correct; "mend: fix t'flaky login test" is not).

## Resources

| File | What's in it |
|---|---|
| [references/dialect-guide.md](references/dialect-guide.md) | Lexicon, grammar rules (DAR, were-levelling, thee/tha, -sen), exclamations, regional and authenticity notes |
| [references/code-translation.md](references/code-translation.md) | Zone map for code: what to translate, what never to touch, per-language examples |
| [references/examples.md](references/examples.md) | Worked before/after examples: Python, JavaScript, a joke, an error message, a commit message |
| [scripts/yorkshirify.mjs](scripts/yorkshirify.mjs) | Zero-dependency deterministic prose translator with `--self-test` |
