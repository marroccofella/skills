const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const AVATAR_CONFIG = path.join(ROOT, "assets", "avatar.json");
const AVATAR_STATUS = path.join(STATE, "avatar-status.json");
const TTS_STATUS = path.join(STATE, "status.json");
const DUPLEX_STATUS = path.join(STATE, "duplex-status.json");
const QUEUE = path.join(STATE, "queue.json");
const VOICE_CONFIG = path.join(ROOT, "assets", "voice-runtime.json");

const DEFAULT_CONFIG = {
  enabled: true,
  host: "127.0.0.1",
  port: 42742,
  launchBrowser: true,
  defaultAgent: "bob",
  animationSpeed: 1,
  mouthSensitivity: 1,
  eventIntervalMs: 400,
  devices: {
    fullscreenOnActive: true,
    faceSensorEnabled: true,
    autoHideWhenIdle: true,
    showOnLockPage: true,
    idleReturnDelayMs: 1200,
    switcherPollMs: 300,
    controlsRevealMs: 2600,
    map: {
      sb2: {
        agent: "bab",
        label: "SB2 / BAB",
      },
      sb3: {
        agent: "bob",
        label: "SB3 / BOB",
      },
    },
  },
  privacy: {
    localOnly: true,
    retainAudio: false,
  },
  faces: {
    bob: {
      label: "BOB",
      color: "#42ff8a",
      secondaryColor: "#78ffd0",
      expression: "deadpan",
    },
    bab: {
      label: "BAB",
      color: "#66d9ff",
      secondaryColor: "#f0ff80",
      expression: "bright",
    },
  },
};

function ensureState() {
  fs.mkdirSync(STATE, { recursive: true });
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    privacy: { ...(base.privacy || {}), ...(override.privacy || {}) },
    devices: {
      ...(base.devices || {}),
      ...(override.devices || {}),
      map: {
        ...(base.devices?.map || {}),
        ...(override.devices?.map || {}),
      },
    },
    faces: {
      ...(base.faces || {}),
      ...(override.faces || {}),
    },
  };
}

function loadAvatarConfig() {
  return mergeConfig(DEFAULT_CONFIG, readJson(AVATAR_CONFIG, {}));
}

function normalizeAgentId(agentId, fallback = "") {
  const value = String(agentId || fallback || "").trim().toLowerCase();
  if (value === "bab" || value === "bob") return value;
  return value;
}

function writeAvatarStatus(patch) {
  ensureState();
  const current = readJson(AVATAR_STATUS, {});
  const next = {
    ...current,
    ...patch,
    lastEventAt: new Date().toISOString(),
  };
  if (patch.activeAgent || patch.agent) {
    next.activeAgent = normalizeAgentId(patch.activeAgent || patch.agent, current.activeAgent);
  }
  if (patch.phase && patch.phase !== "error") delete next.error;
  if (patch.error === null) delete next.error;
  writeJson(AVATAR_STATUS, next);
  return next;
}

function agentPhrases(agent) {
  return [agent?.wakePhrase, ...(Array.isArray(agent?.wakePhrases) ? agent.wakePhrases : [])]
    .map(phrase => String(phrase || "").trim())
    .filter(Boolean);
}

function publicAgents(voiceConfig) {
  const agents = voiceConfig.agents || {};
  return Object.entries(agents).map(([id, agent]) => ({
    id,
    avatarId: normalizeAgentId(agent.avatarId || id),
    wakePhrase: agent.wakePhrase || "",
    wakePhrases: agentPhrases(agent),
    voice: agent.voice || "",
    style: agent.style || "",
    personality: agent.personality || "",
  }));
}

function isFresh(iso, maxMs) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= maxMs;
}

function isAtOrAfter(iso, otherIso) {
  const time = Date.parse(iso || "");
  const other = Date.parse(otherIso || "");
  if (!Number.isFinite(time)) return false;
  if (!Number.isFinite(other)) return true;
  return time >= other;
}

function normalizePhase(phase) {
  const value = String(phase || "").toLowerCase();
  if (!value || value === "ready" || value === "stopped" || value === "dry-run") return "idle";
  if (["listening", "thinking", "speaking", "error", "idle"].includes(value)) return value;
  return "idle";
}

function isAvatarAgent(agentId) {
  const id = normalizeAgentId(agentId);
  return id === "bob" || id === "bab";
}

function hasFreshAvatarActivity(avatar, duplex) {
  const avatarPhase = normalizePhase(avatar.phase);
  return (
    (isAvatarAgent(avatar.activeAgent || avatar.agent) && isFresh(avatar.lastEventAt, 120000) && ["listening", "thinking", "speaking"].includes(avatarPhase)) ||
    (isAvatarAgent(duplex.avatarId || duplex.agent) && isFresh(duplex.updatedAt, 120000) && ["listening", "recording", "transcribing", "agent-turn", "speaking"].includes(String(duplex.state || "")))
  );
}

