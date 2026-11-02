package com.jarvis.phone

import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import java.util.concurrent.Executors

/**
 * Wake word while FRIDAY is NOT on screen.
 *
 * The normal path (wakeword.ts) runs in the WebView, and Android throttles the WebView
 * the moment the app leaves the screen: the mic dot stays on (the foreground service
 * keeps recording and detecting) but nobody collects the clip. This object takes the clip
 * over inside the service when the WebView has stopped polling, and does the whole
 * round trip natively: Groq Whisper (Hindi) -> instant phone command, or a short Groq chat
 * answer -> spoken with the phone's Hindi voice. When the app IS on screen nothing here
 * runs and the JS path behaves exactly as before.
 *
 * Limits (also in docs/FRIDAY.md): needs the Groq key; speaks with the phone's voice, not
 * Sarvam; no tools, screen reading or phone-control tasks (those need the app open).
 */
object BackgroundAssistant {
    private const val TAG = "BackgroundAssistant"
    /** JS polls every 140 ms; no poll for this long = WebView is asleep. */
    private const val STALE_MS = 2_500L
    /** WebView looked alive but never took the clip. */
    private const val GRACE_MS = 5_000L
    private const val GROQ = "https://api.groq.com/openai/v1"

    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newSingleThreadExecutor()

    /** Called by the service when detection [seq]'s clip is ready. */
    fun maybeTakeOver(ctx: Context, seq: Int) {
        val app = ctx.applicationContext
        val asleep = SystemClock.elapsedRealtime() - WakeWordService.lastJsPollMs > STALE_MS
        if (asleep) take(app, seq) else main.postDelayed({ take(app, seq) }, GRACE_MS)
    }

    private fun take(ctx: Context, seq: Int) {
        // Handed out once: if the WebView already took it, this is null and we stay out.
        val p = WakeWordService.takePreRoll(seq) ?: return
        val wav = p.wavBase64
        val speech = p.speech
        val manual = p.manual
        pool.execute {
            try {
                process(ctx, wav, speech, manual)
            } catch (e: Exception) {
                android.util.Log.w(TAG, "background command failed: ${e.message}")
            }
        }
    }

    // ── Pipeline ─────────────────────────────────────────────────────────────────

    private fun process(ctx: Context, wavB64: String, speech: Boolean, manual: Boolean) {
        val live = canOpenLive(ctx)
        // A bare "Hey Jarvis" is only worth a look when it can open Live.
        if (!speech && !live) return
        val key = groqKey(ctx)
        if (key == null) {
            if (speech) CallAnnouncer.speak(ctx, "Groq की कुंजी नहीं मिली। ऐप खोलकर डालिए।")
            return
        }
        val heard = transcribe(key, Base64.decode(wavB64, Base64.DEFAULT)) ?: return
        var text = if (manual) heard.trim() else stripWake(heard) ?: return // no wake phrase = a false wake
        if (!speech) text = "" // nothing real after the name: whatever was transcribed is noise
        val fast = if (text.isBlank()) null else NativeFast.match(text, Calendar.getInstance())
        if (fast != null) {
            val ok = fast.run(ctx)
            if (!ok) CallAnnouncer.speak(ctx, "ये अभी नहीं हो पाया।")
            else if (fast.say.isNotEmpty()) CallAnnouncer.speak(ctx, fast.say)
            return
        }
        // Not an instant command: bring FRIDAY to the front and start Live voice (it gets the sentence).
        if (live) { openLive(ctx, text); return }
        if (text.isBlank()) return
        CallAnnouncer.speak(ctx, chat(key, text) ?: "अभी जवाब नहीं मिल पाया। थोड़ी देर बाद कोशिश करें।")
    }

