const $ = (id) => document.getElementById(id);
const portalToken = document.querySelector('meta[name="promptus-portal-token"]').content;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const THEME_KEY = 'promptus-f5-theme';
const ACTIVE_JOB_KEY = 'promptus-f5-active-job';
const presets = {
  natural: {speed: 1.00, nfe: 32, cfg: 2.00, crossfade: .15, sway: -1, speedType: 'F5TTS'},
  poetic: {speed: 1.07, nfe: 32, cfg: 2.00, crossfade: .15, sway: -1, speedType: 'F5TTS'},
  intense: {speed: 1.04, nfe: 32, cfg: 2.20, crossfade: .15, sway: -1, speedType: 'F5TTS'},
  intimate: {speed: 1.10, nfe: 32, cfg: 1.90, crossfade: .15, sway: -1, speedType: 'F5TTS'}
};
const CAPTURE_LIMIT_SECONDS = 11.8;
let referenceId = null;
let modelTitle = null;
let voiceInventory = [];
let recorder = null;
let stream = null;
let chunks = [];
let started = 0;
let timerHandle = null;
let audioContext = null;
let analyser = null;
let meterHandle = null;
let activeStyle = 'poetic';
let controlsModified = false;
let currentJobId = null;
let expressionVerdict = null;
let jobStartedAt = 0;
let jobClockHandle = null;
let lastJobEventKey = '';
let captureRevision = 0;
let activeCaptureToken = 0;
let captureController = null;
let referenceBusy = false;
let pollFailures = 0;
let generationBusy = false;
let lastTerminalJob = null;
let lastGenerationRequest = null;
let lastJobProgressValue = 0;
let currentGenerationIsRecoveryRetry = false;
let recoveryMode = 'retry';
let diagnosticsJobId = null;
let latestDiagnostics = null;
let diagnosticsRevision = 0;
const SYSTEM_DIAGNOSTIC_CATEGORIES = new Set(['backend', 'system', 'verification', 'control']);
const completedStages = new Set();
let currentStage = 'record';

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if ((options.method || 'GET').toUpperCase() !== 'GET') headers.set('X-Promptus-Portal-Token', portalToken);
  let response;
  try {
    response = await fetch(url, {...options, headers});
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('The local Promptus service did not respond. Check that the Voice Studio server is running.');
  }
  const data = await response.json().catch(() => ({ok: false, error: 'Promptus returned an unreadable local response.'}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function preferredTheme() {
  try {
    return localStorage.getItem(THEME_KEY)
      || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  } catch (_) {
    return 'dark';
  }
}

function applyTheme(theme, persist = true) {
  const selected = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selected;
  document.documentElement.style.colorScheme = selected;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content', selected === 'light' ? '#F7F6FB' : '#190A4E'
  );
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const next = selected === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} mode`);
    button.setAttribute('aria-pressed', String(selected === 'light'));
    button.querySelector('.theme-icon').textContent = selected === 'dark' ? '☼' : '☾';
    const label = button.querySelector('.theme-label');
    if (label) label.textContent = selected === 'dark' ? 'Light' : 'Dark';
  });
  if (persist) {
    try { localStorage.setItem(THEME_KEY, selected); } catch (_) {}
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function setMessage(node, text, type = '') {
  node.textContent = text;
  node.className = `message ${type}`;
}

function setButtonBusy(button, busy, label = '') {
  const copy = button.querySelector('span') || button;
  if (busy) {
    if (!button.dataset.restingLabel) button.dataset.restingLabel = copy.textContent;
    if (label) copy.textContent = label;
    button.classList.add('is-loading');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.restingLabel) copy.textContent = button.dataset.restingLabel;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
  }
}

function setGlobalProgress(label, detail, percent, state = 'working') {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  $('globalProgressLabel').textContent = label;
  $('globalProgressDetail').textContent = detail;
  $('globalProgressPercent').textContent = `${value}%`;
  $('globalProgressBar').style.width = `${value}%`;
  $('globalProgress').className = `operation-hud ${state}`;
}

function setJourney(percent, activeLabel = '') {
  $('journeyProgress').style.width = `${Math.max(8, Math.min(100, percent))}%`;
  document.querySelectorAll('.journey-labels span').forEach((item) => {
    item.classList.toggle('active', item.textContent.toLowerCase() === activeLabel.toLowerCase());
  });
}

function notify(message, type = 'info', title = '') {
  const toast = document.createElement('article');
  toast.className = `toast ${type}`;
  const heading = document.createElement('strong');
  heading.textContent = title || ({success: 'Ready', error: 'Needs attention', warning: 'Check this'}[type] || 'Promptus update');
  const copy = document.createElement('span');
  copy.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  const remove = () => {
    if (!toast.isConnected) return;
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 220);
  };
  close.addEventListener('click', remove);
  toast.append(heading, copy, close);
  $('toastRegion').append(toast);
  setTimeout(remove, type === 'error' ? 7000 : 4600);
}

function stageNavButtons(id) {
  return document.querySelectorAll(`.workflow-step[data-target="${id}"], .mobile-step[data-target="${id}"]`);
}

function syncStageNav() {
  for (const id of ['record', 'install', 'create']) {
    const locked = $(id)?.classList.contains('locked');
    stageNavButtons(id).forEach((button) => {
      button.classList.toggle('locked', locked);
      button.classList.toggle('complete', completedStages.has(id));
      button.classList.toggle('active', currentStage === id);
      button.disabled = Boolean(locked);
      button.setAttribute('aria-disabled', String(Boolean(locked)));
      if (currentStage === id) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
  }
}

function setStepState(id, state) {
  if (state === 'complete') completedStages.add(id);
  if (state === 'active') currentStage = id;
  if (state === 'locked') completedStages.delete(id);
  syncStageNav();
}

function unlock(id) {
  const panel = $(id);
  panel.classList.remove('locked');
  panel.setAttribute('aria-disabled', 'false');
  panel.inert = false;
  if (id === 'create') $('useInstalledVoice').disabled = false;
  syncStageNav();
}

function lock(id) {
  const panel = $(id);
  panel.classList.add('locked');
  panel.setAttribute('aria-disabled', 'true');
  panel.inert = true;
  completedStages.delete(id);
  if (id === 'create') $('useInstalledVoice').disabled = true;
  if (currentStage === id) currentStage = 'record';
  syncStageNav();
}

function scrollToStage(id) {
  if ($(id)?.classList.contains('locked')) return;
  currentStage = id;
  syncStageNav();
  $(id)?.scrollIntoView({behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start'});
}

function syncClock() {
  $('systemClock').textContent = new Intl.DateTimeFormat([], {hour: '2-digit', minute: '2-digit'}).format(new Date());
}

function serviceState(name, detail, ok = true, busy = false) {
  const dot = busy ? 'working' : ok ? 'ok' : 'bad';
  return `<span class="status-item"><i class="status-dot ${dot}"></i><span>${escapeHtml(name)}</span><small>${escapeHtml(detail)}</small></span>`;
}

async function loadStatus(manual = false) {
  const box = $('systemStatus');
  box.innerHTML = '<span class="muted">Checking Promptus services…</span>';
  $('mobileReadiness').innerHTML = '<i class="status-dot working"></i>Checking';
  if (manual) setGlobalProgress('Checking services', 'Contacting the local Promptus stack.', 24);
  try {
    const d = await api('/api/status');
    const queueReady = Boolean(d.backend?.accepting_jobs);
    const queue = d.backend?.comfyui || {};
    const queueDetail = queueReady ? 'ready' : `${queue.queue_running || 0} live · ${queue.queue_pending || 0} queued`;
    const nodeReady = Boolean(d.f5_basic && d.f5_advanced);
    const wordReady = Boolean(d.word_verifier);
    const ready = queueReady && nodeReady && wordReady;
    const gpuDetected = Boolean(d.gpu && d.gpu !== 'unknown');
    box.innerHTML = [
      serviceState('ComfyUI + F5 Advanced', nodeReady ? 'online' : 'check nodes', nodeReady),
      serviceState(`F5 nodes ${d.f5_node_version || ''}`.trim(), 'loaded', Boolean(d.f5_node_version)),
      serviceState(`F5 core ${d.f5_core_version || ''}`.trim(), d.recommended_model || 'ready', Boolean(d.f5_core_version)),
      serviceState('Local word check', wordReady ? 'ready' : 'missing', wordReady),
      serviceState(d.gpu || 'GPU', `${d.vram_free_gb ?? '—'} GB free`, gpuDetected),
      serviceState('Generation queue', queueDetail, queueReady, !queueReady)
    ].join('');
    // The resources panel compares this against the latest public release.
    const installedF5 = $('f5Installed');
    if (installedF5) installedF5.textContent = d.f5_core_version || 'unknown';
    $('mobileReadiness').innerHTML = `<i class="status-dot ${ready ? 'ok' : queueReady ? 'bad' : 'working'}"></i>${ready ? 'Ready' : queueReady ? 'Needs setup' : 'Busy'}`;
    if (manual) {
      const detail = ready
        ? 'F5, local word verification, and the generation queue are ready.'
        : !nodeReady
          ? 'F5 Advanced is unavailable. Check Promptus Server before generating.'
          : !wordReady
            ? 'The local word verifier is missing, so delivery remains blocked.'
            : 'The generation queue is currently busy.';
      setGlobalProgress(ready ? 'Studio ready' : 'Studio not ready', detail, ready ? 100 : 0, ready ? 'success' : 'error');
      notify(detail, ready ? 'success' : 'warning', 'Service check complete');
    }
  } catch (error) {
    box.innerHTML = serviceState('Promptus services', error.message, false);
    $('mobileReadiness').innerHTML = '<i class="status-dot bad"></i>Offline';
    setGlobalProgress('Service unavailable', error.message, 0, 'error');
    if (manual) notify(error.message, 'error');
  }
}

function diagnosticTone(status, findings = []) {
  const values = findings.map((finding) => String(finding?.severity || '').toLowerCase());
  const state = String(status || '').toLowerCase();
  if (values.some((value) => ['critical', 'error', 'failed', 'fail', 'action', 'blocking'].includes(value)) || /fail|error|action|block/.test(state)) return 'action';
  if (values.some((value) => ['warning', 'warn', 'notice', 'attention', 'quality'].includes(value)) || /warn|notice|attention|quality/.test(state)) return 'warning';
  if (/busy|working|checking/.test(state)) return 'working';
  if (/ok|ready|healthy|clear|passed/.test(state)) return 'success';
  return 'neutral';
}

function diagnosticSeverity(value) {
  const severity = String(value || 'info').toLowerCase();
  if (['critical', 'error', 'failed', 'fail', 'action', 'blocking'].includes(severity)) return 'action';
  if (['warning', 'warn', 'notice', 'busy', 'attention', 'quality'].includes(severity)) return 'warning';
  if (['ok', 'ready', 'healthy', 'clear', 'passed', 'success'].includes(severity)) return 'success';
  return 'neutral';
}

function readableDiagnosticState(value) {
  const text = String(value || 'checked').replaceAll('_', ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Checked';
}

function portableDisplayPath(value, fallback = 'Local Promptus source') {
  const text = String(value || '').trim();
  if (!text || /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(text)) return fallback;
  return text;
}

function diagnosticPrivacyText(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const summary = value.summary || value.message;
    if (typeof summary === 'string' && summary.trim()) return summary.trim();
  }
  return 'Only privacy-safe summaries are shown. Raw logs, narration, recognized speech, and absolute paths stay hidden.';
}

function sourceModified(value) {
  if (!value) return '';
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function sourceSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderLogDiagnostics(data) {
  const findings = Array.isArray(data.findings) ? data.findings.filter((item) => item && typeof item === 'object') : [];
  const sources = Array.isArray(data.sources) ? data.sources.filter((item) => item && typeof item === 'object') : [];
  const sourceLabels = new Map(sources.map((source) => [String(source.id || ''), String(source.label || source.id || 'Local source')]));
  latestDiagnostics = {status: data.status, summary: data.summary, findings, sources, privacy: data.privacy};

  const badge = $('diagnosticsBadge');
  badge.textContent = readableDiagnosticState(data.status);
  badge.dataset.tone = diagnosticTone(data.status, findings);
  $('diagnosticsState').textContent = String(data.summary || 'Local diagnostics completed.');

  const findingList = $('diagnosticsFindings');
  findingList.replaceChildren();
  if (!findings.length) {
    const empty = document.createElement('li');
    empty.className = 'diagnostics-empty';
    empty.textContent = 'No actionable log finding was returned.';
    findingList.append(empty);
  } else {
    findings.slice(0, 4).forEach((finding) => {
      const item = document.createElement('li');
      item.className = 'diagnostic-finding';
      item.dataset.severity = diagnosticSeverity(finding.severity);
      const heading = document.createElement('strong');
      heading.textContent = String(finding.title || readableDiagnosticState(finding.code || 'Finding'));
      item.append(heading);
      if (finding.evidence) {
        const evidence = document.createElement('p');
        evidence.textContent = String(finding.evidence);
        item.append(evidence);
      }
      if (finding.resolution) {
        const resolution = document.createElement('p');
        resolution.className = 'diagnostic-resolution';
        const label = document.createElement('b');
        label.textContent = 'Recommended next step: ';
        resolution.append(label, document.createTextNode(String(finding.resolution)));
        item.append(resolution);
      }
      if (finding.source) {
        const source = document.createElement('small');
        source.textContent = `Source: ${sourceLabels.get(String(finding.source)) || String(finding.source)}`;
        item.append(source);
      }
      findingList.append(item);
    });
    if (findings.length > 4) {
      const omitted = document.createElement('li');
      omitted.className = 'diagnostics-empty';
      omitted.textContent = `${findings.length - 4} additional low-priority finding${findings.length - 4 === 1 ? '' : 's'} omitted to keep this summary focused.`;
      findingList.append(omitted);
    }
  }

  const sourceList = $('diagnosticsSources');
  sourceList.replaceChildren();
  if (!sources.length) {
    const empty = document.createElement('li');
    empty.className = 'diagnostics-empty';
    empty.textContent = 'No local log source was reported.';
    sourceList.append(empty);
  } else {
    sources.forEach((source) => {
      const item = document.createElement('li');
      const heading = document.createElement('div');
      const label = document.createElement('strong');
      label.textContent = String(source.label || source.id || 'Local source');
      const availability = document.createElement('span');
      availability.className = source.available ? 'source-available' : 'source-unavailable';
      availability.textContent = source.available ? 'Available' : 'Unavailable';
      heading.append(label, availability);
      const path = document.createElement('span');
      path.className = 'diagnostics-path';
      path.textContent = portableDisplayPath(source.display_path, String(source.label || 'Local source'));
      item.append(heading, path);
      const metadata = [source.mode, sourceSize(source.bytes), sourceModified(source.modified)].filter(Boolean);
      if (metadata.length || source.summary) {
        const detail = document.createElement('small');
        detail.textContent = [...metadata, source.summary].filter(Boolean).map(String).join(' · ');
        item.append(detail);
      }
      sourceList.append(item);
    });
  }

  $('diagnosticsPrivacy').textContent = diagnosticPrivacyText(data.privacy);
  $('diagnosticsCopyStatus').textContent = '';
  $('copyDiagnostics').disabled = false;
  $('refreshDiagnostics').disabled = false;
  $('refreshDiagnostics').removeAttribute('aria-busy');
  $('refreshDiagnostics').textContent = 'Check again';
  $('logDiagnostics').setAttribute('aria-busy', 'false');
}

async function loadLogDiagnostics(jobId = diagnosticsJobId, {open = false} = {}) {
  const revision = ++diagnosticsRevision;
  if (jobId) diagnosticsJobId = jobId;
  if (open) $('logDiagnostics').open = true;
  $('logDiagnostics').setAttribute('aria-busy', 'true');
  $('diagnosticsBadge').textContent = 'Checking';
  $('diagnosticsBadge').dataset.tone = 'working';
  $('diagnosticsState').textContent = 'Checking local Promptus logs and service evidence…';
  $('refreshDiagnostics').disabled = true;
  $('refreshDiagnostics').setAttribute('aria-busy', 'true');
  $('refreshDiagnostics').textContent = 'Checking…';
  $('copyDiagnostics').disabled = true;
  try {
    const body = jobId ? {job_id: jobId} : {};
    const data = await api('/api/log-diagnostics', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (revision !== diagnosticsRevision) return;
    renderLogDiagnostics(data);
  } catch (error) {
    if (revision !== diagnosticsRevision) return;
    latestDiagnostics = null;
    $('diagnosticsBadge').textContent = 'Unavailable';
    $('diagnosticsBadge').dataset.tone = 'action';
    $('diagnosticsState').textContent = `Local diagnostics unavailable: ${error.message}`;
    $('diagnosticsFindings').replaceChildren();
    $('diagnosticsSources').replaceChildren();
    $('diagnosticsPrivacy').textContent = 'No raw logs were shown or copied.';
    $('diagnosticsCopyStatus').textContent = '';
    $('copyDiagnostics').disabled = true;
    $('refreshDiagnostics').disabled = false;
    $('refreshDiagnostics').removeAttribute('aria-busy');
    $('refreshDiagnostics').textContent = 'Try again';
    $('logDiagnostics').setAttribute('aria-busy', 'false');
  }
}

function diagnosticsCopyText(data) {
  const lines = [
    'Promptus local diagnostics',
    `Status: ${readableDiagnosticState(data.status)}`,
    String(data.summary || 'No summary returned.')
  ];
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const labels = new Map(sources.map((source) => [String(source.id || ''), String(source.label || source.id || 'Local source')]));
  (Array.isArray(data.findings) ? data.findings : []).slice(0, 4).forEach((finding, index) => {
    lines.push('', `${index + 1}. ${String(finding.title || readableDiagnosticState(finding.code || 'Finding'))}`);
    if (finding.evidence) lines.push(`Evidence: ${String(finding.evidence)}`);
    if (finding.resolution) lines.push(`Recommended next step: ${String(finding.resolution)}`);
    if (finding.source) lines.push(`Source: ${labels.get(String(finding.source)) || String(finding.source)}`);
  });
  if (sources.length) {
    lines.push('', 'Local sources:');
    sources.forEach((source) => {
      lines.push(`- ${String(source.label || source.id || 'Local source')}: ${portableDisplayPath(source.display_path, String(source.label || 'Local source'))} (${source.available ? 'available' : 'unavailable'})`);
    });
  }
  lines.push('', `Privacy: ${diagnosticPrivacyText(data.privacy)}`);
  return lines.join('\n');
}

async function copyDiagnosticsSummary() {
  if (!latestDiagnostics) return;
  const copy = diagnosticsCopyText(latestDiagnostics);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(copy);
    $('diagnosticsCopyStatus').textContent = 'Privacy-safe diagnostic summary copied.';
  } catch {
    $('diagnosticsCopyStatus').textContent = 'Copy was unavailable. Select the visible summary instead.';
  }
}

function selectVoice(title) {
  const voice = voiceInventory.find((item) => item.title === title && item.selectable !== false) || null;
  modelTitle = voice?.title || null;
  $('activeModel').textContent = voice ? `${voice.name} · ${voice.variant}` : 'Choose a voice';
  $('voiceDetails').textContent = voice
    ? `${voice.variant} · ${voice.engine} · ${voice.health_label || (voice.native ? 'Promptus-native preset' : 'Legacy preset kept for compatibility')}`
    : 'Select one cloned voice for this render.';
  document.querySelectorAll('.voice-option').forEach((button) => {
    const active = button.dataset.title === modelTitle;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateGenerateButton();
}

function renderVoiceList() {
  const query = $('voiceSearch').value.trim().toLowerCase();
  const filtered = voiceInventory.filter((voice) => `${voice.name} ${voice.variant} ${voice.engine} ${voice.title}`.toLowerCase().includes(query));
  const list = $('voiceList');
  list.replaceChildren();
  for (const voice of filtered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `voice-option${voice.selectable === false ? ' needs-attention' : ''}`;
    button.dataset.title = voice.title;
    button.setAttribute('aria-pressed', String(voice.title === modelTitle));
    button.disabled = generationBusy || voice.selectable === false;
    const name = document.createElement('strong');
    name.textContent = voice.name;
    const meta = document.createElement('span');
    meta.textContent = voice.selectable === false
      ? `${voice.variant} · Needs re-recording`
      : `${voice.variant} · ${voice.native ? 'Promptus-native' : 'Legacy compatible'} · F5`;
    button.append(name, meta);
    button.addEventListener('click', () => selectVoice(voice.title));
    list.append(button);
  }
  $('voiceEmpty').classList.toggle('hidden', filtered.length !== 0);
}

async function loadVoices(preferred = '', manual = false) {
  try {
    const d = await api('/api/voices');
    voiceInventory = d.voices || [];
    const selectableCount = voiceInventory.filter((voice) => voice.selectable !== false).length;
    const attentionCount = voiceInventory.length - selectableCount;
    $('voiceCount').textContent = voiceInventory.length
      ? `${d.voice_count} cloned voice${d.voice_count === 1 ? '' : 's'} · ${d.count} preset${d.count === 1 ? '' : 's'}${attentionCount ? ` · ${attentionCount} needs attention` : ''}`
      : 'No fixed-reference F5 voices found';
    const retained = [preferred, modelTitle].find((title) => title && voiceInventory.some((voice) => voice.title === title && voice.selectable !== false)) || '';
    modelTitle = retained || null;
    renderVoiceList();
    selectVoice(modelTitle);
    if (selectableCount) unlock('create');
    else lock('create');
    if (manual) notify(`${selectableCount} ready voice preset${selectableCount === 1 ? '' : 's'} found${attentionCount ? `; ${attentionCount} needs attention` : ''}.`, attentionCount ? 'warning' : 'success', 'Voice library refreshed');
  } catch (error) {
    voiceInventory = [];
    modelTitle = null;
    $('voiceCount').textContent = 'Installed voices unavailable';
    $('voiceList').replaceChildren();
    $('voiceEmpty').classList.remove('hidden');
    $('voiceEmpty').textContent = error.message;
    selectVoice(null);
    if (manual) notify(error.message, 'error');
  }
}

function drawMeter() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  const canvas = $('meter');
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#12CEC6';
  context.shadowColor = '#12CEC6';
  context.shadowBlur = 10;
  context.lineWidth = 3;
  context.beginPath();
  data.forEach((value, index) => {
    const x = index / (data.length - 1) * width;
    const y = value / 255 * height;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  });
  context.stroke();
  meterHandle = requestAnimationFrame(drawMeter);
}

function updateTimer() {
  const elapsed = (performance.now() - started) / 1000;
  const fraction = Math.min(1, elapsed / CAPTURE_LIMIT_SECONDS);
  $('timer').textContent = `00:${elapsed.toFixed(1).padStart(4, '0')}`;
  $('captureRemaining').textContent = `${Math.max(0, CAPTURE_LIMIT_SECONDS - elapsed).toFixed(1)} seconds remaining`;
  $('captureProgress').style.width = `${fraction * 100}%`;
  setGlobalProgress('Capturing reference', 'Reading the microphone signal in real time.', 8 + fraction * 24);
  if (elapsed >= CAPTURE_LIMIT_SECONDS) stopRecording();
}

function setReferenceBusy(busy) {
  referenceBusy = busy;
  $('useFileButton').disabled = busy || recorder?.state === 'recording';
  if (recorder?.state !== 'recording') $('recordButton').disabled = busy;
  updateInstallButton();
}

function isCaptureTranscriptMismatch(message = '') {
  const value = String(message).toLowerCase();
  return value.includes('does not match the displayed words')
    || value.includes('transcript and audio timing do not agree');
}

function hideCaptureRecovery() {
  $('captureRecovery').classList.add('hidden');
}

function showCaptureRecovery(message) {
  referenceId = null;
  $('referenceResult').classList.add('hidden');
  $('referenceAudio').removeAttribute('src');
  $('referenceAudio').load();
  $('referenceTranscript').readOnly = false;
  $('installConsent').checked = false;
  $('installConsentBasis').value = '';
  lock('install');
  completedStages.delete('record');
  currentStage = 'record';
  syncStageNav();
  updateInstallButton();
  $('captureRecoveryText').textContent = `${message} This take was rejected and was not installed. The displayed transcript has not been changed.`;
  $('captureRecovery').classList.remove('hidden');
  requestAnimationFrame(() => $('captureRetryButton').focus({preventScroll: true}));
}

function invalidateReference() {
  captureRevision += 1;
  captureController?.abort();
  captureController = null;
  referenceId = null;
  hideCaptureRecovery();
  $('referenceResult').classList.add('hidden');
  $('referenceAudio').removeAttribute('src');
  $('referenceAudio').load();
  $('referenceTranscript').readOnly = false;
  $('installConsent').checked = false;
  $('installConsentBasis').value = '';
  setMessage($('installMessage'), '');
  lock('install');
  completedStages.delete('record');
  currentStage = 'record';
  syncStageNav();
  updateInstallButton();
  return captureRevision;
}

async function startRecording() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}, video: false});
    activeCaptureToken = invalidateReference();
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => processBlob(new Blob(chunks, {type: recorder.mimeType || 'audio/webm'}), false, activeCaptureToken);
    recorder.start(250);
    setReferenceBusy(false);
    $('useFileButton').disabled = true;
    started = performance.now();
    timerHandle = setInterval(updateTimer, 50);
    $('timer').textContent = '00:00.0';
    $('captureProgress').style.width = '0%';
    $('recordButton').classList.add('recording');
    $('recordLabel').textContent = 'Stop and process';
    $('recordingStatusDot').className = 'status-dot working';
    $('recorderState').textContent = 'Reference capture live';
    $('recordHint').classList.remove('error');
    $('recordHint').textContent = 'Recording… read the complete prompt, then stop.';
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    drawMeter();
    notify('Microphone capture started. You have up to 11.8 seconds.', 'info', 'Recording live');
  } catch (error) {
    $('recordHint').textContent = `Microphone unavailable: ${error.message}`;
    $('recordHint').classList.add('error');
    $('recordingStatusDot').className = 'status-dot bad';
    $('recorderState').textContent = 'Microphone unavailable';
    setGlobalProgress('Microphone unavailable', 'Grant microphone access or choose an audio file.', 0, 'error');
    notify('Grant microphone access, or use an existing audio file instead.', 'error', 'Microphone unavailable');
  }
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  recorder.stop();
  clearInterval(timerHandle);
  stream?.getTracks().forEach((track) => track.stop());
  cancelAnimationFrame(meterHandle);
  audioContext?.close();
  analyser = null;
  $('recordButton').classList.remove('recording');
  $('recordLabel').textContent = 'Start another take';
  $('recordingStatusDot').className = 'status-dot working';
  $('recorderState').textContent = 'Checking reference quality';
  $('recordHint').textContent = 'Processing with Promptus FFmpeg…';
  setReferenceBusy(true);
  setGlobalProgress('Checking reference', 'Measuring duration, speech activity, clipping, and clarity.', 34);
}

async function processBlob(blob, automaticTranscript = false, existingToken = null) {
  const token = existingToken ?? invalidateReference();
  const transcript = $('referenceTranscript').value.trim();
  if (!transcript && !automaticTranscript) {
    $('recordHint').textContent = 'Enter the exact words spoken before processing the recording.';
    $('recordHint').classList.add('error');
    $('recordingStatusDot').className = 'status-dot bad';
    setGlobalProgress('Transcript required', 'Enter exactly what was spoken, then try again.', 0, 'error');
    notify('The exact spoken transcript is required for a reliable clone.', 'warning');
    setReferenceBusy(false);
    return;
  }
  captureController = new AbortController();
  setReferenceBusy(true);
  const form = new FormData();
  form.append('audio', blob, 'reference.webm');
  form.append('transcript', transcript);
  form.append('automatic_transcript', String(automaticTranscript));
  $('recordingStatusDot').className = 'status-dot working';
  $('recorderState').textContent = automaticTranscript ? 'Transcribing locally' : 'Analysing reference';
  setGlobalProgress(
    'Checking reference',
    automaticTranscript ? 'Normalising and transcribing entirely on this computer.' : 'Normalising the local audio and running quality gates.',
    35
  );
  try {
    const d = await api('/api/reference', {method: 'POST', body: form, signal: captureController.signal});
    if (token !== captureRevision) return;
    referenceId = d.reference_id;
    showReference(d);
    unlock('install');
    setStepState('record', 'complete');
    setStepState('install', 'active');
    setJourney(40, 'Verify');
    $('recordHint').classList.remove('error');
    $('recordHint').textContent = automaticTranscript
      ? 'Reference accepted and locally transcribed. Listen once before installing.'
      : 'Reference accepted. Listen once before installing.';
    $('recordingStatusDot').className = 'status-dot ok';
    $('recorderState').textContent = 'Reference verified';
    $('referenceTranscript').readOnly = true;
    setGlobalProgress('Reference verified', 'The recording passed the local quality gate.', 40, 'success');
    notify('The reference is clean enough to become a Promptus voice.', 'success', 'Reference verified');
    updateInstallButton();
  } catch (error) {
    if (error?.name === 'AbortError' || token !== captureRevision) return;
    const transcriptMismatch = isCaptureTranscriptMismatch(error.message);
    referenceId = null;
    $('referenceResult').classList.add('hidden');
    $('recordHint').textContent = error.message;
    $('recordHint').classList.add('error');
    $('recordingStatusDot').className = 'status-dot bad';
    $('recorderState').textContent = 'Reference needs another take';
    setGlobalProgress('Reference rejected', error.message, 0, 'error');
    if (transcriptMismatch) showCaptureRecovery(error.message);
    else {
      notify(error.message, 'error', 'Reference needs attention');
      hideCaptureRecovery();
      lock('install');
      completedStages.delete('record');
      currentStage = 'record';
      syncStageNav();
      updateInstallButton();
    }
  } finally {
    if (token === captureRevision) {
      captureController = null;
      setReferenceBusy(false);
      $('audioFile').value = '';
    }
  }
}

function showReference(d) {
  const metrics = d.metrics;
  if (d.transcript) $('referenceTranscript').value = d.transcript;
  $('referenceResult').classList.remove('hidden');
  $('score').textContent = metrics.score;
  $('duration').textContent = metrics.duration_seconds;
  $('snr').textContent = `${metrics.snr_estimate_db} dB`;
  $('activity').textContent = `${metrics.activity_percent}%`;
  $('referenceAudio').src = `${d.audio_url}?v=${Date.now()}`;
  $('warnings').textContent = metrics.warnings.length ? metrics.warnings.join(' · ') : 'Clean reference — ready to install.';
}

function updateInstallButton() {
  if ($('installButton').classList.contains('is-loading')) return;
  $('installButton').disabled = !(referenceId && !referenceBusy && $('installConsent').checked && $('installConsentBasis').value && $('voiceName').value.trim());
}

async function installVoice() {
  setMessage($('installMessage'), 'Installing through the local Promptus worker…');
  setButtonBusy($('installButton'), true, 'Installing voice');
  setGlobalProgress('Installing voice', 'Building the fixed-reference Promptus preset.', 48);
  setJourney(52, 'Install');
  try {
    const d = await api('/api/install', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({reference_id: referenceId, voice_name: $('voiceName').value.trim(), consent_confirmed: $('installConsent').checked, consent_basis: $('installConsentBasis').value, replace: $('replaceVoice').checked})
    });
    modelTitle = d.model_title;
    setGlobalProgress('Indexing voice', 'Refreshing the local Promptus voice library.', 58);
    await loadVoices(modelTitle);
    setMessage($('installMessage'), 'Installed and ready.', 'success');
    unlock('create');
    setStepState('install', 'complete');
    setStepState('create', 'active');
    setJourney(64, 'Direct');
    setGlobalProgress('Voice installed', 'Your private preset is ready for narration.', 64, 'success');
    notify(`${$('voiceName').value.trim()} is installed and selected.`, 'success', 'Voice ready');
    scrollToStage('create');
  } catch (error) {
    setMessage($('installMessage'), error.message, 'error');
    setGlobalProgress('Install stopped', error.message, 40, 'error');
    notify(error.message, 'error', 'Voice was not installed');
  } finally {
    setButtonBusy($('installButton'), false);
    updateInstallButton();
    updateGenerateButton();
  }
}

function setPreset(name) {
  activeStyle = name;
  controlsModified = false;
  document.querySelectorAll('.style').forEach((button) => {
    const active = button.dataset.style === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const preset = presets[name];
  for (const key of ['speed', 'nfe', 'cfg', 'crossfade', 'sway']) $(key).value = preset[key];
  $('speedType').value = preset.speedType;
  $('directorState').textContent = `${name.toUpperCase()} PRESET`;
  syncOutputs();
}

function markControlsModified() {
  controlsModified = true;
  $('directorState').textContent = `${activeStyle.toUpperCase()} · MODIFIED`;
}

function syncOutputs() {
  $('speedOut').value = Number($('speed').value).toFixed(2);
  $('nfeOut').value = $('nfe').value;
  $('cfgOut').value = Number($('cfg').value).toFixed(2);
  $('crossfadeOut').value = `${Number($('crossfade').value).toFixed(2)}s`;
  $('swayOut').value = Number($('sway').value).toFixed(2);
}

function updateGenerateButton() {
  if ($('generateButton').classList.contains('is-loading')) return;
  const rawSeed = $('seed').value.trim();
  const seed = Number(rawSeed);
  const narration = $('narration').value.trim();
  const validSeed = rawSeed !== '' && Number.isInteger(seed) && seed >= -1 && $('seed').checkValidity();
  const validNarration = narration.length > 0
    && narration.length <= 12000
    && [...narration].some((character) => /[\p{L}\p{N}]/u.test(character));
  $('generateButton').disabled = generationBusy || !(modelTitle && $('generateConsent').checked && $('generateConsentBasis').value && validNarration && validSeed);
}

function syncNarration() {
  const value = $('narration').value;
  $('charCount').textContent = value.length;
  const urls = value.match(/https?:\/\/\S+/gi) || [];
  const hasWords = [...value].some((character) => /[\p{L}\p{N}]/u.test(character));
  $('narrationWarning').textContent = value.trim() && !hasWords
    ? 'Narration needs spoken words, not punctuation alone.'
    : urls.length
      ? `${urls.length} raw web address${urls.length === 1 ? '' : 'es'} detected. Rewrite each as spoken words (for example, “example dot com”) for reliable pronunciation.`
      : '';
  updateGenerateButton();
}

function setGenerationFormBusy(busy) {
  generationBusy = busy;
  for (const id of ['voiceSearch', 'refreshVoices', 'narration', 'speed', 'nfe', 'cfg', 'crossfade', 'sway', 'seed', 'speedType', 'generateConsentBasis', 'generateConsent']) {
    $(id).disabled = busy;
  }
  document.querySelectorAll('.style, .voice-option').forEach((button) => {
    const voice = voiceInventory.find((item) => item.title === button.dataset.title);
    button.disabled = busy || voice?.selectable === false;
  });
  updateGenerateButton();
}

function formatElapsed(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function startJobClock() {
  clearInterval(jobClockHandle);
  jobStartedAt = Date.now();
  $('jobElapsed').textContent = '00:00';
  jobClockHandle = setInterval(() => {
    $('jobElapsed').textContent = formatElapsed((Date.now() - jobStartedAt) / 1000);
  }, 1000);
}

function eventPhase(event) {
  const value = `${event?.status || ''} ${event?.message || ''}`.toLowerCase();
  if (value.includes('approved') || value.includes('verified')) return .92;
  if (value.includes('rejected') || value.includes('failed')) return 1;
  if (value.includes('fresh take') || value.includes('retry')) return .35;
  if (value.includes('submitted')) return .12;
  return .52;
}

function jobProgress(job) {
  if (job.status === 'complete') return 100;
  if (['rejected', 'failed', 'stopped', 'error'].includes(job.status)) {
    return job.issue?.stage?.startsWith('master_') ? 100 : Math.max(10, Number(job.section || 1) / Math.max(1, Number(job.section_count || 1)) * 90);
  }
  if (job.status === 'queued') return 4;
  const count = Math.max(1, Number(job.section_count || 1));
  const section = Math.max(1, Number(job.section || 1));
  const last = (job.events || []).at(-1);
  return Math.min(94, 10 + ((section - 1 + eventPhase(last)) / count) * 82);
}

function jobEventText(event) {
  if (!event) return 'F5 is preparing the performance…';
  if (event.stage) return `${event.stage}: ${event.status || 'working'}`;
  return event.message || 'F5 is shaping the performance…';
}

function renderTimeline(events = []) {
  const list = $('jobTimeline');
  list.replaceChildren();
  const usable = events.filter((event) => event && typeof event === 'object').slice(-6);
  usable.forEach((event, index) => {
    const item = document.createElement('li');
    if (index === usable.length - 1) item.classList.add('active');
    const copy = document.createElement('span');
    copy.textContent = event.stage || event.message || 'Promptus worker';
    const status = document.createElement('small');
    const rejected = event.rejected_output;
    status.textContent = rejected
      ? `${event.status || 'rejected'} · ${rejected.peak_dbfs ?? '—'} dBFS · ${rejected.clipping_percent ?? '—'}% clip`
      : event.status || (event.attempt ? `take ${event.attempt}` : 'working');
    item.append(copy, status);
    list.append(item);
  });
}

function automaticRecoveryText(event) {
  if (!event || typeof event !== 'object') return '';
  const value = `${event.stage || ''} ${event.status || ''} ${event.message || ''}`.toLowerCase();
  const isRecovery = event.automatic_recovery === true
    || event.auto_repair === true
    || value.includes('automatic recovery')
    || value.includes('automatic repair')
    || value.includes('approved after fresh take')
    || value.includes('rendering one fresh take');
  if (!isRecovery) return '';
  return jobEventText(event);
}

function setJobRecoveryStatus(message = '', tone = 'working') {
  const node = $('jobRecoveryStatus');
  if (node.textContent !== message) node.textContent = message;
  node.dataset.tone = tone;
  node.classList.toggle('hidden', !message);
}

function renderJobProgress(job) {
  const value = Math.max(lastJobProgressValue, Math.round(jobProgress(job)));
  lastJobProgressValue = value;
  $('jobProgressPercent').textContent = `${value}%`;
  $('jobProgressBar').style.width = `${value}%`;
  $('jobProgressBar').parentElement.setAttribute('aria-valuenow', String(value));
  const timeline = job.timeline?.length ? job.timeline : (job.events || []);
  const event = timeline.at(-1) || (job.events || []).at(-1);
  $('jobEvent').textContent = job.issue?.message || jobEventText(event);
  $('jobProgressBar').parentElement.setAttribute('aria-valuetext', `${value}% — ${jobEventText(event)}`);
  renderTimeline(timeline);
  const key = JSON.stringify(event || {});
  if (key && key !== lastJobEventKey) lastJobEventKey = key;
  if (!['rejected', 'failed', 'stopped', 'error'].includes(job.status)) {
    const recoveryText = automaticRecoveryText(event);
    if (recoveryText) setJobRecoveryStatus(recoveryText);
    else setGlobalProgress('Generating narration', jobEventText(event), 64 + value * .28);
    setJourney(64 + value * .26, 'Listen');
  }
}

function generationRequestFromForm() {
  return {
    model_title: modelTitle,
    narration: $('narration').value,
    style: activeStyle,
    controls: {
      speed: +$('speed').value,
      nfe_step: +$('nfe').value,
      cfg_strength: +$('cfg').value,
      cross_fade_duration: +$('crossfade').value,
      sway_sampling_coef: +$('sway').value,
      speed_type: $('speedType').value
    },
    controls_modified: controlsModified,
    seed: Number($('seed').value),
    consent_confirmed: $('generateConsent').checked,
    consent_basis: $('generateConsentBasis').value
  };
}

function copyGenerationRequest(value) {
  return JSON.parse(JSON.stringify(value));
}

function generationRequestsMatch(left, right) {
  return Boolean(left && right) && JSON.stringify(left) === JSON.stringify(right);
}

async function generate(request = generationRequestFromForm(), options = {}) {
  const unchangedRetry = options.unchangedRetry === true;
  currentGenerationIsRecoveryRetry = unchangedRetry;
  const controls = request.controls || {
    speed: +$('speed').value,
    nfe_step: +$('nfe').value,
    cfg_strength: +$('cfg').value,
    cross_fade_duration: +$('crossfade').value,
    sway_sampling_coef: +$('sway').value,
    speed_type: $('speedType').value
  };
  request = {...request, controls};
  lastGenerationRequest = copyGenerationRequest(request);
  setMessage(
    $('generateMessage'),
    unchangedRetry
      ? 'Retrying the original voice, words, direction, controls and seed unchanged…'
      : 'Job submitted to the Promptus worker…'
  );
  setButtonBusy($('generateButton'), true, 'Generating locally');
  setGenerationFormBusy(true);
  resetExpression();
  lastJobEventKey = '';
  lastJobProgressValue = 2;
  $('jobResult').classList.remove('hidden');
  $('jobResult').classList.remove('terminal');
  $('jobResult').setAttribute('aria-busy', 'true');
  $('spinner').className = 'core-loader';
  $('jobKicker').textContent = unchangedRetry ? 'UNCHANGED RETRY' : 'LIVE GENERATION';
  $('jobTitle').textContent = unchangedRetry ? 'Retrying safely in Promptus…' : 'Generating in Promptus…';
  const selectedVoice = voiceInventory.find((voice) => voice.title === request.model_title);
  $('jobContext').textContent = `${selectedVoice?.name || request.model_title} · ${request.style}${request.controls_modified ? ' · modified controls' : ''} · ${request.narration.trim().length.toLocaleString()} characters`;
  $('jobEvent').textContent = unchangedRetry ? 'Submitting the original request unchanged' : 'Submitting to the local F5 worker';
  $('jobProgressPercent').textContent = '2%';
  $('jobProgressBar').style.width = '2%';
  $('jobProgressBar').parentElement.setAttribute('aria-valuenow', '2');
  $('jobProgressBar').parentElement.setAttribute('aria-valuetext', unchangedRetry ? 'Unchanged retry submitted' : 'Generation submitted');
  $('jobTimeline').replaceChildren();
  $('qualitySummary').classList.add('hidden');
  $('outputAudio').classList.add('hidden');
  $('downloadOutput').classList.add('hidden');
  $('jobRecovery').classList.add('hidden');
  setJobRecoveryStatus(
    unchangedRetry ? 'Retrying once with the original voice, words, performance settings and seed unchanged.' : ''
  );
  $('jobTechnical').classList.add('hidden');
  startJobClock();
  setGlobalProgress('Submitting narration', 'Reserving the local F5 generation slot.', 65);
  setJourney(66, 'Direct');
  if (!unchangedRetry) {
    notify('The narration is queued locally. Progress will update section by section.', 'info', 'Generation started');
  }
  try {
    const d = await api('/api/generate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(request)
    });
    currentJobId = d.job_id;
    if (!unchangedRetry && d.preflight?.auto_fixes?.length) {
      notify(d.preflight.auto_fixes.join(' · '), 'info', 'Speech text prepared');
    }
    try { sessionStorage.setItem(ACTIVE_JOB_KEY, d.job_id); } catch (_) {}
    pollFailures = 0;
    pollJob(d.job_id);
  } catch (error) {
    finishSubmissionError(error.message);
  }
}

async function pollJob(id) {
  try {
    const d = await api(`/api/jobs/${id}`);
    pollFailures = 0;
    const job = d.job;
    if (!$('jobContext').textContent) {
      $('jobContext').textContent = `${job.model_title || 'Installed voice'} · ${job.style || 'custom'}${job.controls_modified ? ' · modified controls' : ''}`;
    }
    renderJobProgress(job);
    if (['rejected', 'failed', 'stopped', 'error'].includes(job.status)) {
      return finishTerminalJob(job, id);
    }
    if (job.status === 'complete') {
      const output = job.outputs[0];
      clearInterval(jobClockHandle);
      $('jobResult').classList.add('terminal');
      $('jobResult').setAttribute('aria-busy', 'false');
      $('spinner').className = 'core-loader done';
      $('jobKicker').textContent = 'VERIFIED MASTER';
      $('jobTitle').textContent = 'Narration complete';
      lastJobProgressValue = 100;
      $('jobProgressPercent').textContent = '100%';
      $('jobProgressBar').style.width = '100%';
      $('jobProgressBar').parentElement.setAttribute('aria-valuenow', '100');
      $('jobProgressBar').parentElement.setAttribute('aria-valuetext', 'Verified narration complete');
      $('jobEvent').textContent = `${Number(output.duration_seconds || 0).toFixed(1)} seconds · ${output.normalized_word_error_rate_percent ?? 0}% word error · verified local output`;
      $('qaDuration').textContent = `${Number(output.duration_seconds || 0).toFixed(1)}s`;
      $('qaPeak').textContent = `${Number(output.peak_dbfs ?? 0).toFixed(2)} dBFS`;
      $('qaRms').textContent = `${Number(output.rms_dbfs ?? 0).toFixed(2)} dBFS`;
      $('qaSections').textContent = output.sections ?? job.section_count ?? 1;
      $('qaClipping').textContent = `${output.clipping_percent ?? 0}%`;
      $('qaSilence').textContent = `${output.silence_percent ?? 0}%`;
      $('qaDcOffset').textContent = Number(output.dc_offset ?? 0).toFixed(6);
      $('qaClicks').textContent = `${output.possible_clicks_percent ?? 0}%`;
      $('qaWordError').textContent = `${output.normalized_word_error_rate_percent ?? 0}%`;
      $('qualitySummary').classList.remove('hidden');
      $('outputAudio').src = output.audio_url;
      $('outputAudio').classList.remove('hidden');
      $('downloadOutput').href = output.audio_url;
      $('downloadOutput').classList.remove('hidden');
      setMessage($('generateMessage'), 'Generated, signal-checked and word-checked locally in Promptus.', 'success');
      currentJobId = id;
      $('expressionPanel').classList.remove('hidden');
      $('jobRecovery').classList.add('hidden');
      const recoveryResolved = !$('jobRecoveryStatus').classList.contains('hidden');
      if (recoveryResolved) {
        setJobRecoveryStatus('Recovery passed. The verified master is ready to listen to.', 'success');
      }
      showTechnicalDetails(job);
      setButtonBusy($('generateButton'), false);
      setGenerationFormBusy(false);
      updateGenerateButton();
      setStepState('create', 'complete');
      setJourney(94, 'Listen');
      setGlobalProgress('Narration ready', 'Listen once and save the human performance verdict.', 94, 'success');
      if (!recoveryResolved) {
        notify('The narration passed signal and local word-accuracy checks.', 'success', 'Verified output ready');
      }
      currentGenerationIsRecoveryRetry = false;
      try { sessionStorage.removeItem(ACTIVE_JOB_KEY); } catch (_) {}
      loadHistory();
      return;
    }
    setTimeout(() => pollJob(id), 1200);
  } catch (error) {
    pollFailures += 1;
    if (pollFailures <= 5) {
      const wait = Math.min(6000, 800 * 2 ** (pollFailures - 1));
      $('jobEvent').textContent = `Reconnecting to the local job… attempt ${pollFailures} of 5`;
      setGlobalProgress('Reconnecting', 'The render is still reserved while the portal reconnects.', 70, 'working');
      return setTimeout(() => pollJob(id), wait);
    }
    showConnectionLost(`${error.message} The local job may still be running.`);
  }
}

function fillQualitySummary(output = {}) {
  $('qaDuration').textContent = `${Number(output.duration_seconds || 0).toFixed(1)}s`;
  $('qaPeak').textContent = `${Number(output.peak_dbfs ?? 0).toFixed(2)} dBFS`;
  $('qaRms').textContent = `${Number(output.rms_dbfs ?? 0).toFixed(2)} dBFS`;
  $('qaSections').textContent = output.sections ?? '—';
  $('qaClipping').textContent = `${output.clipping_percent ?? 0}%`;
  $('qaSilence').textContent = `${output.silence_percent ?? 0}%`;
  $('qaDcOffset').textContent = Number(output.dc_offset ?? 0).toFixed(6);
  $('qaClicks').textContent = `${output.possible_clicks_percent ?? 0}%`;
  $('qaWordError').textContent = output.normalized_word_error_rate_percent == null ? '—' : `${output.normalized_word_error_rate_percent}%`;
  $('qualitySummary').classList.remove('hidden');
}

function showTechnicalDetails(job) {
  const output = (job.outputs?.length ? job.outputs : (job.diagnostic_outputs || []))[0] || {};
  const safe = {
    job_id: job.id,
    status: job.status,
    qa_status: job.qa_status,
    stage: job.issue?.stage || job.timeline?.at(-1)?.stage,
    issue: job.issue || null,
    voice: job.model_title,
    style: job.style,
    controls: job.controls,
    preflight: job.preflight,
    recovery: job.repair_state || null,
    sections: job.section_count,
    output: {
      sha256: output.sha256,
      duration_seconds: output.duration_seconds,
      quality_flags: output.quality_flags,
      peak_dbfs: output.peak_dbfs,
      clipping_percent: output.clipping_percent,
      silence_percent: output.silence_percent,
      normalized_word_error_rate_percent: output.normalized_word_error_rate_percent,
      recognized_word_ratio: output.recognized_word_ratio
    }
  };
  $('jobTechnicalText').textContent = JSON.stringify(safe, null, 2);
  $('jobTechnical').classList.remove('hidden');
}

function finishTerminalJob(job, id) {
  clearInterval(jobClockHandle);
  lastTerminalJob = job;
  currentJobId = id;
  $('jobResult').classList.add('terminal');
  $('jobResult').setAttribute('aria-busy', 'false');
  $('spinner').className = 'core-loader error';
  $('jobKicker').textContent = job.status === 'rejected' ? 'QUALITY DECISION' : 'LOCAL JOB';
  const qualityRejected = job.status === 'rejected';
  const masterRejected = job.status === 'rejected' && job.issue?.stage?.startsWith('master_');
  $('jobTitle').textContent = masterRejected ? 'Audio created — not approved' : job.status === 'rejected' ? 'Take rejected' : job.status === 'stopped' ? 'Generation interrupted' : 'Generation failed';
  $('jobTitle').setAttribute('tabindex', '-1');
  $('jobTitle').focus({preventScroll: true});
  const message = job.issue?.message || job.error || 'The local job did not complete.';
  $('jobEvent').textContent = message;
  const value = qualityRejected ? 100 : Math.max(lastJobProgressValue, Math.round(jobProgress(job)));
  lastJobProgressValue = value;
  $('jobProgressPercent').textContent = qualityRejected ? 'Checked' : `${value}%`;
  $('jobProgressBar').style.width = `${value}%`;
  $('jobProgressBar').parentElement.setAttribute('aria-valuenow', String(value));
  $('jobProgressBar').parentElement.setAttribute('aria-valuetext', `${job.status} during ${job.issue?.stage || 'generation'}`);
  renderTimeline(job.timeline || job.events || []);
  const diagnostic = (job.diagnostic_outputs || [])[0];
  if (diagnostic) fillQualitySummary(diagnostic);
  $('outputAudio').classList.add('hidden');
  $('downloadOutput').classList.add('hidden');
  $('expressionPanel').classList.add('hidden');
  diagnosticsJobId = id;
  const automaticRecoveryWasActive = !$('jobRecoveryStatus').classList.contains('hidden');
  const issueCategory = String(job.issue?.category || '').toLowerCase();
  const needsSystemDiagnostics = SYSTEM_DIAGNOSTIC_CATEGORIES.has(issueCategory);
  if (needsSystemDiagnostics) {
    $('jobRecoveryTitle').textContent = 'Check local diagnostics before retrying';
    $('jobRecoveryText').textContent = job.issue?.recovery || 'Review the local Promptus evidence before changing the voice or performance settings.';
    $('applyRecovery').textContent = 'Check diagnostics';
    recoveryMode = 'diagnostics';
    loadLogDiagnostics(id);
  } else if (currentGenerationIsRecoveryRetry) {
    $('jobRecoveryTitle').textContent = 'The unchanged retry did not pass';
    $('jobRecoveryText').textContent = 'Promptus kept both takes quarantined. Review the saved evidence before changing the voice, words or performance direction.';
    $('applyRecovery').textContent = 'Review current form';
    recoveryMode = 'review';
    setJobRecoveryStatus('The unchanged retry did not pass its quality checks. No second recovery was started.', 'error');
  } else if (lastGenerationRequest) {
    const wordGateRejected = String(job.issue?.code || '').startsWith('word_accuracy');
    $('jobRecoveryTitle').textContent = 'One unchanged retry is available';
    $('jobRecoveryText').textContent = wordGateRejected
      ? 'Promptus quarantined this audio. Retry the same voice, words, performance direction, controls and seed; the new result must pass every check again.'
      : 'Retry the same voice, words, performance direction, controls and seed once. The rejected audio remains quarantined.';
    $('applyRecovery').textContent = 'Retry unchanged';
    recoveryMode = 'retry';
    if (automaticRecoveryWasActive) {
      setJobRecoveryStatus('Automatic recovery finished, but the final quality decision still did not pass.', 'error');
    }
  } else {
    $('jobRecoveryTitle').textContent = 'Review the current form';
    $('jobRecoveryText').textContent = 'The original private text is not available to this browser session. Review the current form and submit it as a new job when ready.';
    $('applyRecovery').textContent = 'Review current form';
    recoveryMode = 'review';
  }
  $('jobRecovery').classList.remove('hidden');
  showTechnicalDetails(job);
  setMessage($('generateMessage'), `Not approved: ${message}`, 'error');
  setButtonBusy($('generateButton'), false);
  setGenerationFormBusy(false);
  updateGenerateButton();
  setGlobalProgress(qualityRejected ? 'Verification rejected' : 'Generation failed', message, qualityRejected ? 96 : value, 'error');
  if (!automaticRecoveryWasActive) {
    notify(message, 'error', qualityRejected ? 'Audio not approved' : 'Generation failed');
  }
  currentGenerationIsRecoveryRetry = false;
  try { sessionStorage.removeItem(ACTIVE_JOB_KEY); } catch (_) {}
  loadHistory();
}

function finishSubmissionError(message) {
  const recoverySubmission = currentGenerationIsRecoveryRetry;
  clearInterval(jobClockHandle);
  currentJobId = null;
  $('jobResult').classList.add('terminal');
  $('jobResult').setAttribute('aria-busy', 'false');
  $('spinner').className = 'core-loader error';
  $('jobKicker').textContent = 'PREFLIGHT';
  $('jobTitle').textContent = 'Generation not started';
  $('jobEvent').textContent = message;
  $('jobProgressPercent').textContent = '0%';
  $('jobProgressBar').style.width = '0%';
  $('jobProgressBar').parentElement.setAttribute('aria-valuenow', '0');
  $('jobProgressBar').parentElement.setAttribute('aria-valuetext', 'Generation not started');
  $('jobTimeline').replaceChildren();
  $('qualitySummary').classList.add('hidden');
  $('jobRecovery').classList.add('hidden');
  setJobRecoveryStatus(
    recoverySubmission ? `The unchanged retry could not start. ${message}` : '',
    'error'
  );
  $('jobTechnicalText').textContent = message;
  $('jobTechnical').classList.remove('hidden');
  setMessage($('generateMessage'), message, 'error');
  setButtonBusy($('generateButton'), false);
  setGenerationFormBusy(false);
  updateGenerateButton();
  setGlobalProgress('Generation not started', message, 0, 'error');
  if (!recoverySubmission) notify(message, 'error', 'Generation not started');
  currentGenerationIsRecoveryRetry = false;
  try { sessionStorage.removeItem(ACTIVE_JOB_KEY); } catch (_) {}
  if (message.toLowerCase().includes('reference')) loadVoices(modelTitle, true);
}

function showConnectionLost(message) {
  clearInterval(jobClockHandle);
  $('jobResult').classList.add('terminal');
  $('spinner').className = 'core-loader';
  $('jobKicker').textContent = 'CONNECTION';
  $('jobTitle').textContent = 'Connection lost — job state unknown';
  $('jobEvent').textContent = message;
  $('jobRecoveryTitle').textContent = 'Keep this job reserved';
  $('jobRecoveryText').textContent = 'Reconnect to the same local job before starting another one.';
  $('applyRecovery').textContent = 'Reconnect';
  recoveryMode = 'reconnect';
  $('jobRecovery').classList.remove('hidden');
  setGlobalProgress('Connection lost', 'The local render may still be running.', 72, 'working');
  notify('The portal lost contact; the job remains reserved for reconnection.', 'warning', 'Connection lost');
}

async function restoreActiveJob() {
  let id = '';
  try { id = sessionStorage.getItem(ACTIVE_JOB_KEY) || ''; } catch (_) {}
  if (!id) return;
  currentJobId = id;
  $('jobResult').classList.remove('hidden');
  $('spinner').className = 'core-loader';
  $('jobTitle').textContent = 'Reconnecting to Promptus…';
  $('jobEvent').textContent = 'Checking the active local render';
  $('jobContext').textContent = '';
  setGenerationFormBusy(true);
  setButtonBusy($('generateButton'), true, 'Generating locally');
  startJobClock();
  pollFailures = 0;
  pollJob(id);
}

function historyState(job) {
  if (job.status === 'complete') {
    if (job.listening_verdict === 'approved') return 'Approved';
    if (job.listening_verdict === 'revise') return 'Another take requested';
    if (job.listening_verdict === 'rejected') return 'Listening rejected';
    return 'Verified — needs listening';
  }
  if (job.status === 'rejected') return 'Not approved';
  if (job.status === 'failed' || job.status === 'error') return 'Failed';
  if (job.status === 'stopped') return 'Interrupted';
  if (job.status === 'running') return 'Running';
  return 'Queued';
}

function historyDetail(job) {
  const when = new Date(Number(job.finished || job.started || job.created || 0) * 1000);
  const time = Number.isNaN(when.getTime()) ? 'time unavailable' : when.toLocaleString();
  const stage = job.issue?.stage?.replaceAll('_', ' ') || job.timeline?.at(-1)?.stage || `${job.section_count || 0} sections`;
  return `${job.style || 'custom'} · ${time} · ${stage}`;
}

async function openHistoryJob(id) {
  try {
    const d = await api(`/api/jobs/${id}`);
    const job = d.job;
    currentJobId = id;
    $('jobResult').classList.remove('hidden');
    $('jobContext').textContent = `${job.voice_name || job.model_title || 'Installed voice'} · ${job.style || 'custom'}`;
    if (job.status === 'complete') {
      $('jobResult').classList.remove('terminal');
      pollJob(id);
    } else {
      renderJobProgress(job);
      finishTerminalJob(job, id);
    }
    $('jobResult').scrollIntoView({behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center'});
  } catch (error) {
    notify(error.message, 'error', 'History unavailable');
  }
}

async function loadHistory() {
  try {
    const d = await api('/api/history?limit=5');
    const list = $('jobHistoryList');
    list.replaceChildren();
    $('jobHistoryEmpty').classList.toggle('hidden', d.entries.length > 0);
    d.entries.forEach((job) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-row';
      button.dataset.status = job.status;
      button.setAttribute('aria-label', `View ${historyState(job)} job for ${job.voice_name || job.model_title || 'installed voice'}`);
      const dot = document.createElement('span');
      dot.className = 'history-dot';
      dot.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.className = 'history-copy';
      const title = document.createElement('strong');
      title.textContent = job.voice_name || job.model_title || 'Installed voice';
      const detail = document.createElement('span');
      detail.textContent = historyDetail(job);
      copy.append(title, detail);
      const state = document.createElement('span');
      state.className = 'history-state';
      state.textContent = historyState(job);
      button.append(dot, copy, state);
      button.addEventListener('click', () => openHistoryJob(job.id));
      item.append(button);
      list.append(item);
    });
  } catch (error) {
    $('jobHistoryEmpty').textContent = `History unavailable: ${error.message}`;
    $('jobHistoryEmpty').classList.remove('hidden');
  }
}

function applyRecoveryAction() {
  if (recoveryMode === 'reconnect' && currentJobId) {
    $('jobResult').classList.remove('terminal');
    $('jobRecovery').classList.add('hidden');
    $('spinner').className = 'core-loader';
    pollFailures = 0;
    startJobClock();
    return pollJob(currentJobId);
  }
  if (recoveryMode === 'diagnostics') {
    $('logDiagnostics').open = true;
    loadLogDiagnostics(currentJobId || diagnosticsJobId, {open: true});
    $('logDiagnostics').scrollIntoView({behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center'});
    return;
  }
  if (recoveryMode === 'review') {
    setMessage($('generateMessage'), 'Review the current voice, words and performance settings, then use Generate locally for a new job.', 'warning');
    $('narration').focus({preventScroll: true});
    return;
  }
  if (!lastGenerationRequest) {
    setJobRecoveryStatus('The original private request is no longer available in this browser session. Review the form before submitting a new job.', 'warning');
    $('narration').focus({preventScroll: true});
    return;
  }
  const currentRequest = generationRequestFromForm();
  if (!currentRequest.consent_confirmed) {
    setJobRecoveryStatus('Confirm consent again before retrying the unchanged request.', 'warning');
    $('generateConsent').focus({preventScroll: true});
    return;
  }
  if (!generationRequestsMatch(currentRequest, lastGenerationRequest)) {
    setJobRecoveryStatus('The form has changed since this take. Use Generate locally for the new version, or restore the original values before retrying unchanged.', 'warning');
    $('generateButton').focus({preventScroll: true});
    return;
  }
  $('jobRecovery').classList.add('hidden');
  generate(copyGenerationRequest(lastGenerationRequest), {unchangedRetry: true});
}

function resetExpression() {
  currentJobId = null;
  expressionVerdict = null;
  $('expressionPanel').classList.add('hidden');
  $('expressionNotes').value = '';
  $('saveExpression').disabled = true;
  $('saveExpression').textContent = 'Save listening verdict';
  setMessage($('expressionMessage'), '');
  document.querySelectorAll('.verdict').forEach((button) => {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  });
}

function setVerdict(name) {
  expressionVerdict = name;
  document.querySelectorAll('.verdict').forEach((button) => {
    const active = button.dataset.verdict === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('saveExpression').disabled = !currentJobId;
}

async function saveExpression() {
  if (!currentJobId || !expressionVerdict) return;
  $('saveExpression').disabled = true;
  setMessage($('expressionMessage'), 'Recording your verdict…');
  try {
    await api(`/api/jobs/${currentJobId}/expression`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({verdict: expressionVerdict, notes: $('expressionNotes').value})
    });
    setMessage($('expressionMessage'), 'Saved beside the render hash.', 'success');
    $('saveExpression').textContent = 'Update verdict';
    if (expressionVerdict === 'approved') {
      setJourney(100, 'Listen');
      setGlobalProgress('Performance approved', 'The listening verdict is saved with this render.', 100, 'success');
      notify('The approved listening verdict is saved with the verified render.', 'success', 'Workflow complete');
    } else if (expressionVerdict === 'revise') {
      setJourney(94, 'Listen');
      setGlobalProgress('Another take requested', 'The tuning note is saved; adjust the direction and render again.', 94, 'working');
      notify('Your revision note is saved beside this render.', 'warning', 'Another take requested');
    } else {
      setJourney(94, 'Listen');
      setGlobalProgress('Performance rejected', 'The rejected verdict is saved; this render is not approved for use.', 94, 'error');
      notify('This render is recorded as rejected.', 'warning', 'Performance rejected');
    }
  } catch (error) {
    setMessage($('expressionMessage'), error.message, 'error');
    notify(error.message, 'error', 'Verdict not saved');
  } finally {
    $('saveExpression').disabled = !expressionVerdict;
  }
}

$('recordButton').addEventListener('click', () => recorder && recorder.state === 'recording' ? stopRecording() : startRecording());
$('captureRetryButton').addEventListener('click', startRecording);
$('useFileButton').addEventListener('click', () => $('audioFile').click());
$('audioFile').addEventListener('change', (event) => { if (event.target.files[0]) processBlob(event.target.files[0], true); });
$('refreshStatus').addEventListener('click', () => {
  loadStatus(true);
  loadLogDiagnostics(diagnosticsJobId);
});
$('refreshDiagnostics').addEventListener('click', () => loadLogDiagnostics(diagnosticsJobId, {open: true}));
$('copyDiagnostics').addEventListener('click', copyDiagnosticsSummary);
$('refreshVoices').addEventListener('click', () => loadVoices(modelTitle, true));
$('voiceSearch').addEventListener('input', renderVoiceList);
$('installConsent').addEventListener('change', updateInstallButton);
$('installConsentBasis').addEventListener('change', updateInstallButton);
$('voiceName').addEventListener('input', updateInstallButton);
$('installButton').addEventListener('click', installVoice);
document.querySelectorAll('.style').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.style)));
for (const id of ['speed', 'nfe', 'cfg', 'crossfade', 'sway']) $(id).addEventListener('input', () => { syncOutputs(); markControlsModified(); });
$('speedType').addEventListener('change', markControlsModified);
$('generateConsent').addEventListener('change', updateGenerateButton);
$('generateConsentBasis').addEventListener('change', updateGenerateButton);
$('seed').addEventListener('input', updateGenerateButton);
$('narration').addEventListener('input', syncNarration);
$('generateButton').addEventListener('click', () => generate());
$('applyRecovery').addEventListener('click', applyRecoveryAction);
$('refreshHistory').addEventListener('click', loadHistory);
document.querySelectorAll('.verdict').forEach((button) => button.addEventListener('click', () => setVerdict(button.dataset.verdict)));
$('saveExpression').addEventListener('click', saveExpression);
$('expressionNotes').addEventListener('input', () => { if (expressionVerdict) $('saveExpression').disabled = false; });
document.querySelectorAll('.workflow-step, .mobile-step, .hero-actions [data-target]').forEach((button) => button.addEventListener('click', () => {
  if (!button.classList.contains('locked')) scrollToStage(button.dataset.target);
}));
document.querySelectorAll('[data-theme-toggle]').forEach((button) => button.addEventListener('click', toggleTheme));
window.addEventListener('online', () => {
  setGlobalProgress('Connection restored', 'The browser can reach local services again.', 100, 'success');
  notify('The browser connection is available again.', 'success');
});
window.addEventListener('offline', () => {
  setGlobalProgress('Browser offline', 'Reconnect before starting another operation.', 0, 'error');
  notify('The browser is offline. Local requests are paused.', 'warning');
});

async function loadSkillPack() {
  const version = $('skillVersion');
  const detail = $('skillPackDetail');
  const button = $('downloadSkill');
  if (!version || !detail || !button) return;
  try {
    const d = await api('/api/skill/info');
    // The archive is built per request, so the version shown is the version served.
    // Both the sidebar panel and the footer link carry the label; only one is visible at a time.
    document.querySelectorAll('[data-skill-version]').forEach((el) => { el.textContent = d.version; });
    version.title = `Content hash of all ${d.files} packaged files`;
    detail.textContent = `${d.files} files · ${Math.round(d.bytes / 1024)} KB · source updated ${d.updated}. Instructions and scripts, packaged to install elsewhere.`;
    button.removeAttribute('aria-disabled');
  } catch (error) {
    document.querySelectorAll('[data-skill-version]').forEach((el) => { el.textContent = 'unavailable'; });
    detail.textContent = error.message;
    button.setAttribute('aria-disabled', 'true');
  }
}

async function loadUpstreamVersion() {
  const latest = $('f5Latest');
  if (!latest) return;
  try {
    const d = await api('/api/upstream/f5');
    if (!d.available) { latest.textContent = 'check unavailable'; return; }
    const installed = ($('f5Installed')?.textContent || '').trim();
    const link = document.createElement('a');
    link.href = d.url || d.releases_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = d.latest;
    latest.textContent = '';
    latest.appendChild(link);
    // Only claim an update exists when the two strings genuinely differ.
    if (installed && installed !== '…' && installed !== d.latest) {
      latest.appendChild(document.createTextNode(' — newer than installed'));
      latest.classList.add('upstream-newer');
    }
  } catch {
    latest.textContent = 'check unavailable';
  }
}

$('downloadSkill')?.addEventListener('click', () => {
  notify('Packaging the current skill for download.', 'success');
  // Re-read after the download so an edit made while the page was open is reflected.
  setTimeout(loadSkillPack, 1500);
});

document.querySelectorAll('.panel.locked').forEach((panel) => { panel.inert = true; });
applyTheme(document.documentElement.dataset.theme || preferredTheme(), false);
syncStageNav();
syncNarration();
syncOutputs();
syncClock();
setInterval(syncClock, 30000);
loadSkillPack();
loadStatus(false).then(loadUpstreamVersion);
loadLogDiagnostics();
loadVoices();
restoreActiveJob();
loadHistory();
