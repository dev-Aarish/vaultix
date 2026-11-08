package com.vaultix.app.viewer

import android.graphics.Color as AndroidColor
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import com.vaultix.app.data.WatermarkDto
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun DynamicWatermarkOverlay(
    watermark: WatermarkDto,
    modifier: Modifier = Modifier,
) {
    var tickCount by remember { mutableIntStateOf(0) }
    var currentTimestamp by remember {
        mutableStateOf(
            SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date()),
        )
    }

    LaunchedEffect(Unit) {
        val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
        while (true) {
            delay(5_000)
            tickCount = (tickCount + 1) % 1000
            currentTimestamp = dateFormat.format(Date())
        }
    }

    val line1 = watermark.userName.ifBlank { watermark.userEmail }
    val line2 = "${watermark.deviceName} • ${watermark.deviceFingerprint}"
    val line3 = "${watermark.classification} • $currentTimestamp"

    Canvas(modifier = modifier.fillMaxSize()) {
        val width = size.width
        val height = size.height
        if (width <= 0 || height <= 0) return@Canvas

        drawIntoCanvas { canvas ->
            val native = canvas.nativeCanvas
            native.save()

            // Slight dynamic jitter/phase shift based on tickCount
            val phaseShiftX = (tickCount * 4f) % 60f
            val phaseShiftY = (tickCount * 3f) % 50f

            val paint = Paint().apply {
                isAntiAlias = true
                textSize = 28f
                typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                color = AndroidColor.argb(38, 70, 70, 70) // Subtle translucent gray
            }

            // Diagonal angle
            val angleDegrees = -28f
            native.rotate(angleDegrees, width / 2f, height / 2f)

            val stepX = 420f
            val stepY = 220f
            val padding = 300f

            var x = -padding + phaseShiftX
            while (x < width + padding) {
                var y = -padding + phaseShiftY
                while (y < height + padding) {
                    native.drawText(line1, x, y, paint)
                    native.drawText(line2, x, y + 34f, paint)
                    native.drawText(line3, x, y + 68f, paint)
                    y += stepY
                }
                x += stepX
            }

            native.restore()
        }
    }
}
