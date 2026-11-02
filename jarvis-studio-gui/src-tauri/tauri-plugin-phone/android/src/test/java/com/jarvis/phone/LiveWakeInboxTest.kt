package com.jarvis.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LiveWakeInboxTest {
    @Test
    fun handsOutOnce() {
        LiveWakeInbox.request("torch", now = 1_000L)
        assertEquals("torch", LiveWakeInbox.take(now = 2_000L))
        assertNull(LiveWakeInbox.take(now = 2_001L))
    }

    @Test
    fun emptyTextIsStillARequest() {
        LiveWakeInbox.request("", now = 5_000L)
        assertEquals("", LiveWakeInbox.take(now = 5_100L))
    }

    @Test
    fun forgetsAnOldRequest() {
        LiveWakeInbox.request("late", now = 0L)
        assertNull(LiveWakeInbox.take(now = 60_000L))
    }
}