function phaseFromState(tts, duplex, avatar) {
  const avatarPhase = normalizePhase(avatar.phase);
  const ttsFresh = isFresh(tts.updatedAt, 120000);
  const duplexFresh = isFresh(duplex.updatedAt, 120000);
  const avatarFresh = isFresh(avatar.lastEventAt, 120000);
  const ttsIsAvatar = isAvatarAgent(tts.avatarId || tts.agent);
  const avatarIsAvatar = isAvatarAgent(avatar.activeAgent || avatar.agent);
  const avatarSettledAfterRuntime =
    avatarPhase === "idle" &&
    avatarFresh &&
    avatarIsAvatar &&
    isAtOrAfter(avatar.lastEventAt, tts.updatedAt) &&
    isAtOrAfter(avatar.lastEventAt, duplex.updatedAt);
  if (avatarPhase === "error" && avatarFresh) return "error";
  if (avatarSettledAfterRuntime) return "idle";
  if (duplex.state === "recording" && duplexFresh) return "listening";
  if ((duplex.state === "transcribing" || duplex.state === "agent-turn") && duplexFresh) return "thinking";
  if ((avatarPhase === "listening" || avatarPhase === "thinking") && avatarFresh) return avatarPhase;
  if ((tts.state === "queued" || tts.state === "provider-failed") && ttsFresh && ttsIsAvatar) return "thinking";
  if ((tts.state === "speaking" && ttsFresh && (ttsIsAvatar || !hasFreshAvatarActivity(avatar, duplex))) || (duplex.state === "speaking" && duplexFresh)) return "speaking";
  if (duplex.state === "listening" && duplexFresh) return "listening";
  return "idle";
}

function cleanDisplayText(text) {
  let value = String(text || "");
  const message = value.match(/<message>([\s\S]*?)<\/message>/i);
  if (/<automation_id>/i.test(value) && !message) return "";
  if (message) value = message[1];
  value = value
    .replace(/<automation_id>[\s\S]*?<\/automation_id>/gi, " ")
    .replace(/<decision>[\s\S]*?<\/decision>/gi, " ")
    .replace(/<\/?heartbeat>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i.test(value)) return "";
  return value;
}

function currentSpokenText(tts, duplex, queue) {
  const ttsIsAvatar = isAvatarAgent(tts.avatarId || tts.agent);
  const busyAvatar = hasFreshAvatarActivity(readJson(AVATAR_STATUS, {}), duplex);
  if (tts.currentChunk && ["speaking", "queued", "provider-failed"].includes(String(tts.state || "")) && isFresh(tts.updatedAt, 120000) && (ttsIsAvatar || !busyAvatar)) {
    return cleanDisplayText(tts.currentChunk);
  }
  if (Array.isArray(queue.chunks) && queue.chunks.length && ["speaking", "queued"].includes(String(tts.state || "")) && isFresh(queue.createdAt, 120000) && (isAvatarAgent(queue.agent) || !busyAvatar)) {
    const index = Math.max(0, Number(tts.chunkIndex || 1) - 1);
    return cleanDisplayText(queue.chunks[index] || queue.chunks[0] || "");
  }
  if (duplex.lastReply) return cleanDisplayText(duplex.lastReply);
  return cleanDisplayText(tts.currentChunk || "");
}

function readSnapshot() {
  ensureState();
  const config = loadAvatarConfig();
  const voiceConfig = readJson(VOICE_CONFIG, {});
  const avatar = readJson(AVATAR_STATUS, {});
  const tts = readJson(TTS_STATUS, {});
  const duplex = readJson(DUPLEX_STATUS, {});
  const queue = readJson(QUEUE, {});
  const activeAgent = normalizeAgentId(
    avatar.activeAgent || tts.agent || duplex.agent || queue.agent || config.defaultAgent,
    config.defaultAgent,
  );
  const phase = phaseFromState(tts, duplex, avatar);
  const busy = phase !== "idle";
  return {
    now: new Date().toISOString(),
    config,
    agents: publicAgents(voiceConfig),
    avatar,
    tts,
    duplex,
    queue: {
      mode: queue.mode || "",
      profile: queue.profile || "",
      provider: queue.provider || "",
      voice: queue.voice || "",
      chunks: Array.isArray(queue.chunks) ? queue.chunks.length : 0,
      agent: queue.agent || "",
      createdAt: queue.createdAt || "",
    },
    activeAgent,
    phase,
    spokenText: busy ? currentSpokenText(tts, duplex, queue).slice(0, 360) : "",
    userText: busy ? cleanDisplayText(duplex.lastUserText || avatar.lastUserText || "").slice(0, 240) : "",
    error: avatar.error || tts.error || duplex.error || "",
  };
}

module.exports = {
  ROOT,
  STATE,
  AVATAR_CONFIG,
  AVATAR_STATUS,
  DEFAULT_CONFIG,
  ensureState,
  readJson,
  writeJson,
  loadAvatarConfig,
  writeAvatarStatus,
  agentPhrases,
  normalizeAgentId,
  normalizePhase,
  cleanDisplayText,
  readSnapshot,
};
