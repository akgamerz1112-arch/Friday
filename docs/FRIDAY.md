# FRIDAY — what changed from JARVIS (phases 1–3)

## Phase 1 — identity
- App name, screens, notifications, spoken error messages and every model prompt now say **FRIDAY**.
  Persona: a professional, warm female assistant, Hindi first (Devanagari for Hindi words), English when
  the user writes English (`buildSystemPrompt` in `src/brain/index.ts`).
- **Unchanged on purpose:** the package ID `com.jarvis.app`, Kotlin package `com.jarvis.phone`, class
  names, storage keys (`jarvis.*`), notification channel IDs and the Keystore alias. Renaming any of these
  would make Android treat the app as a new one and lose saved keys and data.
- **Wake word is still "Hey Jarvis".** The on-device model (`hey_jarvis.onnx`) and the Whisper check that
  confirms it are tied to that phrase. A "Hey Friday" model has to be trained separately (phase 3).
  Over WhatsApp, "Hey Friday …" (greeting required, since Friday is a weekday) and "Jarvis …" both work.
- The update check now looks at this fork's releases (`akgamerz1112-arch/Friday`), not the upstream's.

## Phase 2 — natural Hindi voice (Sarvam Bulbul)
- `src/brain/platform/sarvamTts.ts`, called from `webspeech.ts`. Model `bulbul:v4-flash`, language
  `hi-IN`, female voices only (default `simran_hi_assistant`), Bulbul v3 `priya` as an automatic one-time
  fallback if a v4 voice is refused. Docs read: docs.sarvam.ai/api-reference/text-to-speech/convert.
- Key: Settings ▸ Voice ▸ *Natural Hindi voice*. Stored in the Android Keystore (`sarvamKey`), only sent as
  the `api-subscription-key` header to `api.sarvam.ai` (allow-listed in `capabilities/default.json`).
- Cost and latency: no request without a key / when switched off / offline / paused. Chunks of ≤ 380
  characters (first ≤ 160) with the next chunk fetched during playback. Short repeated phrases are cached
  in memory. Replies over 1,400 characters use the phone's own voice.
- Failures: a rejected key or used-up quota pauses Sarvam for 30 minutes, rate limits for 90 s, three
  network/server failures in a row for 5 minutes; a notice says so and the phone's own voice takes over
  (now a female Hindi voice for Devanagari text, chosen from the voices installed on the phone).
- Settings: on/off, voice, speed (0.6–1.6×), volume, **Test voice**, key entry/removal.

## Phase 3 — incoming calls, feature status, developer guide
- **Incoming-call announcement** (`CallAnnouncer.kt`): says «सर, राहुल का कॉल आ रहा है।». It reads the ringing-call
  *notification* through the existing notification listener, so it needs **notification access** only (no call-log or
  phone-state permission). Numbers are never read out (“एक अनजान नंबर से”). Switches in Settings ▸ Voice ▸ Incoming calls:
  on/off, quiet on silent/vibrate, quiet in Do Not Disturb, headphones only. Spoken with the phone's own Hindi voice,
  **not Sarvam**: Android freezes the WebView while the screen is off, so a ringing phone can't wait for it.
  Limit: a phone app that doesn't post a standard incoming-call notification isn't announced.
- **Feature status** (`src/brain/features.ts`, Settings ▸ System): one row per capability with ✓ / ! / – and a reason.
- Wake word, flashlight, volume, media keys, brightness, DND/ringer, apps, settings pages, alarms/timers, calendar,
  WhatsApp and notification replies, weather/news/search, routines and memory already existed (see `STATUS.md`).

