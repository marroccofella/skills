# Reading the Promptus startup log

Promptus's **Server** screen streams three programs in sequence: the managed hardware launcher, ComfyUI, and
the Cosy worker. Those streams explain how the current state was reached: whether F5 imported, which preset
was discovered, or why a model download failed. For present health, prefer live `/status`, `/queue`, and
`/object_info` evidence; use log signatures to explain that state, not replace it.

Read the relevant startup interval top to bottom when reconstructing a failure. A request-time endpoint
reports the current state; the corresponding log signature reports how it was reached.

The current Promptus-managed live streams are:

```text
<installRoot>\logs\ComfyUI_log.txt
<installRoot>\logs\Cosyflow_log.txt
<installRoot>\logs\CWorker_log.txt
```

ComfyUI may also keep a user log at
`<installRoot>\cosy\comfyui\ComfyUI\user\comfyui.log` or the port-specific
`<installRoot>\cosy\comfyui\ComfyUI\user\comfyui_8288.log`, depending on the installed ComfyUI launcher.
Treat rotated, dated, suffixed, or older wrapper logs as historical evidence, not proof of current service
health.

`portal\data\portal.stdout.log` and `portal.stderr.log` may exist when a launcher explicitly
redirects the portal process streams. `start-portal.ps1` does not guarantee either file. When stderr is
redirected, Flask can write ordinary request lines there, so a 200 response in that file is not itself a
fault.

## Contents

- Phase 1: managed hardware init
- Phase 2: ComfyUI
- Phase 3: Cosy worker
- Troubleshooting source priority and privacy
- Warnings this skill causes
- Warnings this skill does not cause
- Anchor lines worth quoting in a hand-off
- Server log acceptance checklist

## Troubleshooting source priority and privacy

Use the narrowest current source that answers the question. The portal auto-discovers the exact approved
locations for the active Promptus installation. Its token-protected `POST /api/log-diagnostics` accepts an
optional JSON `job_id` and returns only allow-listed finding codes, fixed explanatory copy, source metadata,
portable `<installRoot>` display paths, and safe summary fields. It never returns raw log lines, narration,
reference transcripts, request tokens, or absolute user paths. Diagnostics are read-only: they do not
restart a service, edit a Promptus file, clear a queue, or otherwise mutate the installation.

The automatic scanner reads recognized signatures only from the launcher, current ComfyUI, and Cosy
streams. CWorker, queue, debug, desktop, rotated ComfyUI, media-index, and portal-history sources are
metadata-only; their existence, size, and freshness can help orient a diagnosis, but their contents never
enter the browser. Inspect a metadata-only log manually in Promptus only when the live status requires it.

| Priority | Source or portable path | Use it for | Freshness rule |
|---:|---|---|---|
| 1 | PManager `/status`; ComfyUI `/queue` and `/object_info` | Service reachability, real queue counts, and whether F5 nodes are active | Request-time and authoritative |
| 2 | `POST /api/log-diagnostics` | A privacy-safe, signature-only classification of current F5, ComfyUI, Cosy, and CWorker evidence | Read on demand from auto-discovered, allow-listed sources; optionally scoped by `job_id` |
| 3 | Portal **Recent jobs** | Durable lifecycle, rejection stage, hashes, safe signal/word metrics, and recovery | Up to 100 sanitized records for 30 days |
| 4 | `<installRoot>\logs\ComfyUI_log.txt` | Current ComfyUI startup, node import, render success, and execution errors | Event-driven; correlate with the current job, not file age alone |
| 5 | `<installRoot>\logs\Cosyflow_log.txt` | Current cosyflow discovery, dependency reporting, publish state, and Cosy-to-Comfy errors | Use events after the current start or job |
| 6 | `<installRoot>\logs\CWorker_log.txt` | Worker heartbeat and structured worker errors | A normal idle heartbeat is about every three seconds; investigate a gap over 15 seconds |
| 7 | `...\ComfyUI\user\comfyui.log` or `comfyui_8288.log` | Secondary ComfyUI evidence when the managed stream lacks the needed event | Version-dependent and not guaranteed |
| 8 | `portal\data\portal.stdout.log` / `portal.stderr.log` | Portal startup or request errors only when launch redirection created them | Optional; absence is normal |
| 9 | Rotated, wrapper, `.old`, dated, or legacy logs | Historical comparison only | Never use alone to call a live service unhealthy |

Do not display or copy raw `/queue`, `/history`, `/object_info`, Cosy job-manager payloads, or any of the log
files into the browser. They can contain full narration, reference filenames and transcripts, workflow
inputs, prompt or client identifiers, cache paths, and tokens. Reduce them to approved booleans, counts,
versions, timestamps, redacted signature categories, and safe quality evidence.