    /** From the background Android only lets an app open its own screen with "Display over other apps" granted. */
    private fun canOpenLive(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(ctx)

    private fun openLive(ctx: Context, text: String) {
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
        LiveWakeInbox.request(text)
        launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
        )
        try {
            ctx.startActivity(launch)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "could not open Live from the background: ${e.message}")
            LiveWakeInbox.take() // nothing will pick it up
            if (text.isNotBlank()) CallAnnouncer.speak(ctx, "ऐप नहीं खुल पाया। \"Display over other apps\" चालू करें।")
        }
    }

    private val WAKE = Regex(
        "(hey|hay|ae|a)?\\s*(jarvis|jarvish|friday|जार्विस|जारविस|जार्वीस|जर्विस|फ्राइडे|फ्रायडे|फ्राईडे|फ्राइडै)",
        RegexOption.IGNORE_CASE,
    )

    /** Text after the wake phrase, or null when the phrase isn't in the first few words. */
    internal fun stripWake(heard: String): String? {
        val t = heard.trim()
        val m = WAKE.find(t) ?: return null
        if (m.range.first > 18) return null
        val head = t.substring(0, m.range.first).replace(Regex("(हे|हेय|ए)\\s*$"), "")
        if (head.isNotBlank() && head.length > 6) return null
        return t.substring(m.range.last + 1).trimStart(' ', ',', '.', '।', '-', '!', '?')
    }

    private fun groqKey(ctx: Context): String? = try {
        SecureSecretStore(ctx).get("groqKey")?.split('\n', ',', ' ')?.map { it.trim() }
            ?.firstOrNull { it.startsWith("gsk_") }
    } catch (e: Exception) { null }

    private const val PROMPT = "हे जार्विस, हे फ्राइडे। टॉर्च चालू करो, आवाज़ कम करो, बैटरी कितनी है, समय क्या हुआ।"

    private fun transcribe(key: String, wav: ByteArray): String? {
        val boundary = "----friday${System.currentTimeMillis()}"
        val c = URL("$GROQ/audio/transcriptions").openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.doOutput = true
            c.connectTimeout = 8_000; c.readTimeout = 25_000
            c.setRequestProperty("Authorization", "Bearer $key")
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            DataOutputStream(c.outputStream).use { o ->
                fun field(n: String, v: String) =
                    o.write("--$boundary\r\nContent-Disposition: form-data; name=\"$n\"\r\n\r\n$v\r\n".toByteArray())
                field("model", "whisper-large-v3"); field("language", "hi")
                field("response_format", "json"); field("temperature", "0"); field("prompt", PROMPT)
                o.write("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"c.wav\"\r\nContent-Type: audio/wav\r\n\r\n".toByteArray())
                o.write(wav); o.write("\r\n--$boundary--\r\n".toByteArray())
            }
            if (c.responseCode !in 200..299) return null
            val text = JSONObject(c.inputStream.bufferedReader().readText()).optString("text").trim()
            // Whisper sometimes echoes its prompt on near-silence.
            return text.takeIf { it.isNotBlank() && !it.contains("टॉर्च चालू करो, आवाज़ कम करो, बैटरी") }
        } finally { c.disconnect() }
    }

    private fun chat(key: String, q: String): String? {
        val c = URL("$GROQ/chat/completions").openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.doOutput = true
            c.connectTimeout = 8_000; c.readTimeout = 25_000
            c.setRequestProperty("Authorization", "Bearer $key")
            c.setRequestProperty("Content-Type", "application/json")
            val body = JSONObject()
                .put("model", "openai/gpt-oss-20b")
                .put("reasoning_effort", "low")
                .put("max_completion_tokens", 500)
                .put("messages", JSONArray()
                    .put(JSONObject().put("role", "system").put("content",
                        "You are FRIDAY, a calm Hindi-first phone assistant. Reply in Devanagari Hindi (English only for names), " +
                            "at most two short plain sentences, no markdown, no lists. If the user needs something only the phone " +
                            "app can do (opening apps, reading the screen, messages), say in one short sentence that they should open FRIDAY."))
                    .put(JSONObject().put("role", "user").put("content", q)))
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            if (c.responseCode !in 200..299) return null
            return JSONObject(c.inputStream.bufferedReader().readText())
                .getJSONArray("choices").getJSONObject(0).getJSONObject("message")
                .optString("content").trim().takeIf { it.isNotBlank() }
        } finally { c.disconnect() }
    }
}

/** The instant commands (mirror of fastCommands.ts) that need only a Context. */
internal object NativeFast {
    class Cmd(val say: String, val run: (Context) -> Boolean)

