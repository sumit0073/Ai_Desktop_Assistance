# STT hallucination hardening

## Pipeline (capture → UI)

1. **Rust capture** (`capture.rs`): mic / meeting lanes stay independent.
2. **Resample** to 16 kHz mono (`resample.rs`).
3. **VAD + RMS** (`vad.rs` + `segmenter.rs`): WebRTC Aggressive + audible floor; min speech / end silence / pre-roll.
4. **Validate** (`validate.rs`): duration, energy, clipping, zero-crossing rate, crest factor → reject before STT.
5. **WAV emit** (`session.rs` → `seecog://speech-segment`) with privacy-safe `evidence` (`strong` | `marginal`).
6. **Frontend** (`useMeetingCapture` → `transcribeAudioBlob` → authenticated `stt-proxy`).
7. **Sanitize** (`sanitizeTranscript.ts`): always-drop YouTube/tags; evidence-gated courtesy; repeated weak phrases.
8. **UI** (`ChatInterface`): empty / discarded → no bubble, no question chips, no rolling context.

## Why false transcripts previously passed

| Layer | Gap |
| --- | --- |
| VAD + RMS | Non-speech energy (fan, keyboard, hiss) can look “audible” and open a segment. |
| Whisper | Invents courtesy / filler text on silence or noise; no client confidence score. |
| Sanitizer | Exact blocklists catch some lines but **blindly** dropping “thank you” also kills real speech; invented full sentences outside the list still pass. |
| Rolling prompt | Same-source context on **interim** partials can bias unrelated audio. |
| Partials | Live bubbles could remain after a final that sanitized to empty. |

**Proven from code review.** Real-world false-transcript rate is **not** measured here — the repo has no consented WAV fixtures.

## Rejection outcomes

| Outcome | When |
| --- | --- |
| `rejected_before_stt` | Native validate fails (`near_silent`, `noise_only`, `too_short`, `clipped`, `duplicate`, …). Event: `seecog://segment-rejected`. |
| `stt_empty` | Provider returned empty / whitespace. |
| `rejected_hallucination` | Sanitizer dropped text (always-hallucination, weak-evidence courtesy, repeated weak phrase). |
| `accepted` | Displayed; may enter rolling context (finals only, trusted). |

Diagnostics (`sttDiagnostics.ts`) record: source, duration, validation reason, model, rejection reason, request id, evidence tier. **Never** PCM, keys, or full transcript text.

## Model policy

| Path | Model |
| --- | --- |
| Final segments | `whisper-large-v3` (override: `VITE_GROQ_STT_MODEL`) |
| Interim partials | `whisper-large-v3-turbo` |

### Comparison status

- **Not run on audio in this change** — no labelled recordings in-repo.
- Synthetic text eval (`src/lib/eval`) does **not** prove WER on real speech.
- To compare objectively later: fix identical WAV fixtures, call `stt-proxy` with both models, measure silence false-positive rate, WER on labelled speech, technical-term hit rate, and valid-speech rejection rate. Document corpus + results; do not claim improvement without numbers.

## Manual checks still required

1. Sign in, start meeting capture, sit in silence / keyboard noise — expect no bubbles.
2. Speak a clear “thank you” — expect it to appear (strong evidence).
3. Speak “yes” / “no” — expect kept.
4. Stop/restart mid-utterance — no stale transcript from the old session.
5. Mic vs meeting lanes — contexts must not cross.

## Security

Unchanged: Groq key stays on the Edge Function; client uses JWT + `VITE_STT_PROXY_URL` only.
