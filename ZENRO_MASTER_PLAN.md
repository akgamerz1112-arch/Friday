# ZENRO AI — Master Plan & Handoff

## Product decision
- Product name: ZENRO AI
- Assistant/wake name: Zenro
- Home: minimal dark interface with one animated orb
- Conversation: voice + text
- Personality: friendly, informal Hindi/Hinglish companion; quick, concise replies; natural humour; honest disagreement; no fake task-success claims.
- Device target: Samsung Galaxy S20 FE, Android 13, Snapdragon 865, 8 GB RAM.

## User's core requirements
1. One central conversational AI agent. Do not make the user manage 2–3 agents or handoffs.
2. Fast, low-latency conversation with streaming/early speech, interruption/barge-in, and short replies by default.
3. Fast mode for ordinary questions; deeper reasoning only for complex work.
4. Offline wake-word detection for “Hey Zenro”; persistent conversation after replies; “Zenro sleep” pauses listening.
5. Direct Android task execution: launch apps, read visible screen, tap/swipe/type, supported settings/media actions.
6. Incoming-call announcement with contact name when available; answer/reject only through Android-supported APIs/roles and explicit user preference.
7. Sarvam STT/TTS with selectable supported male/female voices; voice catalogue must be verified against current API version.
8. User-controlled memory, edit/delete/export/backup.
9. Simple settings with clear ON/OFF controls, permission explanations, diagnostics and recovery.
10. Preserve progress across chat/session limits with this file, GitHub commits, phase logs and test reports.

## Initial audit of FRIDAY-latest-v27.zip
The uploaded archive was inspected. It is not a small native Kotlin/Compose app: it is a Tauri 2 Android shell with React/TypeScript UI, Rust bridge and Kotlin native plugins. The UI code is under `jarvis-studio-gui/`.

### Evidence from included docs/source
- `README.md`: advertises specialist agents (Research, Phone, Files, Scheduler, Content, Desktop/Browser), Android phone operator, PC/TV integrations, memory/routines, provider routing and multiple themes/settings.
- `CLAUDE.md`: describes one tool advertisement registry and one execution dispatcher, one native bridge, native phone operator loop, and several distinct memory systems. It explicitly warns not to create a second execution path.
- `docs/VOICE_AUDIT.md` (2026-11-01): ordinary voice pipeline is sequential: STT -> wait for complete model reply -> TTS. It states no streaming in the ordinary providers path and no barge-in there.
- The same voice audit says a separate Gemini Live beta exists, but is conversation-only: phone tools are not integrated into Live; FAST/NORMAL/DEEP routing is not done; no real-device measurements or mic/speaker/Hindi/echo/latency tests are recorded for that Live beta.
- `docs/STATUS.md`: has many detailed tests and fixes, but clearly separates live-tested, built-only and open features. Status is historical and device-specific; do not assume every feature is working on the user's S20 FE.
- `package.json`: app stack uses React 18, TypeScript, Vite and Tauri 2.

### Main risks matching the user's complaints
1. Feature-rich UI and many settings/panels may feel cluttered.
2. Specialist agent selection/handoffs expose complexity the user does not want.
3. Ordinary voice path waits for full model response before speech, causing perceived delay.
4. Gemini Live is a separate beta conversation path and currently cannot execute phone tools; this splits conversation from task execution.
5. The Live beta has not been verified end-to-end on the target S20 FE.
6. Several provider fallbacks and routing options can add complexity; don't optimize by simply adding more providers/agents.

## Recommended product architecture
- Build a clean ZENRO experience, but do not decide to rewrite every native subsystem until code reuse is measured.
- Keep one user-facing agent/session and one tool dispatcher. Internal helper functions may exist, but no visible agent handoff chain.
- Unify live audio conversation and phone task execution through the same session and existing validated tool dispatcher. The live model's tool calls must be translated to the same action schema and dispatcher; no second execution path.
- Separate the offline wake-word detector from the AI brain. Wake-word detector is a lightweight trigger, not another conversational agent.
- Prefer native Android foreground microphone service for wake word, with persistent notification, pause/resume controls and documented Android/Samsung restrictions.
- Use streaming model output and incremental TTS where provider/API supports it. Measure first-token and first-audio latency on real device/network.
- Support interruption: stop TTS promptly, cancel or safely suspend current generation, then listen to the user.
- Fast mode defaults to low-latency model/settings and concise answers; Smart mode is opt-in/auto-triggered for complex tasks.
- Keep a single minimal home screen; move advanced controls into searchable, grouped settings.

## Non-negotiable safety/reliability rules
- Never claim a phone action succeeded unless Android tool result confirms it.
- Confirm sensitive actions (payments, sending messages/calls where appropriate, deleting data, security settings).
- Respect Android permission model, lock screen, call-role restrictions and foreground-service rules.
- No promise of unlimited/free cloud AI. Cloud STT/TTS/LLM use internet and may incur quota/cost.
- Never promise guaranteed 24/7 background operation: force-stop, OEM battery management and OS restrictions can stop services.
- Do not put secrets/API keys in source control; use Android Keystore or secure storage.

## Phased implementation
### Phase 0 — Code audit (must happen before coding)
- Map app entry, chat/session state, normal voice path, Live beta, model provider adapters, tool registry/dispatcher, native phone operator, wake-word service, settings, memory and build workflow.
- Run existing tests/typecheck/lint and record baseline.
- Identify which features are actually implemented vs documented vs device-tested.
- Produce a reuse/rewrite table. No blind full rewrite.

### Phase 1 — Clean ZENRO shell
- New minimal home/orb + unified chat/voice screen.
- Keep advanced settings out of the home screen.
- Rename/brand ZENRO; remove confusing specialist-agent UI.
- Keep one conversation history/session.

### Phase 2 — Single live agent
- Integrate live audio and existing tool dispatcher.
- One session handles chat, reasoning, function calls and task results.
- Streaming, concise default replies, interrupt/barge-in.
- Fast and Smart modes.

### Phase 3 — Wake word/background
- Offline “Hey Zenro” detector.
- Foreground mic service, notification, pause/resume, “Zenro sleep”.
- Test screen-off, app-swiped-away, reboot, battery optimization and force-stop limitations.

### Phase 4 — Phone tools and calls
- Reuse existing native phone operator only after verifying it works.
- Add supported call announcement/answer/reject flows with required Android roles/permissions.
- Test app launch, screen reading, tap/swipe/type, media and settings actions on target phone.

### Phase 5 — Voice, memory and settings
- Verify Sarvam API and voice catalogue; male/female preview.
- Memory edit/delete/export/backup.
- Clear ON/OFF controls, privacy and diagnostics.

### Phase 6 — Real-device QA and release
- Measure latency, interruption time, wake-word false accept/reject, battery drain and crash recovery.
- Test each feature on Samsung Galaxy S20 FE, Android 13.
- Release only tested features; maintain known-issues list.

## Definition of done
- Ordinary question: first visible/spoken response begins without waiting for a full long answer, measured on device.
- Live conversation and phone tools work in the same session.
- User can interrupt speech and continue naturally.
- Wake word and sleep/resume work in documented Android conditions.
- Phone tasks report success only after confirmed result.
- Call feature tested with real incoming calls and permissions.
- Settings toggles actually change behaviour.
- Existing automated tests, typecheck and lint pass; real-device checklist recorded.

## Next action
Complete Phase 0 source audit. Do not start a full rewrite or generate a giant one-shot Claude prompt before the reuse/rewrite table and baseline test results are ready.
