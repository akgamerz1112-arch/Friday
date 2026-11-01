package com.jarvis.phone

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.SharedPreferences
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.service.notification.StatusBarNotification
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import java.util.Locale

/**
 * Speaks "Sir, <name> ka call aa raha hai." when a call rings.
 *
 * How it works: it reads the phone app's *incoming-call notification* through the
 * existing notification listener (no READ_PHONE_STATE / READ_CALL_LOG permission, so the
 * caller name is exactly what the dialer shows). Only notifications that are in the
 * "call" category AND look incoming (Android 12 CallStyle "incoming", or a full-screen
 * ring screen) are announced; ongoing calls are ignored. Each ring is announced once.
 *
 * Voice: the phone's own TTS engine, Hindi female voice where one is installed. The
 * Sarvam voice lives in the WebView, which Android freezes in the background, so a
 * ringing phone cannot depend on it.
 *
 * Respects (all user-switchable in Settings ▸ Voice): the master switch, silent/vibrate
 * ringer mode, Do Not Disturb, and "only on headphones".
 */
object CallAnnouncer {
    private const val PREFS = "friday.callannounce"
    private const val K_ON = "on"
    private const val K_SILENT = "respect_silent"
    private const val K_DND = "respect_dnd"
    private const val K_HEADSET = "headset_only"
    private const val K_LAST = "last"

    /** Phone apps whose call notification is the system call screen (no app name needed). */
    private val DIALERS = setOf(
        "com.samsung.android.incallui", "com.google.android.dialer", "com.android.dialer",
        "com.android.incallui", "com.android.server.telecom", "com.samsung.android.dialer",
    )

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun configure(ctx: Context, on: Boolean, respectSilent: Boolean, respectDnd: Boolean, headsetOnly: Boolean) {
        prefs(ctx).edit().putBoolean(K_ON, on).putBoolean(K_SILENT, respectSilent)
            .putBoolean(K_DND, respectDnd).putBoolean(K_HEADSET, headsetOnly).apply()
    }

    fun enabled(ctx: Context) = prefs(ctx).getBoolean(K_ON, false)

    // ── Detection (pure; unit-testable) ─────────────────────────────────────────

    internal fun looksLikeNumber(s: String): Boolean {
        val digits = s.count { it.isDigit() }
        return digits >= 3 && s.all { it.isDigit() || it in "+-() .#*" }
    }

    internal fun sentence(caller: String, via: String): String {
        val c = caller.trim()
        val app = if (via.isBlank()) "" else "$via पर "
        return if (c.isEmpty() || looksLikeNumber(c)) "सर, ${app}एक अनजान नंबर से कॉल आ रहा है।"
        else "सर, ${app}$c का कॉल आ रहा है।"
    }

    /** True for a ringing (not in-progress) call notification. */
    private fun incoming(n: Notification, ongoing: Boolean): Boolean {
        if (n.category != Notification.CATEGORY_CALL) return false
        val type = n.extras.getInt("android.callType", 0) // 1 = incoming, 2 = ongoing, 3 = screening
        if (type == 1) return true
        if (type != 0) return false
        return n.fullScreenIntent != null && !ongoing
    }

    // ── Listener hook ───────────────────────────────────────────────────────────

    fun offer(ctx: Context, sbn: StatusBarNotification) {
        if (!enabled(ctx) || sbn.packageName == ctx.packageName) return
        val n = sbn.notification
        if (!incoming(n, sbn.isOngoing && n.fullScreenIntent == null)) return
        val key = sbn.key + "@" + sbn.postTime
        val p = prefs(ctx)
        if (p.getString(K_LAST, "") == key) return          // Android re-posts while ringing
        p.edit().putString(K_LAST, key).apply()
        if (!allowedNow(ctx, p)) return
        val caller = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val via = if (sbn.packageName in DIALERS) "" else appLabel(ctx, sbn.packageName)
        speak(ctx, sentence(caller, via))
    }

    private fun appLabel(ctx: Context, pkg: String) = try {
        ctx.packageManager.getApplicationLabel(ctx.packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) { "" }

    private fun headsetConnected(am: AudioManager) =
        am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                it.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
                (Build.VERSION.SDK_INT >= 31 && it.type == AudioDeviceInfo.TYPE_BLE_HEADSET)
        }

    private fun allowedNow(ctx: Context, p: SharedPreferences): Boolean {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (p.getBoolean(K_SILENT, true) && am.ringerMode != AudioManager.RINGER_MODE_NORMAL) return false
        if (p.getBoolean(K_DND, true)) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.currentInterruptionFilter > NotificationManager.INTERRUPTION_FILTER_ALL) return false
        }
        if (p.getBoolean(K_HEADSET, false) && !headsetConnected(am)) return false
        return true
    }

    // ── Speaking (phone's own TTS, Hindi female where installed) ─────────────────

    @Volatile private var tts: TextToSpeech? = null
    @Volatile private var ready = false
    private var queued: String? = null

    @Synchronized
    internal fun speak(ctx: Context, text: String) {
        if (ready && tts != null) { say(text); return }
        queued = text
        if (tts != null) return
        tts = TextToSpeech(ctx.applicationContext) { status ->
            synchronized(this) {
                if (status != TextToSpeech.SUCCESS) { tts = null; return@TextToSpeech }
                prepare(tts!!)
                ready = true
                queued?.let { say(it) }
                queued = null
            }
        }
    }

    private fun prepare(t: TextToSpeech) {
        try {
            t.language = Locale("hi", "IN")
            t.setAudioAttributes(
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
            )
            femaleHindi(t.voices)?.let { t.voice = it }
        } catch (_: Exception) { }
    }

    /** Android exposes no gender flag: prefer a voice whose name says "female", then Google's
     *  usual female Hindi ids, then any installed offline Hindi voice. */
    internal fun femaleHindi(voices: Set<Voice>?): Voice? {
        val hindi = voices.orEmpty().filter { it.locale.language == "hi" }.sortedBy { it.isNetworkConnectionRequired }
        return hindi.firstOrNull { it.name.contains("female", true) }
            ?: hindi.firstOrNull { Regex("hi-in-x-hi[ac]-").containsMatchIn(it.name) }
            ?: hindi.firstOrNull()
    }

    private fun say(text: String) {
        try { tts?.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), "friday_call") } catch (_: Exception) { }
    }

    fun filters(ctx: Context): Triple<Boolean, Boolean, Boolean> = prefs(ctx).let {
        Triple(it.getBoolean(K_SILENT, true), it.getBoolean(K_DND, true), it.getBoolean(K_HEADSET, false))
    }

    /** What Settings shows: is it on, is notification access granted. */
    fun status(ctx: Context): Pair<Boolean, Boolean> = enabled(ctx) to JarvisNotificationListener.enabled(ctx)
}
