package com.jarvis.phone

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/**
 * Lets FRIDAY be picked under Settings > Apps > Default apps > Digital assistant app. Once it is,
 * the phone's assistant triggers (side-key long press, headset button, corner-swipe gesture)
 * open a session here, which starts a command recording on FRIDAY's own wake engine.
 * Nothing is recorded or sent by these classes: the recording is the wake engine's, as for
 * "Hey Jarvis". The three classes are the minimum Android asks of an assistant.
 */
class FridayInteractionService : VoiceInteractionService()

class FridaySessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = FridaySession(this)
}

class FridaySession(ctx: Context) : VoiceInteractionSession(ctx) {
    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        try {
            if (!WakeWordService.manualWake()) {
                // The engine isn't running (wake word off, or the app was closed): open the app,
                // and the press is picked up once the engine starts.
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                if (launch != null) {
                    launch.action = Intent.ACTION_ASSIST
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    context.startActivity(launch)
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("JarvisWW", "assist press failed: ${e.message}")
        }
        hide()
    }
}

/** Required by the assistant declaration; FRIDAY does its own speech recognition. */
class FridayRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent?, listener: RecognitionService.Callback?) {
        try {
            listener?.error(SpeechRecognizer.ERROR_CLIENT)
        } catch (_: Exception) {
        }
    }

    override fun onCancel(listener: RecognitionService.Callback?) {}

    override fun onStopListening(listener: RecognitionService.Callback?) {}
}
