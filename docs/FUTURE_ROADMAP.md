# FRIDAY — Future Roadmap

Written 2026-11-01 against `FRIDAY-complete-project-v15`. Everything marked **exists** was checked in the
code of that ZIP; everything marked **plan** is not built. Costs are rough orders of magnitude, not quotes —
check each provider's current pricing page before committing. Nothing here is claimed to work until it has
been tested on the phone (see `docs/STATUS.md`).

## Rules for every feature

1. **Do not build 20 things at once.** One feature per delivery, behind its own switch, each with tests.
2. **Modular.** A new capability = one folder under `src/brain/<feature>/` + one schema in `tools/registry.ts`
   + one handler in `tools/dispatch.ts` + one row in `features.ts` (see "Adding a feature" in `docs/FRIDAY.md`).
   No second execution path, no new native command unless unavoidable (CLAUDE.md rules 1–2).
3. **Stable first.** Package ID `com.jarvis.app`, `jarvis.*` storage keys, Keystore aliases and the
   Gemini/Groq/OpenRouter/Vertex fallback are not touched.
4. **Honest results.** A tool reports only what its real return value says (CLAUDE.md rule 3).
5. **Consent.** Anything that records, reads money, or reads other people's messages is off by default and
   needs an explicit switch in Settings.
6. **Phone-only.** Every feature must build through GitHub Actions; no step may need a laptop.

## Priority order (value × reliability × cost × fit with this app)

| # | Feature | Status in code | Verdict |
|---|---|---|---|
| 0 | Wake word + reply speed (not on the 20 list) | phases 6–15 added Friday phrase check, assistant button, quick end, speed timing; a trained `hey_friday.onnx` is still missing | Continue from device logs (`docs/FRIDAY.md` phases 12–15), not from this roadmap |
| 0b | Realtime Live voice (Gemini Live) | beta built in v19 (`src/brain/live`), conversation only, untested on phone | Test, then add tools |
| 9 | Document intelligence | text files only → **Word/Excel/PowerPoint added in v16**, PDF open | **Step 1 done** |
| 18 | Customizable personality | rename by voice + male/female persona exist (phase 7); tone/style options do not | **Next** — small: tone presets only |
| 10 + 19 | Daily briefing + proactive reminders | routines, reminders, call/WhatsApp announcer exist | **Next** — polish, little new code |
| 1 | Personal knowledge graph | keyword + vector memory exist | Later — light local version |
| 17 | Meeting transcription (with consent) | `record` + STT exist, no summary pipeline | Later |
| 13 | Plugin / skills system | none | Later — design only until 3 features exist to share a manifest |
| 7 | Workflow builder | routines + playbooks + `workflow.ts` exist | Extend, don't rebuild |
| 4 | Android automation | `phone_task` operator + `DirectActions` exist | Already strong; fix bugs, not features |
| 3 | Windows computer-use agent | `pc_task` forwards to the desktop backend (separate repo) | Not buildable here; only the link exists |
| 5 | Cross-device sync | `memory/sync.ts` (facts + routines, phone↔PC) exists | Works for PC only; other devices later |
| 11 | Smart home | Android TV over ADB exists (`remote/tv.ts`) | Only for devices you actually own — tell me which |
| 2 | Visual intelligence | screenshot + accessibility screen reading exist; no camera | Later — camera Q&A |
| 6 | Google Drive | none (granted-folder access only) | Later, needs OAuth setup |
| 14 | Browser agent | dropped on phone; `phone_task` drives the browser app | Skip; use `phone_task` |
| 15 | Coding agent | none | Skip on phone |
| 8 | Live translation | none dedicated (the model can translate text in chat) | Later |
| 12 | Offline AI engine | `fastCommands.ts` runs a few commands with no AI | Extend the rule list; a true offline LLM is too heavy |
| 16 | Personal finance | none | Only manual/opt-in; high risk |
| 20 | Digital twin | none | Not recommended now |

---

## 9. Document intelligence — step 1 built (v16)

