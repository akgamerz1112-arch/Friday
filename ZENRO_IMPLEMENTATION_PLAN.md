# ZENRO Implementation Plan

Rule: one package per zip, each small enough to build once on GitHub Actions.

- B1 (this zip): minimal phone home, 4-tab nav, remove Live FAB, black/cyan theme.
- B2: hide agent/provider pickers in chat; replace remaining FRIDAY/JARVIS strings; Retry on error; error orb state.
- A1: signing guard in CI (fail if fingerprint != add845a2...), no secrets printed.
- F1: reconcile AndroidManifest permissions for Android 13 (alarms, notifications), permission status screen.
- E1: Memory screen: why saved / source / edit / delete; check restart persistence.
- C1: audit Live providers, define session state machine, interruption, reconnect.
- D1: tool schema/timeouts/retry caps audit; confirmation UI wording.
- G1/H1/I1: reminders+proactive controls, research/doc checks, performance/security pass.

Each step ends with: tests run (if possible), build result, then YOUR phone result. I will not report phone results I did not see.
