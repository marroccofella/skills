async function speakChunk() {
  throw new Error("Piper provider is not configured yet. Install Piper, set assets/voices.json providers.piper.executable and voiceModel, then implement streaming playback.");
}

module.exports = { speakChunk };