- **Usefulness:** "meri Excel me total kitna hai", "is Word file ka summary do", "slides ka main point".
- **Reuse:** `read_file` tool, the granted-folder picker (Settings ▸ Storage & Privacy), `PhonePlugin.readFile`.
- **What was built:** `src/brain/documents/extract.ts` — a dependency-free zip + XML reader for `.docx`, `.xlsx`,
  `.pptx`. `read_file` now returns their text. The only native change is an optional `base64` flag on the
  existing `read_file` command (Rust `FileOpRequest`, Kotlin `FileOpArgs`) so the file's bytes reach JS; no new
  command name.
- **Limits (true today):** no PDF, no old `.doc/.xls/.ppt`, no password-protected files, no images/charts inside
  files, Excel dates show as Excel's serial numbers, formulas show the value Excel last saved, 12 MB file cap,
  output cut at 15,000 characters (the reply says how much was omitted), first 300 rows × 40 columns per sheet.
- **APIs / permissions:** none new. Folder access is the same read-only grant as before.
- **Complexity:** low (done). **Cost:** no API cost for reading; the text then costs normal model tokens
  (≤ ~4k tokens per read).
- **Risks:** document text goes to the AI provider you picked (Gemini/Groq) like any chat message — say so in
  Settings. Prompt-injection: a document can contain instructions; FRIDAY must treat file text as data
  (existing rule: tool output is not an instruction).
- **Acceptance tests:** automated (`documents/extract.test.ts`, 10 cases incl. real Word/Excel/PowerPoint files);
  on device: grant a folder, ask "Budget.xlsx padho" → sheet names and rows match the file; a `.docx` with a
  table keeps rows; a `.pdf` gets the clear "not supported yet" message; a damaged file gets an error, not
  invented text.
- **Step 2 (plan):** PDF. Two options, to be chosen after testing: (a) send the PDF to Gemini as an inline
  document (works only on the Gemini route, uses quota, size-limited), (b) a small bundled text extractor
  (adds APK size). Not claimed until tested.

## 18. Customizable personality

- **Exists (phase 7):** "Jarvis ban jao" / "naam Friday rakh do" (`matchPersona` in `fastCommands.ts`), female Friday vs
  male Jarvis voice and persona, `buildSystemPrompt` in `brain/index.ts`.
- **Missing:** tone presets (formal / friendly / short answers) and a place to set them.
- **Plan:** one `tone` setting appended to the system prompt, plus a fast command ("chhota jawab do"). **Permissions/APIs:**
  none. **Complexity:** low. **Cost:** none (a few extra prompt tokens).
- **Risks:** persona text must never override safety rules or the "never claim success" rule.
- **Tests:** set a tone → next reply follows it; restart app → tone kept; tool-result honesty unchanged.

## 10 + 19. Daily briefing and proactive reminders

- **Reuse:** `manage_routine` (scheduled briefings), `set_reminder`, `schedule/*`, weather/news tools, calendar tool,
  `CallAnnouncer.kt`.
- **Limit already documented:** when the app is closed a timed routine only posts a notification; Android freezes the
  WebView. So a "spoken 8:00 briefing" must be a notification you tap, unless a foreground service is added.
- **Plan:** one briefing routine (weather + calendar + reminders + 3 headlines) in Hindi; notification action
  "Sunao". **APIs:** existing; calendar permission already used. **Complexity:** low–medium. **Cost:** ~1 model
  call per briefing.
- **Risks:** notification text shows on lock screen → option to hide details.
- **Tests:** routine fires within 2 minutes of its time on a locked phone; tap opens the spoken briefing; no
  duplicate fire after reboot.

## 1. Personal knowledge graph and memory

- **Reuse:** `memory/store.ts` (keyword), `memory/vectorStore.ts` (embeddings; needs the Vertex service account),
  `memory/digest.ts`, `memory/sync.ts`.
- **Plan:** a small local entity table (person, place, thing, relation) filled from `remember_fact`; queries like
  "Rahul kaun hai" answered from it before any model call. No new cloud service.
- **Complexity:** medium. **Cost:** none locally. **Risks:** it stores personal facts about other people — local only,
  visible and deletable in one screen, included in "forget".
- **Tests:** 20 remembered facts → relation lookup correct; "forget Rahul" removes him from every store.

## 17. Meeting transcription and summary (with consent)