## Adding a feature (developer guide)
| You want to add | Put it here |
|---|---|
| A one-step phone action | a branch in `DirectActions.device()` (Kotlin) **and** the name in `DEVICE_ACTIONS` (`brain/tools/registry.ts`); a test fails if they drift |
| A background phone behaviour | a small Kotlin `object` like `CallAnnouncer.kt`, hooked from the service it listens to; settings in its own `SharedPreferences` |
| A new native command from JS | `build.rs`, `src/commands.rs`, `lib.rs`, `mobile.rs`, `desktop.rs`, then a `@Command` in `PhonePlugin.kt` (or reuse `device_action` as the call announcer does) |
| A voice engine | a module beside `brain/platform/sarvamTts.ts`, called from `webspeech.ts` with the phone's voice as fallback |
| An AI provider | `brain/providers/`; routing in `routes.ts` |
| A tool the model can call | `brain/tools/registry.ts` (schema) + `dispatch.ts` (handler) |
| A setting | state + `buildCfg()` in `components/Settings.jsx`, stored key in `hooks/useBrain.js`; native-only settings apply immediately (call announcer) |
| A diagnostics row | append a `FeatureDef` to `FEATURES` in `brain/features.ts` |
Keep: package `com.jarvis.app`, Kotlin package `com.jarvis.phone`, `jarvis.*` storage keys, Keystore aliases.

## Setup on the phone (no computer needed)
1. GitHub app/website → your repo → **Actions → Build APK → Run workflow**; open the finished run → download the APK artifact.
2. Also check the **CI** run (typecheck + tests) — phase 3 was not compiled here.
3. Install over the old app (same package/signing → keys and data are kept).
4. Settings ▸ Voice: paste the Sarvam key, **Test voice**. Turn on *Announce who is calling* and grant notification access.

## Phase 4 — speed, male JARVIS voice, payments
- **Instant commands** (`src/brain/fastCommands.ts`): torch, volume, mute, silent/vibrate, music pause/next/play, "time kya hai"
  and "accessibility band karo" run on the phone with no AI call (no wait, no quota). Only short, unambiguous phrases match;
  anything else goes to the model as before. Add more in `matchFastCommand` + `fastCommands.test.ts`.
