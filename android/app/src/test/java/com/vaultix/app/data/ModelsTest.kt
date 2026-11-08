package com.vaultix.app.data

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class ModelsTest {
    @Test
    fun testOpenViewSessionResponseDeserialization() {
        val json = """
            {
              "data": {
                "viewSessionId": "123e4567-e89b-12d3-a456-426614174000",
                "file": {
                  "id": "file-123",
                  "name": "quarterly-report.pdf",
                  "mimeType": "application/pdf",
                  "sizeBytes": 204800
                },
                "watermark": {
                  "userName": "Alice Smith",
                  "userEmail": "alice@example.com",
                  "deviceName": "Pixel 8",
                  "deviceFingerprint": "abcd1234efgh5678",
                  "classification": "CONFIDENTIAL • RESTRICTED",
                  "timestamp": "2026-11-08T11:00:00Z"
                },
                "inactivityTimeoutSeconds": 60
              }
            }
        """.trimIndent()

        val parsed = Gson().fromJson(json, OpenViewSessionResponse::class.java)
        assertNotNull(parsed.data)
        assertEquals("123e4567-e89b-12d3-a456-426614174000", parsed.data.viewSessionId)
        assertEquals("quarterly-report.pdf", parsed.data.file.name)
        assertEquals("application/pdf", parsed.data.file.mimeType)
        assertEquals(204800L, parsed.data.file.sizeBytes)
        assertEquals("Alice Smith", parsed.data.watermark.userName)
        assertEquals("alice@example.com", parsed.data.watermark.userEmail)
        assertEquals("Pixel 8", parsed.data.watermark.deviceName)
        assertEquals("abcd1234efgh5678", parsed.data.watermark.deviceFingerprint)
        assertEquals("CONFIDENTIAL • RESTRICTED", parsed.data.watermark.classification)
        assertEquals(60L, parsed.data.inactivityTimeoutSeconds)
    }
}
