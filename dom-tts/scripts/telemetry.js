const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "state");
const TELEMETRY = path.join(STATE, "telemetry.jsonl");

function appendTelemetry(event) {
  fs.mkdirSync(STATE, { recursive: true });
  const record = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  fs.appendFileSync(TELEMETRY, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

function readTelemetry(limit = 100) {
  try {
    const lines = fs.readFileSync(TELEMETRY, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = {
  TELEMETRY,
  appendTelemetry,
  readTelemetry,
};
