package com.vaultix.app.security

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import java.io.File

data class SecurityAssessment(
    val isRooted: Boolean,
    val isDebuggable: Boolean,
    val attestationStatus: String,
    val warnings: List<String>,
)

object DeviceSecurityChecker {
    private val ROOT_PATHS = arrayOf(
        "/system/app/Superuser.apk",
        "/sbin/su",
        "/system/bin/su",
        "/system/xbin/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/system/sd/xbin/su",
        "/system/bin/failsafe/su",
        "/data/local/su",
        "/su/bin/su",
    )

    fun assessSecurity(context: Context): SecurityAssessment {
        val warnings = mutableListOf<String>()
        var rooted = false

        // 1. Check for test-keys ROM
        val buildTags = Build.TAGS
        if (buildTags != null && buildTags.contains("test-keys")) {
            rooted = true
            warnings.add("OS image signed with unofficial test-keys (potential custom ROM)")
        }

        // 2. Check for root binaries
        for (path in ROOT_PATHS) {
            try {
                if (File(path).exists()) {
                    rooted = true
                    warnings.add("Root binary detected ($path)")
                    break
                }
            } catch (_: Exception) {}
        }

        // 3. Check su binary execution
        if (!rooted) {
            try {
                val process = Runtime.getRuntime().exec(arrayOf("/system/xbin/which", "su"))
                val exitCode = process.waitFor()
                if (exitCode == 0) {
                    rooted = true
                    warnings.add("Executable su binary located in system path")
                }
            } catch (_: Exception) {}
        }

        // 4. Check debuggable app flag
        val isDebuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (isDebuggable) {
            warnings.add("Application running in debuggable mode")
        }

        val attestationStatus = when {
            rooted -> "FAILED"
            isDebuggable -> "UNVERIFIED"
            else -> "VERIFIED"
        }

        return SecurityAssessment(
            isRooted = rooted,
            isDebuggable = isDebuggable,
            attestationStatus = attestationStatus,
            warnings = warnings,
        )
    }
}
