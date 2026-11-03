# ZENRO Feature Status (Round 1)

Legend: IU = implemented but unverified (code exists, not run by me) · P = partial · NI = not implemented · CH = changed this round, not built/tested

| Area | Status | Note |
|---|---|---|
| Phone home: single orb + greeting + ask bar | CH | Clock removed, cards moved into collapsed "More" |
| Bottom nav Chat / Memory / Activity / Settings | CH | Skills, Capabilities, Live moved into "More" |
| Floating Live button | CH | Removed; Live now in "More" and Settings |
| Orb states idle/listening/thinking/speaking/working | IU | CSS-only animation = decorative, NOT driven by real audio level |
| Error orb state | P | Not seen in Orb.jsx |
| Chat overlay, history, stop | IU | |
| Hide agent/provider picker in chat | NI | Still present in ChatOverlay |
| Live voice (brain/live) | IU | Needs phone test; provider capabilities not audited yet |
| Sarvam TTS + male/female voice | IU | From earlier phase; Hinglish quality untested |
| Tool registry / dispatch | IU | Tests exist (registry, dispatch) |
| Permission/approval dialogs (R2/R3) | IU | Exist in App.jsx; still say "FRIDAY" |
| Memory store + vector store | IU | Tests exist for store; restart persistence untested here |
| Memory UI with "why saved" / source | P | MemoryOverlay exists; fields not audited |
| Reminders / routines / call announcer | IU | Kotlin + TS present; background reliability unverified |
| Android 13 permission status screen | P | ReadinessWidget covers some items |
| Web research / documents | IU | brain/documents exists; not audited |
| Provider health / fallback routing | IU | routing + quota modules exist; not audited |
| PC / TV control | IU | Present; stays modular, not promised |
| Proactive assistance controls | NI | Not audited |
| Signing fingerprint check in CI | NI | See audit risk 4 |
| Automated tests this round | NOT RUN | No node_modules/network in my sandbox |
| Build / APK / device | NOT RUN | |
