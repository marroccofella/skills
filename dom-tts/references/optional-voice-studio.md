# Optional microphone and richer voices

This separate development studio does not change Dom TTS's local spoken-reply
default. Start `node scripts/experimental/optional-voice-session.js`, open the
printed private loopback link, and choose **Record microphone**. Opening the page
does not request permission or record. The browser asks for microphone permission
after Record. Finish releases the microphone and provides a local audio preview;
press Play yourself. Stop and discard releases tracks, aborts active work, clears
displayed text and revokes audio URLs. Recording is limited to one minute and five
megabytes. Recorded clips and generated output expire after two minutes. Closing
the page clears the in-memory session. Nothing is written to disk by this studio.
The browser may retain its permission grant; releasing tracks is not revoking that
browser permission. Use browser site settings to revoke permission permanently.
Clearing the cloud permission checkbox aborts pending work, pauses existing audio,
revokes its playback URL and clears displayed transcripts/replies. The selected
local recording remains until its original expiry or Discard; **Preview local
recording** lets you explicitly restore its local preview. Discard also clears the
cloud checkbox, so the next cloud action needs new permission.

Cloud actions are unavailable by default. To configure the implemented OpenAI
stock-voice provider, set `DOM_TTS_OPENAI_API_KEY` in the process environment, then
start the studio with `--provider openai --allow-cloud true --voice coral`.
Keep the key out of command lines, source files, diagnostics and discussion posts.
The key stays on the Node server; it is never sent to the browser. No environment
key is read or used by default local spoken replies. The provider host is fixed to
`https://api.openai.com/v1/`; no user-supplied cloud endpoint or redirects are
accepted. An explicitly injected loopback fixture is available only in the module
test interface, not the command line.

Each cloud action also requires the page's disclosure checkbox and your button
press. **Generate cloud voice** sends selected text to the speech endpoint;
**Transcribe this clip** sends the selected audio to transcription. **Send clip,
reply and speak** additionally requires an explicit `--reply-model <model-id>`
that your API project can access. It sends audio for transcription, the resulting
text for one response, then that reply for speech. A turn has no conversation
history, tools, access to other chats or autonomous actions. The response request
sets `store: false`; provider retention and billing still follow the provider's
terms. These are push-to-talk turns, not continuous listening, barge-in or full
duplex. The generated voice is AI-generated. Audio needs a separate Play action.

Cloud requests can incur charges. Stop cancels local work and suppresses late
results; data already received by the provider cannot be recalled. A failed request
is not retried or replaced by a local or different cloud voice. There is one active
operation, an overall 90-second limit and 45-second limits on individual provider
requests. Audio requests/results are bounded to five megabytes; text is limited to
4000 characters. Raw provider errors, keys and recordings are never logged.

Only the provider's documented stock voices are accepted. Custom/cloned voices are
unsupported here. This studio does not create a voice or a consent recording, and
no existing clone configuration is discovered or activated. A custom voice would
need a deliberately selected eligible provider and its official consent workflow.

## Evidence and remaining certification

`node tests/optional-voice-check.cjs` tests real owned loopback HTTP for the entire
transcription → reply → speech request chain with synthetic fixtures. It also
tests disabled defaults, missing configuration, consent, private authentication,
origin rejection, body/type bounds, service error sanitization, denied/late capture
permission, recording expiry/oversize cleanup, Stop and discarded late HTTP
results.
The test also launches the real default CLI with a synthetic environment key and
verifies no cloud activation, and confirms consent removal stops already-completed
audio output while retaining the local clip for explicit preview.

Those fixtures do not certify real codec decoding, microphone hardware,
cloud account access, voice quality, model availability or listening latency.
No real microphone, remote request, new model, account or voice has been activated
as part of this build. Those listening/service tests remain required before a
claim that the optional programme works on this machine.

Official interfaces consulted:

- [OpenAI text-to-speech](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [MediaStream recording](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API/Using_the_MediaStream_Recording_API)
- [Stopping media tracks](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop)
