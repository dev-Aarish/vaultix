package com.vaultix.app.viewer

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class PdfDocumentManager {
    private var parcelFileDescriptor: ParcelFileDescriptor? = null
    private var renderer: PdfRenderer? = null
    private var file: File? = null
    private val pageBitmaps = mutableMapOf<Int, Bitmap>()
    private val lock = Any()

    val pageCount: Int
        get() = synchronized(lock) { renderer?.pageCount ?: 0 }

    val isOpen: Boolean
        get() = synchronized(lock) { renderer != null }

    fun open(pdfFile: File) {
        synchronized(lock) {
            close()
            file = pdfFile
            val pfd = ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY)
            parcelFileDescriptor = pfd
            renderer = PdfRenderer(pfd)
        }
    }

    suspend fun renderPage(pageIndex: Int, targetWidthPx: Int = 1200): Bitmap? = withContext(Dispatchers.Default) {
        synchronized(lock) {
            val r = renderer ?: return@withContext null
            if (pageIndex < 0 || pageIndex >= r.pageCount) return@withContext null

            pageBitmaps[pageIndex]?.let {
                if (!it.isRecycled) return@withContext it
            }

            var page: PdfRenderer.Page? = null
            try {
                page = r.openPage(pageIndex)
                val pageWidth = page.width
                val pageHeight = page.height

                val scale = if (targetWidthPx > 0 && pageWidth > 0) {
                    targetWidthPx.toFloat() / pageWidth.toFloat()
                } else {
                    2.0f
                }
                val destWidth = (pageWidth * scale).toInt().coerceAtLeast(1)
                val destHeight = (pageHeight * scale).toInt().coerceAtLeast(1)

                val bitmap = Bitmap.createBitmap(destWidth, destHeight, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                canvas.drawColor(Color.WHITE)

                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                pageBitmaps[pageIndex] = bitmap
                bitmap
            } catch (_: Exception) {
                null
            } finally {
                try {
                    page?.close()
                } catch (_: Exception) {}
            }
        }
    }

    fun close() {
        synchronized(lock) {
            pageBitmaps.values.forEach { bitmap ->
                if (!bitmap.isRecycled) {
                    bitmap.recycle()
                }
            }
            pageBitmaps.clear()

            try {
                renderer?.close()
            } catch (_: Exception) {}
            renderer = null

            try {
                parcelFileDescriptor?.close()
            } catch (_: Exception) {}
            parcelFileDescriptor = null

            file?.let { wipeFile(it) }
            file = null
        }
    }

    private fun wipeFile(f: File) {
        if (!f.exists()) return
        runCatching {
            val length = f.length()
            if (length > 0) {
                f.outputStream().use { out ->
                    val zeroBuf = ByteArray(8192)
                    var remaining = length
                    while (remaining > 0) {
                        val toWrite = minOf(remaining, zeroBuf.size.toLong()).toInt()
                        out.write(zeroBuf, 0, toWrite)
                        remaining -= toWrite
                    }
                    out.flush()
                }
            }
            f.delete()
        }
    }
}
