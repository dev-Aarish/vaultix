package com.vaultix.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vaultix.app.data.DeviceDto
import com.vaultix.app.viewer.SecurePdfViewerScreen
import kotlinx.coroutines.delay

@Composable
fun VaultixApp(viewModel: VaultixViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(state.stage) {
        if (state.stage == Stage.DEVICE_PENDING) {
            while (true) {
                delay(5_000)
                viewModel.refreshStatus()
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        CompositionLocalProvider(
            LocalContentColor provides MaterialTheme.colorScheme.onBackground,
        ) {
            when (state.stage) {
                Stage.LOADING -> LoadingScreen()
                Stage.LOGIN -> LoginScreen(
                    state = state,
                    onLogin = viewModel::login,
                    onShowRegister = viewModel::showRegister,
                )
                Stage.REGISTER -> RegisterScreen(
                    state = state,
                    onRegister = viewModel::register,
                    onShowLogin = viewModel::showLogin,
                )
                Stage.DEVICE_SETUP -> DeviceSetupScreen(
                    state = state,
                    onRegisterDevice = viewModel::registerDevice,
                    onLogout = viewModel::logout,
                )
                Stage.DEVICE_PENDING -> DevicePendingScreen(
                    state = state,
                    onRefresh = viewModel::refreshStatus,
                    onLogout = viewModel::logout,
                )
                Stage.DEVICE_ACTIVATING -> DeviceActivatingScreen(
                    state = state,
                    onLogout = viewModel::logout,
                )
                Stage.HOME -> HomeScreen(
                    state = state,
                    onLogout = viewModel::logout,
                    onOpenFolder = viewModel::openFolder,
                    onOpenFile = viewModel::openFile,
                    onViewSecurely = viewModel::openSecureViewer,
                    onGoUp = viewModel::goUp,
                    onRefresh = viewModel::refreshFiles,
                    onClearError = viewModel::clearError,
                    onDismissFile = viewModel::dismissFile,
                )
                Stage.VIEWING_DOCUMENT -> {
                    state.viewSession?.let { sessionData ->
                        SecurePdfViewerScreen(
                            user = state.user,
                            sessionData = sessionData,
                            documentManager = viewModel.documentManager,
                            isLocked = state.viewerLocked,
                            reauthBusy = state.reauthBusy,
                            reauthError = state.reauthError,
                            onLock = viewModel::lockViewer,
                            onUnlock = viewModel::unlockViewer,
                            onClose = viewModel::closeSecureViewer,
                        )
                    } ?: LoadingScreen()
                }
                Stage.DEVICE_REVOKED -> DeviceRevokedScreen(
                    state = state,
                    onLogout = viewModel::logout,
                )
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun LoginScreen(
    state: AppUiState,
    onLogin: (String, String) -> Unit,
    onShowRegister: () -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    AuthScaffold(
        title = "Sign in",
        subtitle = "Access is limited to approved accounts and registered devices.",
    ) {
        MessageBanner(state.error, state.info)
        Field(
            value = email,
            onValueChange = { email = it },
            label = "Email",
            keyboardType = KeyboardType.Email,
            enabled = !state.busy,
        )
        Field(
            value = password,
            onValueChange = { password = it },
            label = "Password",
            keyboardType = KeyboardType.Password,
            isPassword = true,
            enabled = !state.busy,
        )
        Spacer(Modifier.height(4.dp))
        Button(
            onClick = { onLogin(email, password) },
            enabled = !state.busy && email.isNotBlank() && password.isNotBlank(),
            shape = ButtonDefaults.shape,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(
                    "Sign in",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        FilledTonalButton(
            onClick = onShowRegister,
            enabled = !state.busy,
            shape = ButtonDefaults.shape,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            Text(
                "I have an invitation",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun RegisterScreen(
    state: AppUiState,
    onRegister: (String, String, String) -> Unit,
    onShowLogin: () -> Unit,
) {
    var token by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    AuthScaffold(
        title = "Create account",
        subtitle = "Registration requires a one-time invitation from an administrator.",
    ) {
        MessageBanner(state.error, state.info)
        Field(
            value = token,
            onValueChange = { token = it },
            label = "Invitation token",
            enabled = !state.busy,
        )
        Field(
            value = name,
            onValueChange = { name = it },
            label = "Full name",
            enabled = !state.busy,
        )
        Field(
            value = password,
            onValueChange = { password = it },
            label = "Password (12+ characters)",
            keyboardType = KeyboardType.Password,
            isPassword = true,
            enabled = !state.busy,
        )
        Spacer(Modifier.height(4.dp))
        Button(
            onClick = { onRegister(token, name, password) },
            enabled = !state.busy &&
                token.isNotBlank() &&
                name.isNotBlank() &&
                password.length >= 12,
            shape = ButtonDefaults.shape,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(
                    "Create account",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        FilledTonalButton(
            onClick = onShowLogin,
            enabled = !state.busy,
            shape = ButtonDefaults.shape,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            Text(
                "Back to sign in",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun DeviceSetupScreen(
    state: AppUiState,
    onRegisterDevice: () -> Unit,
    onLogout: () -> Unit,
) {
    AuthScaffold(
        title = "Register this device",
        subtitle = "Vaultix links your account to a hardware-backed key stored on this phone. An administrator must approve it before use.",
    ) {
        MessageBanner(state.error, state.info)
        Button(
            onClick = onRegisterDevice,
            enabled = !state.busy,
            shape = ButtonDefaults.shape,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(
                    "Register this device",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        FilledTonalButton(
            onClick = onLogout,
            enabled = !state.busy,
            shape = ButtonDefaults.shape,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            Text(
                "Sign out",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun DevicePendingScreen(
    state: AppUiState,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
) {
    ScreenFrame {
        BrandMark()
        Spacer(Modifier.height(28.dp))
        StatusPill(
            label = "PENDING APPROVAL",
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "Waiting for approval",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "An administrator needs to review and approve this device. This screen checks automatically every few seconds.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(20.dp))
        MessageBanner(state.error, state.info)
        DeviceCard(state.devices.firstOrNull(), bound = false)
        Spacer(Modifier.height(20.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                onClick = onRefresh,
                enabled = !state.busy,
                shape = ButtonDefaults.shape,
                modifier = Modifier
                    .weight(1f)
                    .height(48.dp),
            ) {
                Text(
                    "Check status",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                )
            }
            FilledTonalButton(
                onClick = onLogout,
                enabled = !state.busy,
                shape = ButtonDefaults.shape,
                modifier = Modifier.height(48.dp),
            ) {
                Text(
                    "Sign out",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun DeviceActivatingScreen(state: AppUiState, onLogout: () -> Unit) {
    ScreenFrame {
        BrandMark()
        Spacer(Modifier.height(32.dp))
        CircularProgressIndicator(
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(48.dp),
            strokeWidth = 3.dp,
        )
        Spacer(Modifier.height(20.dp))
        Text(
            "Activating secure session",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Signing a fresh challenge with this device's key.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
        if (state.error != null) {
            Spacer(Modifier.height(16.dp))
            MessageBanner(state.error, state.info)
        }
        Spacer(Modifier.height(24.dp))
        FilledTonalButton(
            onClick = onLogout,
            enabled = !state.busy,
            shape = ButtonDefaults.shape,
            modifier = Modifier.height(48.dp),
        ) {
            Text(
                "Sign out",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun HomeScreen(
    state: AppUiState,
    onLogout: () -> Unit,
    onOpenFolder: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onViewSecurely: (String) -> Unit,
    onGoUp: () -> Unit,
    onRefresh: () -> Unit,
    onClearError: () -> Unit,
    onDismissFile: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(horizontal = 20.dp, vertical = 20.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark()
            FilledTonalButton(
                onClick = onLogout,
                enabled = !state.busy,
                shape = ButtonDefaults.shape,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text(
                    "Sign out",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
        Spacer(Modifier.height(22.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Shared files",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.weight(1f))
            if (state.user?.role == "ADMIN") {
                StatusPill(
                    label = "ADMIN",
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                    contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text = buildString {
                append("Signed in as ")
                append(state.user?.name.orEmpty())
                append(" · ")
                append(state.boundDevice?.deviceName ?: "Approved device")
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(14.dp))
        FileBrowserContent(
            state = state,
            onOpenFolder = onOpenFolder,
            onOpenFile = onOpenFile,
            onGoUp = onGoUp,
            onRefresh = onRefresh,
            onClearError = onClearError,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        )
    }

    state.selectedFile?.let { metadata ->
        FileDetailsDialog(
            metadata = metadata,
            busy = state.busy,
            onViewSecurely = onViewSecurely,
            onDismiss = onDismissFile,
        )
    }
}

@Composable
private fun DeviceRevokedScreen(state: AppUiState, onLogout: () -> Unit) {
    ScreenFrame {
        BrandMark()
        Spacer(Modifier.height(28.dp))
        StatusPill(
            label = "REVOKED",
            containerColor = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "Device access revoked",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "An administrator revoked this device. Sign in on a new device or contact your administrator.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(20.dp))
        DeviceCard(state.devices.firstOrNull(), bound = false)
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onLogout,
            enabled = !state.busy,
            shape = ButtonDefaults.shape,
            modifier = Modifier
                .fillMaxWidth()
                .height(50.dp),
        ) {
            Text(
                "Sign out",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun AuthScaffold(
    title: String,
    subtitle: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    ScreenFrame {
        BrandMark()
        Spacer(Modifier.height(32.dp))
        Text(
            title,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            subtitle,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(24.dp))
        content()
    }
}

@Composable
private fun ScreenFrame(content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .padding(horizontal = 24.dp, vertical = 32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 440.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            content = content,
        )
    }
}

@Composable
private fun BrandMark() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            modifier = Modifier.size(42.dp),
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.primaryContainer,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    "V",
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleLarge,
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Text(
            "Vaultix",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
    }
}

@Composable
private fun Field(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    isPassword: Boolean = false,
    enabled: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        enabled = enabled,
        visualTransformation = if (isPassword) {
            PasswordVisualTransformation()
        } else {
            VisualTransformation.None
        },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        shape = RoundedCornerShape(16.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            focusedLabelColor = MaterialTheme.colorScheme.primary,
            unfocusedLabelColor = MaterialTheme.colorScheme.onSurfaceVariant,
            cursorColor = MaterialTheme.colorScheme.primary,
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLowest,
            focusedTextColor = MaterialTheme.colorScheme.onSurface,
            unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(14.dp))
}

@Composable
private fun MessageBanner(error: String?, info: String?) {
    val message = error ?: info ?: return
    val isError = error != null
    val containerColor = if (isError) {
        MaterialTheme.colorScheme.errorContainer
    } else {
        MaterialTheme.colorScheme.secondaryContainer
    }
    val contentColor = if (isError) {
        MaterialTheme.colorScheme.onErrorContainer
    } else {
        MaterialTheme.colorScheme.onSecondaryContainer
    }

    Surface(
        color = containerColor,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = message,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            color = contentColor,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    Spacer(Modifier.height(16.dp))
}

@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(24.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), content = content)
    }
}

@Composable
private fun DeviceCard(device: DeviceDto?, bound: Boolean) {
    if (device == null) return
    Panel {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    device.deviceName.ifBlank { "Android device" },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    shortFingerprint(device.keyFingerprint),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(12.dp))
            val approved = device.status == "APPROVED"
            val (containerColor, contentColor) = if (approved || bound) {
                MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer
            } else {
                MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
            }
            StatusPill(
                label = if (bound) "BOUND" else device.status,
                containerColor = containerColor,
                contentColor = contentColor,
            )
        }
    }
}

@Composable
private fun StatusPill(
    label: String,
    containerColor: Color,
    contentColor: Color,
) {
    Surface(
        color = containerColor,
        shape = RoundedCornerShape(100),
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
            color = contentColor,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.8.sp,
        )
    }
}

private fun shortFingerprint(value: String): String =
    if (value.length <= 28) value else value.take(28) + "…"
