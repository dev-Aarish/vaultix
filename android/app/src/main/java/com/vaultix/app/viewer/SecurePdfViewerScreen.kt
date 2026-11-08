package com.vaultix.app.viewer

import android.app.Activity
import android.graphics.Bitmap
import android.view.WindowManager
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.vaultix.app.data.PublicUser
import com.vaultix.app.data.ViewSessionData
import kotlinx.coroutines.delay

@Composable
fun SecurePdfViewerScreen(
    user: PublicUser?,
    sessionData: ViewSessionData,
    documentManager: PdfDocumentManager,
    isLocked: Boolean,
    reauthBusy: Boolean,
    reauthError: String?,
    onLock: () -> Unit,
    onUnlock: (password: String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val activity = context as? Activity
    val lifecycleOwner = LocalLifecycleOwner.current

    // 1. Mandatory WindowManager.LayoutParams.FLAG_SECURE on protected viewing surfaces
    DisposableEffect(activity) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose {
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    // 2. Immediate lock when app moves to background (ON_STOP / ON_PAUSE)
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP || event == Lifecycle.Event.ON_PAUSE) {
                onLock()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    // 3. Inactivity timer
    val timeoutSeconds = sessionData.inactivityTimeoutSeconds.coerceAtLeast(30)
    var lastInteractionTime by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var secondsRemaining by remember { mutableLongStateOf(timeoutSeconds) }

    LaunchedEffect(isLocked, timeoutSeconds) {
        if (!isLocked) {
            while (true) {
                delay(1_000)
                val elapsed = (System.currentTimeMillis() - lastInteractionTime) / 1000
                val remaining = (timeoutSeconds - elapsed).coerceAtLeast(0)
                secondsRemaining = remaining
                if (remaining <= 0) {
                    onLock()
                    break
                }
            }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .pointerInput(isLocked) {
                if (!isLocked) {
                    awaitEachGesture {
                        awaitPointerEvent()
                        lastInteractionTime = System.currentTimeMillis()
                    }
                }
            },
    ) {
        // Document content (only rendered when unlocked)
        if (!isLocked) {
            Column(modifier = Modifier.fillMaxSize()) {
                ViewerTopBar(
                    fileName = sessionData.file.name,
                    pageCount = documentManager.pageCount,
                    secondsRemaining = secondsRemaining,
                    onClose = onClose,
                )

                if (documentManager.pageCount == 0) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        contentPadding = PaddingValues(vertical = 12.dp),
                    ) {
                        items(
                            count = documentManager.pageCount,
                            key = { index -> "pdf_page_$index" },
                        ) { index ->
                            PdfPageCard(
                                pageIndex = index,
                                totalPages = documentManager.pageCount,
                                documentManager = documentManager,
                                sessionData = sessionData,
                            )
                        }
                    }
                }
            }
        }

        // Fullscreen Inactivity Lock Overlay
        if (isLocked) {
            InactivityLockOverlay(
                userEmail = user?.email.orEmpty(),
                userName = user?.name.orEmpty(),
                busy = reauthBusy,
                error = reauthError,
                onUnlock = onUnlock,
                onClose = onClose,
            )
        }
    }
}

@Composable
private fun ViewerTopBar(
    fileName: String,
    pageCount: Int,
    secondsRemaining: Long,
    onClose: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilledTonalButton(
                onClick = onClose,
                shape = RoundedCornerShape(12.dp),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                modifier = Modifier.height(36.dp),
            ) {
                Text("Close", style = MaterialTheme.typography.labelMedium)
            }

            Spacer(Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = fileName,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = if (pageCount > 0) "$pageCount pages • Auto-lock in ${secondsRemaining}s" else "Loading…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.width(8.dp))

            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(100),
            ) {
                Text(
                    text = "PROTECTED",
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.8.sp,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }
    }
}

@Composable
private fun PdfPageCard(
    pageIndex: Int,
    totalPages: Int,
    documentManager: PdfDocumentManager,
    sessionData: ViewSessionData,
) {
    val bitmapState = produceState<Bitmap?>(initialValue = null, pageIndex) {
        value = documentManager.renderPage(pageIndex)
    }
    val bitmap = bitmapState.value

    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(if (bitmap != null) bitmap.width.toFloat() / bitmap.height.toFloat() else 0.707f)
                    .clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = "Page ${pageIndex + 1}",
                        modifier = Modifier.fillMaxSize(),
                    )
                    // Visible, dynamic user-specific watermark overlay
                    DynamicWatermarkOverlay(
                        watermark = sessionData.watermark,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    CircularProgressIndicator(
                        modifier = Modifier.size(32.dp),
                        strokeWidth = 2.5.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            Surface(
                color = Color(0xFFF5F5F5),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Page ${pageIndex + 1} of $totalPages",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF555555),
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = sessionData.watermark.classification,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF777777),
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.5.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun InactivityLockOverlay(
    userEmail: String,
    userName: String,
    busy: Boolean,
    error: String?,
    onUnlock: (String) -> Unit,
    onClose: () -> Unit,
) {
    var password by rememberSaveable { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .imePadding()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Surface(
                modifier = Modifier.size(56.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = "🔒",
                        fontSize = 24.sp,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            Text(
                text = "Document locked",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )

            Spacer(Modifier.height(8.dp))

            Text(
                text = "Viewing paused due to inactivity or app backgrounding. Confirm your account password to resume viewing.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(16.dp))

            Surface(
                color = MaterialTheme.colorScheme.surfaceContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = userName.ifBlank { "Signed in user" },
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = userEmail,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            if (!error.isNullOrBlank()) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(12.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
            }

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Account password") },
                singleLine = true,
                enabled = !busy,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(20.dp))

            Button(
                onClick = { onUnlock(password) },
                enabled = !busy && password.isNotBlank(),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                if (busy) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text("Unlock viewing", fontWeight = FontWeight.SemiBold)
                }
            }

            Spacer(Modifier.height(10.dp))

            FilledTonalButton(
                onClick = onClose,
                enabled = !busy,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text("Close document", fontWeight = FontWeight.Medium)
            }
        }
    }
}