    private val ON = Regex("(\\bon\\b|chalu|chaalu|jala|jalao|\\bkhol|start|चालू|जला|ऑन)", RegexOption.IGNORE_CASE)
    private val OFF = Regex("(\\boff\\b|\\bband\\b|bandh|bujha|बंद|बुझा|ऑफ)", RegexOption.IGNORE_CASE)
    private val UP = Regex("(badha|badhao|zyada|jyada|increase|\\bup\\b|louder|बढ़ा|ज्यादा|ज़्यादा|तेज़|तेज)", RegexOption.IGNORE_CASE)
    private val DOWN = Regex("(\\bkam\\b|ghata|ghatao|decrease|\\bdown\\b|lower|कम|घटा|धीमा|dheema)", RegexOption.IGNORE_CASE)

    fun time(c: Calendar): String {
        val h = c.get(Calendar.HOUR).let { if (it == 0) 12 else it }
        val m = c.get(Calendar.MINUTE)
        return if (m == 0) "अभी $h बज रहे हैं।" else "अभी $h बजकर $m मिनट हुए हैं।"
    }

    fun match(raw: String, now: Calendar): Cmd? {
        val t = raw.trim().trimEnd('?', '!', '.', ',', ' ', '।').lowercase()
        if (t.isEmpty() || t.length > 60) return null
        if (Regex("(kitne baje|time kya|what time|समय क्या|टाइम क्या|कितने बजे)").containsMatchIn(t))
            return Cmd(time(now)) { true }
        if (Regex("(battery|बैटरी)", RegexOption.IGNORE_CASE).containsMatchIn(t))
            return Cmd("") { ctx -> CallAnnouncer.speak(ctx, batterySentence(ctx)); true } // needs the live value
        if (Regex("(torch|flash ?light|फ्लैश ?लाइट|टॉर्च|टोर्च)", RegexOption.IGNORE_CASE).containsMatchIn(t)) {
            val on = when { OFF.containsMatchIn(t) -> false; ON.containsMatchIn(t) -> true; else -> return null }
            return Cmd(if (on) "टॉर्च चालू कर दी।" else "टॉर्च बंद कर दी।") { ctx ->
                val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
                val id = cm.cameraIdList.firstOrNull {
                    cm.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
                }
                if (id == null) false else { cm.setTorchMode(id, on); true }
            }
        }
        if (Regex("(\\bmute\\b|म्यूट)", RegexOption.IGNORE_CASE).containsMatchIn(t))
            return Cmd("म्यूट कर दिया।") { ctx -> audio(ctx).setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0); true }
        if (Regex("(volume|awaaz|awaz|आवाज़|आवाज|वॉल्यूम)", RegexOption.IGNORE_CASE).containsMatchIn(t)) {
            val dir = when { UP.containsMatchIn(t) -> AudioManager.ADJUST_RAISE; DOWN.containsMatchIn(t) -> AudioManager.ADJUST_LOWER; else -> return null }
            return Cmd(if (dir == AudioManager.ADJUST_RAISE) "आवाज़ बढ़ा दी।" else "आवाज़ कम कर दी।") { ctx ->
                repeat(2) { audio(ctx).adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, AudioManager.FLAG_SHOW_UI) }; true
            }
        }
        if (Regex("(vibrate|वाइब्रेट)").containsMatchIn(t))
            return Cmd("फ़ोन वाइब्रेट पर कर दिया।") { ctx -> audio(ctx).ringerMode = AudioManager.RINGER_MODE_VIBRATE; true }
        if (Regex("(music|gaana|gana|song|गाना|गाने|म्यूज़िक|म्यूजिक)").containsMatchIn(t)) {
            val key = when {
                Regex("(next|agla|अगला)").containsMatchIn(t) -> KeyEvent.KEYCODE_MEDIA_NEXT to "अगला गाना।"
                Regex("(previous|pichla|पिछला)").containsMatchIn(t) -> KeyEvent.KEYCODE_MEDIA_PREVIOUS to "पिछला गाना।"
                Regex("(pause|roko|ruk|रोको|रुको)").containsMatchIn(t) -> KeyEvent.KEYCODE_MEDIA_PAUSE to "रोक दिया।"
                Regex("(play|chalao|chala|चलाओ|चला)").containsMatchIn(t) -> KeyEvent.KEYCODE_MEDIA_PLAY to "चला दिया।"
                else -> return null
            }
            return Cmd(key.second) { ctx ->
                val am = audio(ctx)
                am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, key.first))
                am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, key.first)); true
            }
        }
        return openApp(t)
    }

    // Spoken name -> text an installed app's label contains, and how to say it (mirror of fastCommands.ts).
    private val APPS = listOf(
        Regex("^(youtube|you tube|यू ?ट्यूब|युट्यूब|यूट्यूब)$") to ("youtube" to "YouTube"),
        Regex("^(whatsapp|whats app|व्हाट्स ?ऐप|व्हाट्स ?एप|वॉट्स ?ऐप|वाट्स ?ऐप|व्हाट्सअप)$") to ("whatsapp" to "WhatsApp"),
        Regex("^(instagram|insta|इंस्टा ?ग्राम|इंस्टा)$") to ("instagram" to "Instagram"),
        Regex("^(chrome|क्रोम)$") to ("chrome" to "Chrome"),
        Regex("^(camera|कैमरा)$") to ("camera" to "कैमरा"),
        Regex("^(gallery|गैलरी)$") to ("gallery" to "गैलरी"),
        Regex("^(maps|google maps|मैप्स|गूगल मैप्स|नक्शा)$") to ("maps" to "Maps"),
        Regex("^(gmail|जीमेल)$") to ("gmail" to "Gmail"),
        Regex("^(facebook|फेसबुक)$") to ("facebook" to "Facebook"),
        Regex("^(telegram|टेलीग्राम)$") to ("telegram" to "Telegram"),
        Regex("^(spotify|स्पॉटिफाई|स्पोटिफाई)$") to ("spotify" to "Spotify"),
        Regex("^(phonepe|phone pe|फोन ?पे)$") to ("phonepe" to "PhonePe"),
        Regex("^(settings|setting|सेटिंग्स|सेटिंग)$") to ("settings" to "सेटिंग्स"),
        Regex("^(calculator|कैलकुलेटर)$") to ("calculator" to "कैलकुलेटर"),
        Regex("^(play store|प्ले ?स्टोर)$") to ("play store" to "Play Store"),
    )
    private val NOT_APP = Regex("^(it|this|that|ye|yeh|wo|woh|kuch|something|app|website|site|link|google search|search|please|ये|वो|कुछ)$")
    private val OPEN_AFTER = Regex(
        "^(.+?)\\s+(?:kholo|khol do|khol de|kholdo|kholiye|khol|open karo|open kar do|open kar|open|chalao|chalu karo|launch karo|start karo|ओपन करो|ओपन कर दो|ओपन|खोलो|खोल दो|खोल दीजिए|खोलिए|चलाओ|चालू करो)$",
    )
    private val OPEN_BEFORE = Regex("^(?:open|launch|start|run|kholo|khol|ओपन|खोलो)\\s+(.+)$")

    internal fun openApp(t: String): Cmd? {
        val body = t.replace(Regex("\\s+(?:karo|kar do|kardo|please|करो|कर दो)$"), "")
        val spoken = (OPEN_AFTER.find(t) ?: OPEN_BEFORE.find(body))?.groupValues?.get(1) ?: return null
        val s = spoken.replace(Regex("(^|\\s)(?:the|app|my|mera|mere|ऐप|एप)(?=\\s|$)"), " ").replace(Regex("\\s+"), " ").trim()
        if (s.isEmpty() || NOT_APP.matches(s) || s.split(" ").size > 3) return null
        val hit = APPS.firstOrNull { it.first.matches(s) }?.second
            ?: if (Regex("^[a-z0-9][a-z0-9 .&+-]{1,23}$").matches(s) && !Regex("\\.(com|in|org|net)\\b").containsMatchIn(s))
                s to s.replaceFirstChar { it.uppercase() } else return null
        return Cmd("") { ctx ->
            // From the background Android only allows this with "Display over other apps" granted.
            val ok = launchApp(ctx, hit.first)
            CallAnnouncer.speak(ctx, if (ok) "${hit.second} खोल दिया।" else "${hit.second} नहीं मिला।")
            true
        }
    }

    private fun batterySentence(ctx: Context): String {
        val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val st = ctx.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = st?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        return "बैटरी $pct प्रतिशत है" + (if (charging) ", और चार्ज हो रही है।" else "।")
    }

    private fun audio(ctx: Context) = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
}
