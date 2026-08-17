# Dependencies, private data, and optional runtimes

Run the portal and every F5 script with Promptus's managed Cosy Python, discovered from
`%APPDATA%\promptusai\install.json`. Do not create a separate Python environment for the portal: doing so
would test different Torch, audio, and F5 packages from the ones Promptus actually uses.

The workspace `requirements.txt` declares the complete Python surface:

- portal and signal gate: Flask, NumPy, SoundFile;
- word-accuracy gate and extended analysis: librosa, Torch, Transformers.

Nothing in that second group is optional for the portal. Every master is checked against the intended
narration, and the portal refuses to approve speech from signal checks alone — a missing or uncached
Whisper verifier fails the job rather than downgrading it. Torch and Transformers are optional only for
the CLI scripts, which can run signal checks on their own.

`start-portal.ps1` checks Flask, NumPy, and SoundFile before starting, so a portal missing the ASR stack
still launches and only fails once a render reaches the word gate. Install the full `requirements.txt`
into the Cosy environment, and warm the Whisper cache once, before relying on the portal.

The shared output verifier also checks at runtime and fails closed: missing NumPy or SoundFile, or an
audio decode exception, prevents the output from being marked approved.

## Private runtime data

`portal\data` contains recordings, exact transcripts, job text, logs, generated QA evidence, and
the optional Whisper cache. The workspace `.gitignore` excludes the entire directory, along with
`narrations` and `downloads`. Treat those exclusions as a privacy boundary, not as permission to share the
workspace wholesale.

Rejected reference folders are removed immediately. Accepted references retain only the processed WAV,
matching transcript, and metrics; temporary browser and decoded copies are removed. Job narration files are
removed after the six-hour in-memory retention period. Finished audio remains in Promptus Comfy Output.

The portal fixes its Whisper cache at `portal\data\models\huggingface` and expects
`models--openai--whisper-small.en` inside it; only the CLI `transcribe_f5_quality.py --cache-dir` can be
pointed elsewhere. Either way, never place the cache under `models\comfy_models`, where it would consume
Promptus's enforced model budget.

## Auditing Promptus model storage

Promptus enforces a model budget per backend, `COSY.MAXIMUM_MODELS_SIZE`. When it is reached, Cosy stops
installing new cosyflows and logs `install would exceed maximum models size; returning False`. F5 voice
cloning needs no new weights, so it keeps working — but everything else the user tries next will fail.

Audit before recommending any deletion:

```powershell
& $PromptusPython "$SkillRoot\scripts\audit_promptus_models.py"
```

It is read-only and deletes nothing. It reports the models directory and budget from the backend config,
which filenames are loaded by at least one executable node, which are orphaned, failed-download `.error`
stubs, and same-size candidate duplicates. Add `--hash-duplicates` to prove byte-identical files, and
`--json` for machine-readable output. Exit `2` means the directory already exceeds the budget.

**Never build a deletion list from `external_model_dependencies`.** That field is what Promptus reports
through `/api/generate/get-cosyflows`, and it is not a complete usage index: it does not resolve models
referenced inside subgraph nodes. The worker says so itself at startup —
`custom_nodes.dependencies: need special handling for WorkflowNode(type=workflow>...)`. On the diagnosed
machine, fourteen files looked unreferenced by that measure and eight of them — about 45 GB — were in fact
loaded by active cosyflows including two Promptus-authored ones. Walking every node instead is the only
correct test.

Two further rules the audit encodes:

- A filename inside a `Note` or `MarkdownNote` node is documentation telling the user what to download, not
  a load. Counting it hides genuine orphans; counting only loader nodes finds them.
- An orphan is a candidate, not a verdict. A model with no reference in any saved graph can still be chosen
  by hand in Playground or ComfyUI, and `/api/generate/get-models` will still offer it. Personal
  checkpoints a user downloaded deliberately belong to the user; list them and let the owner decide.

Freed space does not stay free. `COSY.COSYFLOW_AUTO_INSTALL_TITLES` is retried at every Cosy start, so any
entry that was previously blocked for lack of room downloads as soon as room exists. Check that list before
reporting reclaimed space as available.

The 2026-08-15 read-only audit is the concrete example: cleanup first reduced usage to 380.61 GB and left
31.39 GB free, but the next Cosy start successfully installed the previously blocked Flux Kontext Dev and
HiDream I1 Fast dependencies. The current audited state is 407.63 / 412.00 GB with 4.37 GB headroom, across
63 model files and 446 scanned graphs. The two remaining 1.99 GB orphans are personal checkpoints and are
not deletion targets without the owner's explicit decision.

## The espeak-ng artefacts (removed)

The workspace once carried a `downloads\espeak-ng` directory and an `assets\sitecustomize.py`. Neither was
used by F5-TTS — they were preparation for the separate Promptus Zonos speech path, which was never
configured — and both were deleted on 2026-08-15. This entry stays so nobody reintroduces them under the
belief that espeak is an F5 dependency: it is not. If Zonos is deliberately configured later, install and
verify its runtime as a fresh, separate task.

## Project-to-installed-skill sync

The workspace is the source copy. Run `sync-promptus-clone-voice.ps1` with no switch to compare it with
`%USERPROFILE%\.codex\skills\promptus-clone-voice`. Review the reported files, then rerun with `-Apply` to
copy project files. The script never deletes destination files. Run the skill validator after every sync.
