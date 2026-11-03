# ZENRO Master Audit (Round 1 — source-read only)

Scope: read from `friday_src.zip` (git archive of branch `zenro-phase1`, HEAD 76d900c, 552 files).
**Nothing was built, run, or tested in this audit.** No npm install, no vitest, no tsc, no APK, no phone.
Statuses below are therefore "from reading code", never "works on phone".

## What the app really is
- Tauri 2 shell + React (JSX) UI. Version 2.5.0, package com.jarvis.app.
- Render path: `src/main.jsx` -> `App.jsx` -> `hud/HudApp.jsx` (`JarvisHUD`). On a phone, `isMobileViewport()` forces the main window.
- The home screen ALREADY has an orb (`hud/Orb.jsx`, pure CSS animation), an ask bar, greeting, bottom tab bar with a centre mic. Header already says "ZENRO".
- "brain" runs in TypeScript inside the app (`src/brain/*`): providers (gemini, openai-compatible, openrouter, vertex), live voice (`brain/live/*`), memory (`brain/memory/*`), tools registry, schedule/routines, operator.
- Native Kotlin plugin `tauri-plugin-phone` (about 54 .kt files incl. tests): DirectActions, NativeOperator, WakeWordService, AutonomySupervisorService, JarvisNotificationListener, SecureSecretStore, TvAdb, WakeOnLan, TimerControl, CallAnnouncer (test exists), etc.
- 63 test files in `src/` plus Kotlin unit tests. Last known CI baseline (from your notes): 648 passed / 9 skipped / 0 failed. Not re-run here.

## Clutter found on the phone home (before this round)
Left-column ReadinessWidget + RoutinesWidget + other cards, big ticking HeroClock (re-renders every second), right column, floating "Live" button (`live-fab` in App.jsx), bottom tabs Chat / Memory / Skills / Capabilities, visible agent picker in ChatOverlay (props `activeAgent`, `onPickAgent`, `onToggleAgents` — NOT yet removed).

## Risks noticed
1. Phone-only features are mixed with desktop/PC-backend code paths (`useBrain.js` is 2866 lines, `Settings.jsx` 1902 lines). Large files = risky edits.
2. AndroidManifest in `gen/android` lists only INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, CAMERA, SYSTEM_ALERT_WINDOW. Other permissions may come from the plugin manifest; not yet reconciled. Alarm/notification/exact-alarm permissions on Android 13 need a check.
3. Many user-visible strings still say FRIDAY/JARVIS (ClarifyPrompt, permission dialogs, Settings, LivePanel, etc.).
4. Signing: `build-apk.yml` restores `ANDROID_KEYSTORE_BASE64` and only warns (does not fail) if the secret is bad, producing a random-key APK that cannot update your installed app. Worth making this a hard failure later. Fingerprint check against `add845a2...` is NOT in the workflow yet.
5. Not verified on the phone: Live voice, Sarvam Hindi/Hinglish quality, reminders/background survival, WhatsApp send, accessibility operator.

## Not touched
`main`, `zenro-v27-backup`, untracked `~/Friday/Friday/`, signing secrets, keystore.