- **Male JARVIS**: Settings ▸ Voice ▸ Natural Hindi voice now also lists male Bulbul v3 voices (shubh, rahul, aditya, rohan, amit,
  anand — names from Sarvam's list). Picking a male voice makes the assistant answer as "JARVIS" in masculine Hindi; a female voice
  gives FRIDAY. (The wake phrase is still "Hey Jarvis".)
- **Google Pay**: Google Pay/banking apps refuse to run while *any* accessibility service is on — that is their own check and
  cannot be bypassed. Settings ▸ Voice ▸ Payments has *Pause app control* (FRIDAY switches its own service off; Android will not let
  an app switch it back on, so *Turn app control back on* opens Accessibility settings). Torch, volume, calls and notification
  replies do not need it. If Pay still refuses, FRIDAY's stop-overlay is the next suspect (Settings ▸ Interface).
- **Wake sensitivity** (Normal / High / Maximum): lowers the score bar from 0.35 to 0.25 / 0.18. Higher = softer and farther voices,
  but more false wakes. The one-word "Friday" still needs a trained model.
- **Build time**: `build-apk.yml` now caches npm, Rust and Gradle; the first run is slow, later ones are much faster.

## Not verified here (no network/SDK in the build environment)
Gradle/APK build, Android unit tests, the Settings screen, real audio playback in the WebView, and
the Sarvam request against the live API. See the phase-2 report for the device checklist.

## Phase 3 device checks still to do
- Ring the phone from a contact, an unsaved number and a WhatsApp call: is each announced once, in Hindi?
- Phase 4 checks: say 'torch on karo' with no internet-wait; pick Shubh and Test voice; Pause app control then open Google Pay; try each wake sensitivity.

## Phase 5 — screen reading, driving mode
- **"Hey Jarvis, screen par kya hai" / "ye padho"** (`isReadScreenRequest`, `readScreenText`): reads the text of the app in front through
  the accessibility tree (about 30 ms, no screenshot, no vision model) and the model answers in at most two sentences. OTP-style
  codes are masked; the screen text is passed as untrusted data. Needs App control on; it can't read FRIDAY's own screen, so say it
  from another app (the wake word works there). Apps that hide their text from accessibility (some games, video, banking) return nothing.
- **Driving / noisy mode** (Settings ▸ Voice): short answers + wake sensitivity High + voice volume/speed reset to full/1.0.
  Limits: the wake word listens on the **phone's** microphone, not a Bluetooth earbud's, so keep the phone close in a noisy car;
  earbuds only change what you hear. The mic input source is unchanged (an untested change could break the working wake word).
- Checks: read a chat, a web page, a settings screen; try driving mode in a moving car with the phone on a mount.

## Phase 6 — "Friday" wake word, faster reply
**Why "Friday" did nothing:** the on-device model (`hey_jarvis.onnx`) only scores the sound of "Hey Jarvis". It never fires
on "Friday", so nothing reaches the app. Before this phase the Whisper check also only accepted "Jarvis".
- `brain/platform/wakePhrase.ts` (pure, tested): accepts "Hey/Hi/OK Friday" (Whisper spellings like "Fry day"), Devanagari
  "फ्राइडे" (alone or after हे/ओके/अरे), and a bare "Friday" only as the **first word** of the clip ("Friday, torch on") since
  Friday is also a weekday. "Hey Jarvis" still works. "I'll see you Friday" does not.
- Native `WakeWordManager.modelAsset()`: loads `hey_friday.onnx` from the plugin assets **if present**, else `hey_jarvis.onnx`.
  The listening notification and Settings ▸ Voice / System rows show which one is loaded.
- **Quick end of command** (`CommandCapture.silenceMs`): a 0.65 s pause ends the command instead of 1 s, so the answer starts
  sooner. Turned on by Driving / noisy mode (`wakeSensitivity("high,quick")`); the Normal mode is unchanged.
- **Getting a real "Hey Friday" model** (the only reliable fix): train one with openWakeWord's automatic training Colab notebook
  (see the openWakeWord GitHub README, "Training New Models"; set the target phrase to `hey friday`, run all cells, download the `.onnx`).
  Then in Termux: `sh scripts/add-friday-model.sh` (picks the newest .onnx in Downloads), commit, push, run CI, then Build APK.
  Thresholds (0.35 / 0.25 / 0.18) were tuned on `hey_jarvis`; a new model may want different ones. Tune from the `DETECTION score=` logcat lines.
- After a Friday model is installed, these UI strings still say "Hey Jarvis" and need flipping: `HudApp.jsx`, `HudPanels.jsx`,
  `MobileOnboarding.jsx`, `Settings.jsx` (Groq key note), `brain/index.ts` (screen-read hint), `useBrain.js` (onFatal).
- Not verified: nothing here was compiled or run. Open question: whether the Jarvis model fires at all on "Hey Friday" at Maximum.

### Phase 6 device checks
- Settings ▸ Voice ▸ sensitivity **Maximum**, then say "Hey Friday, time kya hua": does it ever wake? (It may not; that is why a trained model is needed.)
- Say "Hey Jarvis" with the screen off and the app in the background: does it still answer? If not, the problem is not the word.
- Driving mode on: does the answer start about 0.3 s sooner? Does a short pause mid-sentence cut a command?

## Phase 7 — assistant button, rename by voice
- **FRIDAY as the phone's Digital assistant** (`FridayAssistant.kt`, `AssistInbox.kt`, plugin manifest, `res/xml/friday_voice_interaction.xml`).
  After the user picks FRIDAY under Settings ▸ Apps ▸ Default apps ▸ Digital assistant app, the side-key long press / headset button /
  assist gesture start a command recording on the running wake engine (`WakeWordManager.manualTrigger`): beep, speak, the pause ends it,
  no wake word. The clip is marked `manual`, so `wakeword.ts` skips the wake-phrase check for it. Needs the wake word switched ON (the
  engine must be running); if it isn't, the press opens the app and is picked up once the engine starts (12 s window).
  `MainActivity` also takes ASSIST / VOICE_COMMAND intents (headsets, launchers).
  **Samsung:** if the long press still opens Bixby, set Side key ▸ Press and hold to the assistant option in Settings ▸ Advanced features.
  Fallback: Side key ▸ Double press ▸ Open app ▸ FRIDAY (opens the app only; it does not start listening).
- **Rename by voice** (`matchPersona` in `brain/fastCommands.ts`): "Jarvis ban jao", "naam Friday rakh do", "tum Jarvis ho", "ab se Jarvis",
  "call yourself Jarvis", or just the name. Jarvis = a male Sarvam voice (Shubh, kept if a male voice is already set) and the male JARVIS persona;
  Friday = the default female voice and the FRIDAY persona. Questions ("tum jarvis ho ya friday?") are not orders. Saved with the voice setting.
- **The wake word follows the name.** JS tells the phone the chosen name (`wake_sensitivity` query `friday` / `jarvis`); the phone loads
  `hey_jarvis.onnx` for Jarvis, and `hey_friday.onnx` for Friday when that file is installed (else Jarvis's model). The Whisper check accepts
  the chosen name plus the loaded model's own name (`acceptedNames`), so with only the Jarvis model, "Hey Jarvis" keeps working under the Friday name.
  Name = Jarvis rejects "Hey Friday" on purpose.
- Not verified: nothing here was compiled or run. The assistant declaration (VoiceInteractionService + session + recognition stub) is the
  riskiest part: if the app does not appear in the Digital assistant list, or the session can't start the engine, that is where to look.

### Phase 7 device checks
- Settings ▸ Apps ▸ Default apps ▸ Digital assistant app: is FRIDAY listed? Pick it. Long press the side key: beep, then speak "time kya hua".
- Same press with the app closed, and with the wake word switched off in FRIDAY (expect the app to open).
- Say "Jarvis ban jao": does the voice become male and the next "Hey Jarvis" still wake? Then "Friday ban jao".


## Phase 8 — Hindi listening fix, silent launch
Cause of "sahi se sun nahi pata / task nahi karta": speech-to-text was forced to English (Groq `language=en`, Vertex `en-US`), so Hindi was turned into wrong English text.
- stt.ts: Groq now `language=hi` with a Hinglish prompt; Vertex Chirp `hi-IN`; Hindi stock "thank you" hallucinations screened.
- wakePhrase.ts / wakeword.ts: "हे जार्विस" / "हे फ्राइडे" in Devanagari now count as a wake and the command is cut after it. New tests in wakeword.test.ts.
- useBrain.js: no spoken greeting on app launch (text bubble stays).
- Not compiled or run here. Only the wake regexes were checked with node.

### Phase 8 device checks
- CI green? Then say "Hey Jarvis, torch chalu karo" and "Hey Jarvis, kitne baje hain" without touching the mic button.
- Button mic: Hindi sentence, check the bubble shows correct Hindi text.
- App open: no voice should play at launch.


## Phase 9 — greeting voice, faster command end
- Launch greeting is now just "हे बॉस!", spoken with Sarvam ONLY (waits up to ~5 s for the saved key; silent if Sarvam is unusable, never the phone's own voice).
- Wake phrase: Devanagari "जार्विस, ..." as the first word counts (Latin "Jarvis, ..." deliberately does NOT: false-wake guard); "है जार्विस" too.
- Command end: the native silence wait is now 750 ms by default (was 1000 ms); driving-mode off returns to "normal,quick".
- Still the main waits: Whisper upload, then the Sarvam round trip before the reply is heard. Not measured here. Not compiled or run.

### Phase 9 device checks
- App open: only "हे बॉस" in the Sarvam voice, no other voice before it.
- "Jarvis, torch chalu karo" (name first) and "Hey Jarvis" + pause + command: wake without the button?
- Does the command get cut in the middle when you pause while speaking? If yes, tell me (silence 750 ms is too short).

## Phase 10 — updates over the old app
Cause of "update nahi hota, pehle delete karna padta": Build APK makes a DEBUG apk, and every GitHub runner makes a brand-new random debug key, so each APK has a different signature and Android refuses to update.
- build-apk.yml: new step puts a FIXED keystore (secret ANDROID_KEYSTORE_BASE64) at ~/.android/debug.keystore before the build. Without the secret it warns and behaves as before.
- scripts/make-keystore.sh (Termux): makes the key once (alias androiddebugkey, password android), copies it as base64 for the secret. Back up ~/friday.keystore.
- ONE last uninstall is needed (the app on the phone has an old random key). After that every build updates in place.
- Not run on GitHub here; recipe checked locally (keytool + base64 round trip).

## CI fix (after phases 8-10 push)
Typecheck passed; 3 old tests failed and are fixed: fastCommands music switch now only for short orders (<=4 words, so "play some music by Arijit" goes to the model); wakeword.test.ts updated for the Friday wake prompt ("Friday, Jarvis") and for the `manual` flag in the onWake argument. Re-run CI to confirm (not run here; only the music case checked with node).
