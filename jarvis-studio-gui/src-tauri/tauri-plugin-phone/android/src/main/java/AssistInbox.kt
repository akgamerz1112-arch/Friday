package com.jarvis.phone

import android.content.Intent

/**
 * "Assistant button" presses: the side-key long press, a headset button or the assist gesture,
 * once FRIDAY is the phone's Digital assistant app (FridayAssistant.kt). MainActivity hands every
 * intent here, like ShareInbox. A press starts a command recording on the wake engine at once,
 * no wake word needed ([WakeWordService.manualWake]). When the engine isn't up yet (the app was
 * launched cold by the press), the press waits a few seconds for it ([consumeFresh]).
 */
object AssistInbox {
    private const val FRESH_MS = 12_000L

    @Volatile
    private var requestedAt = 0L

    fun take(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        if (action != Intent.ACTION_ASSIST && action != Intent.ACTION_VOICE_COMMAND) return
        intent.action = null // a config change re-delivers the intent: take it once
        if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        requestedAt = System.currentTimeMillis()
        if (WakeWordService.manualWake()) requestedAt = 0L
    }

    /** True once if a press is still waiting for the engine (and forgets it). */
    @Synchronized
    fun consumeFresh(now: Long = System.currentTimeMillis()): Boolean {
        val t = requestedAt
        requestedAt = 0L
        return t != 0L && now - t < FRESH_MS
    }
}
