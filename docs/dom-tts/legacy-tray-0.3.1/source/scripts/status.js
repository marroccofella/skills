const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const STATUS = path.join(STATE, "status.json");
const WATCH_STATUS = path.join(STATE, "watcher-status.json");
const LOCK = path.join(STATE, "playback.lock");
const PID = path.join(STATE, "current.pid");
const STOP = path.join(STATE, "stop.flag");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

const status = readJson(STATUS, { state: "idle" });
const watcher = readJson(WATCH_STATUS, { state: "unknown" });
const view = {
  ...status,
  watcher,
  lock: fs.existsSync(LOCK),
  pid: fs.existsSync(PID) ? fs.readFileSync(PID, "utf8").trim() : null,
  stopRequested: fs.existsSync(STOP),
};

console.log(JSON.stringify(view, null, 2));
