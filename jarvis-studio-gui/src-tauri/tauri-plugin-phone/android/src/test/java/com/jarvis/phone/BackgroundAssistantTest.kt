package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar

class BackgroundAssistantTest {
    @Test fun stripsWakePhrase() {
        assertEquals("torch chalu karo", BackgroundAssistant.stripWake("Hey Jarvis, torch chalu karo"))
        assertEquals("टॉर्च चालू करो", BackgroundAssistant.stripWake("हे जार्विस टॉर्च चालू करो"))
    }

    @Test fun noWakePhraseMeansFalseWake() {
        assertNull(BackgroundAssistant.stripWake("torch chalu karo please"))
        assertNull(BackgroundAssistant.stripWake("kal main bata raha tha ki jarvis bahut accha hai"))
    }

    @Test fun instantCommands() {
        val now = Calendar.getInstance()
        assertNotNull(NativeFast.match("torch on karo", now))
        assertNotNull(NativeFast.match("volume badhao", now))
        assertNotNull(NativeFast.match("battery kitni hai", now))
        assertNull(NativeFast.match("flashlight", now))
        assertNotNull(NativeFast.match("youtube kholo", now))
        assertNotNull(NativeFast.match("यूट्यूब खोलो", now))
        assertNull(NativeFast.match("website kholo", now))
        assertNull(NativeFast.match("kal subah volume badha dena aur mujhe yaad dilana ki mummy ko call karna hai", now))
    }

    @Test fun timeSentence() {
        val c = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 15); set(Calendar.MINUTE, 5) }
        assertEquals("अभी 3 बजकर 5 मिनट हुए हैं।", NativeFast.time(c))
    }
}
