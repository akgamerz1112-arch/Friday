package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CallAnnouncerTest {
    @Test fun namedCaller() =
        assertEquals("सर, Rahul का कॉल आ रहा है।", CallAnnouncer.sentence("Rahul", ""))

    @Test fun numberIsNotReadOut() =
        assertEquals("सर, एक अनजान नंबर से कॉल आ रहा है।", CallAnnouncer.sentence("+91 98765 43210", ""))

    @Test fun otherAppIsNamed() =
        assertEquals("सर, WhatsApp पर Papa का कॉल आ रहा है।", CallAnnouncer.sentence("Papa", "WhatsApp"))

    @Test fun numberDetection() {
        assertTrue(CallAnnouncer.looksLikeNumber("(022) 555-0100"))
        assertFalse(CallAnnouncer.looksLikeNumber("Dr. Rahul 2"))
    }
}
