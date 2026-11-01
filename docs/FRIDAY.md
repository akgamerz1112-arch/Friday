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

## Not verified here (no network/SDK in the build environment)
Gradle/APK build, Android unit tests, the Settings screen, real audio playback in the WebView, and
the Sarvam request against the live API. See the phase-2 report for the device checklist.

## Phase 3 device checks still to do
- Ring the phone from a contact, an unsaved number and a WhatsApp call: is each announced once, in Hindi?