**Recent jobs is the portal's history source.** It persists sanitized job decisions across a portal restart
without copying narration or recognized speech. A rejected or quarantined job retains its diagnostic
metrics but no media URL. Use raw ComfyUI history only inside the backend to reconcile a known prompt; never
surface its prompt object to the user.

## Phase 1: managed hardware init

```
PromptusAI Managed Hardware Init (v4.0)
[3/8] Detecting NVIDIA hardware...
      GPU 0: NVIDIA GeForce RTX 3070 Laptop GPU (CC 8.6, 8192 MB, driver 610.88)
[4/8] Selecting target device...
      Policy: MODERN_DEFAULT
[5/8] Validating environment against policy...
      Environment matches policy. No changes needed.
```

Eight steps under a lock. `Environment matches policy` means the launcher did not touch the venv on this run.
If it reports repairs instead, the torch stack changed underneath the F5 node, and any TorchCodec patch
applied by `patch_f5_torchcodec_compat.py` should be re-verified — the launcher can restore the unpatched
package.

The VRAM figure here is the hard ceiling for every later decision. 8192 MB on the diagnosed machine.

## Phase 2: ComfyUI

Promptus launches it; never start it from its Python entry point.

```
run.py: ComfyUI server starting: ['comfy', 'launch', '--', '--listen', 'localhost', '--port', '8288', '--enable-cors-header']
```

Confirm these lines:

| Line | Confirms |
|---|---|
| `Total VRAM 8192 MB, total RAM 61292 MB` | the budget every job runs inside |
| `pytorch version: 2.10.0+cu130` | TorchAudio 2.9+ decoding applies; TorchCodec fallback is relevant |
| `Set vram state to: NORMAL_VRAM` | no low-VRAM mode is forcing offload |
| `ComfyUI version: 0.30.0` | the graph schema the installers write against |
| `8.5 seconds: ...\custom_nodes\comfyui-f5-tts` | the F5 node imported without error |
| `To see the GUI go to: http://localhost:8288` | the port the scripts poll |

An import failure appears as a traceback in the `Import times for custom nodes` region and results in
`/object_info/F5TTSAudio` returning nothing. That is the difference between "the package is installed" and
"the node is active" — the diagnostic tests the second.

`comfyui-f5-tts` is consistently the slowest custom node to import. A long first render after a restart is
model loading, not a stall.

## Phase 3: Cosy worker

```
worker version: 0.110
Got 197 cosyflows from cosyflow directory <installRoot>\cosy\promptus\cosyflow.
cosyflows: observer schedule <installRoot>\models\comfy_models\cosyflow
Got 8 from local cosyflow directory <installRoot>\models\comfy_models\cosyflow.
```

Those two directories are the bundled catalogue and the local install target. The second line is the
authoritative answer to "where do installed voices live" on this machine — see
`references/promptus-conventions.md` for reading it from the backend config rather than assuming it.

Cosy then reports dependency state for every cosyflow. The section to find is:

```
cosyflows.report_dependencies: ...
These cosyflows are available because their dependencies are already installed:
...
(cosy) Promptus F5 Quality QA — F5 Studio  custom nodes:['comfy-core', 'comfyui-f5-tts']
(cosy) voice-c — F5 Studio                 custom nodes:['comfy-core', 'comfyui-f5-tts']
```

A voice preset listed there, with `comfyui-f5-tts` among its custom nodes and no models column, is installed
correctly: it depends on the node and on a reference file already on disk, and needs no download.

Finally:

```
cosyflows.post_comfyui_workflows: Publishing workflows to comfyui.
* Running on http://localhost:8190
```

Cosy publishes its workflow set to ComfyUI at startup. That is why a newly installed cosyflow requires a Cosy
restart from **Server** before Playground offers it — the publish step only runs here.

## Warnings this skill causes

```
model_loader_inputs: warning: old and new tests disagree about {'node_id': '2',
  'node_title': 'F5-TTS Advanced', 'class_type': 'F5TTSAudioAdvanced',
  'input_name': 'sample', 'input_value': 'F5-TTS\\voice-c-studio-reference.wav'}
	old_check=True = name_has_dot=True and not_text_class=True
	new_check=False = has_alphabetic_ext=True and not_media_ext=False
```

Benign, and worth understanding because it fires on this skill's presets and on nothing else.