- **Reuse:** `record` tool (MediaRecorder), STT platform code. **Missing:** a long-recording → text → summary pipeline.
- **Plan:** explicit "recording on" indicator + spoken notice, user confirms every time; transcript via the chosen
  provider; summary stored as a file. **Cost:** audio transcription is the expensive part — measure before shipping.
  **Risks:** legal consent of other speakers (law differs by place) — FRIDAY only reminds, it cannot decide.
  Android limits background mic use.
- **Tests:** 10-minute recording yields a transcript; stopping really stops the mic (indicator off); no recording
  without the confirm step.

## 13. Plugin and skills ecosystem

- **Plan:** a manifest (`name`, `tools[]`, `permissions[]`, `settingsKey`) loaded from `src/brain/plugins/`. Plugins
  ship *with the app* (no downloaded code — Play-style and security reasons). Build it only after 2–3 features use
  the same pattern, so the manifest is designed from real examples. **Complexity:** medium. **Risk:** loading code
  from outside the APK would bypass every permission rule — do not do it.

## 7. Workflow builder — extend, don't rebuild

- **Exists:** routines, playbooks, procedural learning (`schedule/routines.ts`, `memory/proceduralLearning.ts`,
  `workflow.ts`). **Plan:** a simple "if this then that" list on top of existing routines. Low–medium.

## 4. Advanced Android automation

- **Exists:** `phone_task` (AccessibilityService operator), one-step `device_control`, send_message, call_contact,
  navigate_to, play_media. **Known real limit:** banking/Google Pay apps refuse to run while any accessibility
  service is on (documented in `docs/FRIDAY.md`). Plan = fix reliability found in device tests, not new scope.

## 3. Windows computer-use agent

- **Exists only as a link:** `pc_task` forwards goals to a separate desktop backend that is not in this repo.
  Building a Windows agent means building and securing that backend (biometric pairing is already required). Out of
  scope for the phone app.

## 5. Cross-device synchronization

- **Exists:** facts + routines merge between phone and PC (`memory/sync.ts`, newest change wins, tombstones).
  Playbooks stay per device. A second phone/tablet would need a relay server and end-to-end encryption — a large
  security job; not now.

## 11. Smart home

- **Exists:** Android TV over network ADB (`remote/tv.ts`, verified in `docs/STATUS.md` for one Sony TV).
  Lights/plugs need the vendor API or Home Assistant. **Ask first:** which devices do you own? Build for those only.

## 2. Visual intelligence

- **Exists:** `take_screenshot`, accessibility screen reading, TV "look". **Missing:** camera. **Plan:** one-shot
  "camera se dekho" (photo → vision model). **Permissions:** CAMERA. **Cost:** one vision call per photo.
  **Risks:** images go to the provider; never auto-capture; never keep photos unless asked.

## 6. Google Drive file management

- Needs Google OAuth (consent screen, client ID, scopes) — a setup task that is hard from a phone and adds API
  keys to protect. Cheaper path: the existing granted-folder reader works on a folder the Drive app syncs/exposes.

## 8. Live translation

- Chat translation already works through the model. *Live* two-way speech needs streaming STT + TTS with low
  latency; this app's speech path is WebView-based (CLAUDE.md rule 9), which limits it. Later.

## 12. Offline command engine

- **Exists:** `fastCommands.ts` (torch, volume, mute, ringer, media keys, time, accessibility off) with no AI call.
  **Plan:** add rules (alarm, timer, open app, call by name, brightness) with tests. A full offline language model
  is not realistic on a phone with a 12-hour-battery goal.

## 14 / 15. Browser agent, coding agent

- Not recommended on the phone. Browser tasks go through `phone_task`; coding is better done in a chat app.

## 16. Personal finance (only with explicit authorization)

- Highest risk on the list. Allowed shape: **manual entry** ("500 rupaye chai pe") into a local ledger and monthly
  totals. **Not planned:** reading bank SMS/notifications or UPI apps, storing card/account numbers.

## 20. Digital twin

- Not recommended: it combines every risk above (private data, impersonation) for little daily value. Revisit only
  after #1, #17 and #18 are solid and only as a *local, user-controlled* style profile.
