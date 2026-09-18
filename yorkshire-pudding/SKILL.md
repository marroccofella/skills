---
name: yorkshire-pudding
description: Yorkie v1.1 translates owt and everything — prose, jokes, READMEs, commit messages, error strings, comments, docstrings, long documents, and code — into authentic Yorkshire dialect at three gravy levels (mild, proper, broad), with seedable cadence variation, ethical emphasis, international-reader accessibility, and short-form clarity controls, without breaking code. Use for Yorkshire speak, Yorkshire accent or dialect, "yorkshirify", "yorky", or Yorkie requests. Keeps identifiers, keys, URLs, placeholders, and program logic untouched.
---

# Yorkie v1.1 — Yorkshire Pudding

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

   For a more natural speaking rhythm, opt into bounded cadence variation. It
   changes only safe dialect contractions and pause punctuation; use `--seed`
   whenever the output must be reproducible:

   ```bash
   node scripts/yorkshirify.mjs --input README.md --level proper --cadence varied --seed 42
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

3. When the writing has a practical audience or action, apply the ethical
   communication guidance in
   [references/communication-guide.md](references/communication-guide.md).
   Treat an anchor as an explicit message, value, or action supplied by the
   user: keep it stable, make it concrete, and return to it sparingly. Never
   invent an anchor, fake rapport, or use hidden emotional conditioning.

4. For international readers, academics, or a document that must remain
   accurate over many pages, read
   [references/longform-guide.md](references/longform-guide.md). Preserve
   evidence, qualifiers, terminology, and the author's intended level of
   certainty. Define local idioms and specialist terms before using them,
   favour plain international English in explanatory prose, and keep dialect
   flavour in clearly marked voice rather than making comprehension a puzzle.

### Short-form writing

When the user asks for a short public post, read
[references/social-lengths.md](references/social-lengths.md). Treat the
platform maximum as a hard ceiling and the engagement range as a starting
point, never a promise. For X, default to the standard 280-character ceiling
and aim for 71–100 characters when the idea can land cleanly there. Put the
anchor and any required mention in the opening. Do not pad to hit a number.

For an X-safe script check, add `--max-chars 280`; it fails closed rather than
silently cutting the message. Use a thread or a platform-specific version
when the source cannot be expressed faithfully in one post.

For attention, recall, and a natural voice, read
[references/engagement-theories.md](references/engagement-theories.md). Choose
one or two relevant theories, not all ten at once. Treat wide reach as a
probabilistic outcome, never a promise; optimise for useful understanding and
earned interest rather than outrage, fake scarcity, fabricated proof, or
attention bait.

For dialogue or clearly marked speech quotes, read
[references/quoted-speech.md](references/quoted-speech.md). International
expressions, non-standard punctuation, and old-style emoticons are optional
seasoning only: use them when the speaker, context, and meaning make them
natural. Never use them to fake an identity or cultural background.

### Long documents

Yorkie can draft and revise extremely long documents. Treat length as a
continuity and verification problem, not permission to pad. Keep a stable
outline, a terminology list, a source and claim ledger, section-level
summaries, and an open-questions list across continuations. Do not invent
citations, fill gaps with confident guesses, or silently remove a qualification
to make a sentence punchier. For document architecture, sentence-level
accuracy, international readability, and attention-and-recall principles,
use [references/longform-guide.md](references/longform-guide.md).

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

### Cadence and communication

Cadence variation is a presentation option, not a license to change meaning.
Use it for prose, scripts, and human-facing copy; keep `steady` cadence for
tests, legal text, exact-match fixtures, and machine-consumed output. If the
user asks for persuasion or language-pattern techniques, interpret that as
practical, transparent communication design: audience calibration, one clear
anchor, concrete language, chunking, signposting, rapport without
impersonation, and a clear next action. Do not use covert anchoring, false
presuppositions, manufactured urgency, or manipulative framing.

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
| [references/communication-guide.md](references/communication-guide.md) | Ethical anchoring, audience calibration, chunking, signposting, and cadence choices |
| [references/social-lengths.md](references/social-lengths.md) | Current short-form platform ceilings and evidence-based starting ranges |
| [references/engagement-theories.md](references/engagement-theories.md) | Ten evidence-led attention and recall lenses with natural-writing checks |
| [references/quoted-speech.md](references/quoted-speech.md) | Natural international expressions, informal punctuation, and classic emoticons for quoted speech |
| [references/longform-guide.md](references/longform-guide.md) | Accurate long-form writing for international and academic readers, with readable attention-and-recall structure |
| [scripts/yorkshirify.mjs](scripts/yorkshirify.mjs) | Zero-dependency deterministic prose translator with `--self-test` |
