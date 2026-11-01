# Voice pipeline audit and Live voice (beta)

Written 2026-11-01 from the v18 source. "Measured" = measured on a phone; nothing below is measured yet.

## Why replies take long (from the code, not yet measured)
The normal voice path is a chain, each step waiting for the one before:
1. **Hear** — the clip is sent for speech recognition and the transcript comes back (`brain/platform/stt.ts`).
2. **Think** — the question goes to the model router; the app waits for the **whole** reply (`brain/providers/*` do not stream; no SSE/stream call exists).
3. **Speak** — only then is text-to-speech started (Sarvam cloud voice splits into sentences; otherwise the phone voice).
So the silence is hear + full model reply + first speech chunk. There is no barge-in (you cannot cut her off). `brain/latency.ts`
times each step on the phone; **Settings ▸ System ▸ Voice speed** shows the medians. Read those numbers first.

Other facts found: model calls already turn Gemini "thinking" off for chat turns (`providers/gemini.ts`); instant commands (torch, volume,
open app…) skip the model; keys live in the Android Keystore, not in the repo.

## What was built: Live voice (beta)
A second, separate way to talk: **Settings ▸ Voice ▸ Live voice (beta) ▸ Talk live**. The old path is untouched.
- `src/brain/live/protocol.ts` — message building/parsing for the Gemini Live API (checked against the official docs on 2026-11-01).
  Default model `gemini-3.8-live` (the docs call it the recommended low-latency model; it is a **setting** because Live model names change).
- `session.ts` — WebSocket session: waits for `setupComplete`, reconnects with the saved resumption handle (or replays the last 6 turns),
  follows `goAway`, reports the server's reason if setup is refused, times "your last word → her first sound".
- `pcm.ts`, `mic.ts`, `player.ts`, `controller.ts` — 16 kHz mic in, 24 kHz audio out, instant stop when the server says `interrupted`.
- `persona.ts` — friendly-friend prompt (Hinglish when you use it, short answers, honest, says it can't control the phone in this mode)
  plus the last 25 remembered facts. Not the whole memory.
- `components/LivePanel.jsx` — Start/End, voice choice, "I can interrupt her" switch, live transcript, delay readout. Turns are saved
  into the normal chat history so text mode remembers them.

## Not done (said plainly)
- **Phone tools** (calls, apps, torch…) inside Live. Live is conversation only for now. Adding them means mapping `toolCall` to the existing dispatcher.
- **FAST/NORMAL/DEEP routing**, proactive talking, memory inspect/edit UI beyond what exists, TV/PC changes.
- **Any measured result.** Only unit tests ran (protocol, session with a fake socket, audio conversion, prompt: 19 cases). The real mic,
  speaker, echo, Hindi quality, voice choice and delay are all **untested on a phone**.
- Security note: the Live API normally wants short-lived tokens for client apps. Here the app uses *your own* Gemini key from the Keystore
  inside a WebSocket URL, on your own phone. Fine for a personal build; do not ship it to other people like this.
- Live sessions are limited (audio-only about 15 min per connection) — handled by reconnecting, but long chats are untested.
- Cost: Live audio uses your Gemini quota/billing; check the pricing page. Free-tier limits may stop it.

## Phone test list (tell me the result of each)
1. Settings ▸ Voice ▸ Talk live ▸ Start → status reaches "Listening". If it stops with a message, send me the message (model name / key / voice problems show up there).
2. Say "namaste, kaisi ho" → she answers in voice. Note the "Reply delay" numbers.
3. Interrupt her mid-sentence → she should stop within a moment. If she keeps stopping herself on the loudspeaker, switch off "I can interrupt her" or use earphones.
4. Does the wake word listener fight the mic? (Live opens its own mic.) Tell me if either stops working.
5. Try 3–4 voices and tell me which sounds deep/warm enough.
