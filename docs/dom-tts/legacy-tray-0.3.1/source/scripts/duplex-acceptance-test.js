const { processTextTurn, loadConfig, resolveAgent } = require("./voice-runtime");
const { readTelemetry } = require("./telemetry");

function latest(name, sinceMs) {
  return [...readTelemetry(500)].reverse().find(event => event.event === name && Date.parse(event.timestamp || "") >= sinceMs);
}

async function main() {
  const live = process.argv.includes("--live");
  const sinceMs = Date.now();
  const config = loadConfig();
  const expectedRoutes = [
    ["Hey Dom status check", "personal"],
    ["Hey Bob status check", "bob"],
    ["Hay Bob status check", "bob"],
    ["Hey Bab status check", "bab"],
    ["Hay Bab status check", "bab"],
  ];
  const routeResults = expectedRoutes.map(([text, expected]) => {
    const resolved = resolveAgent(config, text);
    return { text, expected, actual: resolved.id, ok: resolved.id === expected };
  });
  const resolved = resolveAgent(config, "Hey Bob acceptance test");
  const result = await processTextTurn("Hey Bob confirm duplex acceptance test", {
    source: "duplex-acceptance",
    interrupt: "hotkey",
    simulatedReply: live ? "" : "Duplex acceptance test reply. Standard Mode remains isolated.",
  });
  const wake = latest("wake_detected", sinceMs);
  const agentStarted = latest("agent_turn_started", sinceMs);
  const agentDone = latest("agent_turn_completed", sinceMs);
  const speechStarted = latest("tts_chunk_started", sinceMs);
  const speechDone = latest("tts_completed", sinceMs);

  console.log("Dom TTS Duplex Acceptance Test");
  for (const route of routeResults) {
    console.log(`Route ${route.text}: ${route.ok ? "yes" : "no"} (${route.actual})`);
  }
  console.log(`Wake phrase resolved: ${wake ? "yes" : "no"} (${resolved.id})`);
  console.log(`Agent turn started: ${agentStarted ? "yes" : "no"}`);
  console.log(`Agent turn completed: ${agentDone ? "yes" : "no"} (${result.model || "simulated"})`);
  console.log(`TTS started: ${speechStarted ? "yes" : "no"}`);
  console.log(`TTS completed: ${speechDone ? "yes" : "no"}`);
  console.log(`Agent latency: ${result.agentLatencyMs} ms`);
  console.log(`Model fallback used: ${result.modelFallbackUsed ? "yes" : "no"}`);
  if (routeResults.some(route => !route.ok) || !wake || !agentStarted || !agentDone || !speechStarted || !speechDone) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`Dom TTS Duplex Acceptance Test failed: ${error.message}`);
  process.exitCode = 1;
});
