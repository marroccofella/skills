// Public documentation, generated with the site's release version. No network calls.
export function llmsText(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid MOMM version');
  return `# MOMM — Mixture of Model Modality

> MOMM (spoken "mom") is a local multi-CLI peer-review skill for code and documents. Your current agent is the sole writer and verifier; other reviewers return untrusted claims, not instructions to execute.

This is the portable MOMM Agent Skill in marroccofella/skills, not a hosted API-key review service. Published stable version: ${version}. Development branches and planned releases are not installed-release capabilities. This plain-text guide is optional documentation, not a crawler directive or a guarantee of indexing or answer-engine citation.

## Start here

- [Overview and written workflow](https://marroccofella.github.io/skills/momm/): roles, review stages and an explicitly illustrative before/after example, available as HTML without playing a video.
- [Install or upgrade](https://marroccofella.github.io/skills/momm/install.html): complete verified procedure and approval boundaries.
- [First review](https://marroccofella.github.io/skills/momm/start.html): setup and a practical walkthrough.
- [Reference](https://marroccofella.github.io/skills/momm/reference.html): account logins, privacy, costs, modalities and failure states.
- [Architecture](https://marroccofella.github.io/skills/momm/technical.html): responsibilities and evidence boundaries.
- [Stable version notes](https://marroccofella.github.io/skills/momm/releases/${version}.html): released changes and limitations.
- [Published source](https://github.com/marroccofella/skills/tree/momm-${version}/momm): signed-tag source; verify the signature before executing downloaded code.

## Installation and first commands

Paste this request into your coding agent (it is a prompt, not a shell command):

Install MOMM for me by following https://marroccofella.github.io/skills/momm/install

Requirements include Node.js, Git, an Agent Skills-compatible harness and installed reviewer CLIs with eligible account sessions. CLI runtime requirements may be stricter than MOMM's. Signed-release verification needs gitsign. Do not execute an unverified clone, silently install prerequisites, overwrite local edits or bypass a signature failure. Read the linked installation procedure; installation, harness targets and protocol changes require explicit approval. Automatic updates are off by default.

Only after preparing and verifying the published release, preview an installation from that verified clone (replace the placeholder with your chosen supported harness):

    node momm/scripts/install.mjs --target <chosen-harness> --dry-run

For an installed, trusted skill, use its actual absolute dispatcher path below. Run from the project you want reviewed. Replace <current-harness> with the harness actually driving the work, for example codex; it is excluded from peer review.

    node "<installed-momm>/scripts/multi-review.mjs" --preflight --governor <current-harness>
    node "<installed-momm>/scripts/multi-review.mjs" --capabilities --json
    node "<installed-momm>/scripts/multi-review.mjs" --governor <current-harness> --min-success 2

Preflight makes zero model calls: it checks installation and account evidence, not live media ingestion. The review command sends the current Git diff to selected external providers. For a permitted document instead, use --input <project-local-text-file>; do not submit confidential material without permission. Fewer than two successful external reviewers fails the explicit minimum above; that is not a clean review.

## Capabilities and boundaries

- Code diffs, specifications, manuscripts and other permitted text can be reviewed. Example: reviewers challenge a specification's contradictory acceptance criteria; the governor checks the cited passages and records its decisions.
- The default reviewer pool is Codex, Claude Code, Antigravity, GitHub Copilot and Grok, with the active governor excluded. Legacy Gemini CLI is opt-in for eligible accounts. Installed adapters and account availability determine which routes actually run.
- Attachments can include images, PDFs, audio or video only where the installed route's effective capability allows them. Not every route accepts every modality. Use the local capability report; model names, vendor marketing and file extensions are not proof that a route can process content. Preflight is not a synthetic modality probe.
- Capability probes are separate, disclosed synthetic tests; generation consent and account/quota limits still apply. Do not assume a documented or model-only capability is locally verified. Unsupported or failed routes do not count as successful reviews.
- Reviewers are read-only peers. The governor investigates material claims, reproduces defects, authors any fixes, verifies them and records every suggestion's disposition. Agreement alone is not proof of correctness. Separate routes are not proof of statistical independence.
- OAuth/account logins only, not API keys. MOMM is MIT-licensed; provider subscriptions, quotas and charges are separate. Selected providers receive sanitized review input: redaction is not a confidentiality guarantee and local orchestration is not offline inference.
- Private project evidence stays in .ensemble_reviews/ and must not be published by default. Completion validation checks recorded decisions and local file hashes, not the truth of model reasoning or universal safety. Runtime, platform and media coverage have limits documented in release notes.
- MOMM coordinates and reviews work; it does not automatically merge, release or publish it. Narration and graphics made with separate tools are not outputs generated by MOMM itself.

## Evidence and discovery

- [Evidence and limitations](https://marroccofella.github.io/skills/momm/evidence.html): historical development observations, not a controlled accuracy benchmark.
- [Public data](https://marroccofella.github.io/skills/momm/data/): deliberately sanitized evidence downloads, not users' private ledgers.
- [Approved media](https://marroccofella.github.io/skills/momm/media.html): each film identifies its recording version; an older film is not a demonstration of every current feature.
- [Improvement process](https://marroccofella.github.io/skills/momm/improvement.html): bounded observations, human decisions and release authority.
- [Repository](https://github.com/marroccofella/skills): source, issues and contributions.
- [Project sitemap](https://marroccofella.github.io/skills/sitemap.xml): published page catalogue.
- [Host crawler policy](https://marroccofella.github.io/robots.txt): robots.txt is served only from the host root; its rules still cover /skills/.
- [Discovery verification checklist](https://marroccofella.github.io/skills/momm/discovery-status.md): distinguish accessibility, indexing, search appearances and citations.
`;
}
