package com.jarvis.phone

/**
 * "Jarvis" heard while FRIDAY was in the background: [BackgroundAssistant] opens the app for Live voice and leaves
 * what was said after the name here. The WebView picks it up with its next wake poll ([take], once) and starts Live.
 */
object LiveWakeInbox {
    private const val FRESH_MS = 30_000L

    @Volatile
    private var text: String? = null

    @Volatile
    private var at = 0L

    fun request(said: String, now: Long = System.currentTimeMillis()) {
        text = said
        at = now
    }

    /** The waiting request's text (possibly empty) once, or null when none / too old. */
    @Synchronized
    fun take(now: Long = System.currentTimeMillis()): String? {
        val t = text
        text = null
        return if (t != null && now - at < FRESH_MS) t else null
    }
}