`Workflow.model_loader_inputs()` in `cosy\promptus\comfyui.py` scans string node inputs for values that look
like model filenames, so Promptus can resolve them as downloadable dependencies. The **effective** test is
`new_check`: an alphabetic extension that is not a media extension. Both of our flagged values are correctly
excluded from it — a `.wav` is media, and `Enter the consented narration here.` has no alphabetic extension.

`old_check` is a retired heuristic kept only for comparison; the source comments it as "mostly for my
curiosity". It asks whether the value contains a dot and the node's class is absent from a `text_class_types`
allowlist. Two independent reasons make it disagree on our flows:

- `F5TTSAudio` is on that allowlist; **`F5TTSAudioAdvanced` is not**. Every string input on the advanced node
  therefore looks suspicious to the old test, which is why Promptus's own bundled F5 flow is silent and every
  flow this skill installs is not.
- Narration and transcript defaults end in a full stop, which the old test reads as a dot in a filename.

Nothing is misclassified and no dependency resolution is affected. The correct fix is upstream: add
`F5TTSAudioAdvanced` to `text_class_types` beside the existing `F5TTSAudio` entry. Until then, expect one
warning block per string input per installed voice preset on every Cosy start, and do not treat a growing
count as a fault — it scales with the number of voices installed.

## Warnings this skill does not cause

Do not report these as voice-cloning problems.

| Log line | Meaning |
|---|---|
| `WARNING: '(cosy) Image to Image' in config file does not match any cosyflow.` | Stale titles in `COSYFLOW_AUTO_INSTALL_TITLES`; the named flows no longer exist under those names |
| `install would exceed maximum models size; returning False` | The comfy backend lacked room at that moment. The 2026-08-15 audit reports 407.63 / 412.00 GB used with 4.37 GB free; inspect the current audit rather than repeating a historical number |
| `after install, '(cosy) HiDream I1 Fast' status is CosyFlowStatus.INSTALLABLE, expected INSTALLED` | A historical consequence of the earlier space limit. HiDream I1 Fast and the queued Flux Kontext flows are now installed and consumed most of the reclaimed headroom |
| `Some files in models_dir are not used by any available cosyflows:` | Housekeeping inventory. Entries ending `.error` at a few bytes are failed downloads holding a name |
| `The matrix sharing feature has been disabled because the 'matrix-nio' dependency is not installed` | ComfyUI-Manager optional feature; unrelated |
| `The ComfyRegistry cache update is still in progress, so an outdated cache is being used` | ComfyUI-Manager cache warm-up; repeats several times at every start |
| `unknown data: {'Last Time Model File': ...}` | Editor state saved into a bundled cosyflow by the ComfyUI frontend |
| `GET /p-dash.sw.js 404` in the portal log | A service worker registered by another application on `127.0.0.1`, requesting its own file from whichever localhost port is open |
| `WARNING: This is a development server.` | Flask's standard notice. Both Cosy and the portal are localhost-only by design |

The models budget line is the one worth surfacing to a user: it does not affect F5 voice cloning, which needs
no new weights, but it will block any other cosyflow they try next.

## Anchor lines worth quoting in a hand-off

Quote the measured line, not a summary of it.

- `worker version: 0.110` — fixes which worker-version workarounds apply
- `ComfyUI version: 0.30.0` — the graph schema presets were written against
- `Total VRAM 8192 MB` — the ceiling behind any performance statement
- `8.5 seconds: ...comfyui-f5-tts` — evidence the node imported
- the `report_dependencies` line naming the voice preset — evidence it installed
- `Got N from local cosyflow directory <path>` — the directory that actually holds installed voices

## Server log acceptance checklist

Before calling the portal ready, confirm all of these in Promptus **Server** or its ComfyUI log:

- managed hardware init reaches `Environment matches policy` or clearly reports a completed repair;
- the selected NVIDIA GPU, VRAM, and Torch build are the expected device;
- `comfyui-f5-tts` appears in custom-node import times without a traceback;
- ComfyUI prints `To see the GUI go to: http://localhost:8288`;
- Cosy prints worker version, bundled cosyflow count, and the config-resolved local cosyflow directory;
- the intended voice appears under `These cosyflows are available` with `comfyui-f5-tts`;
- Cosy reaches `Running on http://localhost:8190`;
- `GET /queue` is empty before a voice job begins, and the Cosy busy endpoint is reachable. On worker 0.110, `Job.is_running()` is inverted and completed jobs can leave `GET /api/generate/is-busy` true; the portal reports this as `stale_completion_flag` and relies on ComfyUI's queue plus its local lock.

The portal exposes the last two checks together at `GET /api/health` and refuses a new job when either
backend is busy. This is an admission check, not permission to start replacement services.
