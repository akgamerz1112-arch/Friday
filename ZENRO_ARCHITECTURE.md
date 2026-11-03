# ZENRO Architecture (as read, Round 1)

UI: React (JSX) in Tauri WebView.
  main.jsx -> App.jsx (state hub, dialogs) -> hud/HudApp.jsx (home, tabs, overlays)
  Overlays: ChatOverlay, MemoryOverlay, SkillsOverlay, CapabilitiesOverlay, Settings, LivePanel, AgentActivity.
State/brain: hooks/useBrain.js (2866 lines) wires src/brain/*.
  providers/  gemini, openai-compatible, openrouter, vertex; routing + quota + model ranker.
  live/       mic, pcm, player, session, sarvamSpeaker, tools (Live tool calling).
  memory/     store, vectorStore, quickMemory, digest, guard, sync.
  tools/      registry + dispatch (schemas), http.
  schedule/   reminders, routines.
Native: tauri-plugin-phone (Kotlin) — direct actions, operator (accessibility), wake word, notification listener, secure secret store, autonomy supervisor, TV/WOL.
Build: GitHub Actions build-apk.yml (debug-keystore restore from secret) and release.yml (release keystore from secrets).

Target shape (plan): one ZENRO home (orb + ask bar), 4 destinations (Chat, Memory, Activity, Settings), everything else contextual. Internals (agents, providers) hidden from the main UI but kept.
