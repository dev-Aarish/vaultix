package com.vaultix.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vaultix.app.data.DeviceDto
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

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        MaterialTheme.colorScheme.background,
                        Color(0xFF0B121A),
                        MaterialTheme.colorScheme.background,
                    ),
                ),
            ),
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
                Stage.HOME -> HomeScreen(state = state, onLogout = viewModel::logout)
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
        CircularProgressIndicator()
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
        Button(
            onClick = { onLogin(email, password) },
            enabled = !state.busy && email.isNotBlank() && password.isNotBlank(),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text("Sign in")
            }
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onShowRegister, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
            Text("I have an invitation")
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
        Button(
            onClick = { onRegister(token, name, password) },
            enabled = !state.busy &&
                token.isNotBlank() &&
                name.isNotBlank() &&
                password.length >= 12,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text("Create account")
            }
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onShowLogin, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
            Text("Back to sign in")
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
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            if (state.busy) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text("Register this device")
            }
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onLogout, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
            Text("Sign out")
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
        Spacer(Modifier.height(24.dp))
        StatusPill("PENDING APPROVAL", MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(14.dp))
        Text(
            "This device is waiting for approval",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "An administrator needs to review and approve this device. This screen checks automatically every few seconds.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        MessageBanner(state.error, state.info)
        DeviceCard(state.devices.firstOrNull(), bound = false)
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Button(
                onClick = onRefresh,
                enabled = !state.busy,
                shape = RoundedCornerShape(14.dp),
            ) {
                Text("Check status")
            }
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = onLogout, enabled = !state.busy) {
                Text("Sign out")
            }
        }
    }
}

@Composable
private fun DeviceActivatingScreen(state: AppUiState, onLogout: () -> Unit) {
    ScreenFrame {
        BrandMark()
        Spacer(Modifier.height(28.dp))
        CircularProgressIndicator()
        Spacer(Modifier.height(18.dp))
        Text(
            "Activating secure session",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Signing a fresh challenge with this device's key.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (state.error != null) {
            Spacer(Modifier.height(16.dp))
            MessageBanner(state.error, state.info)
        }
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = onLogout, enabled = !state.busy) {
            Text("Sign out")
        }
    }
}

@Composable
private fun HomeScreen(state: AppUiState, onLogout: () -> Unit) {
    ScreenFrame {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark()
            TextButton(onClick = onLogout, enabled = !state.busy) {
                Text("Sign out")
            }
        }
        Spacer(Modifier.height(28.dp))
        StatusPill("SECURE SESSION", MaterialTheme.colorScheme.secondary)
        Spacer(Modifier.height(14.dp))
        Text(
            "You're signed in",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Your account and this device are verified. File sharing arrives in the next phase.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        Panel {
            Text(
                "Account",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                state.user?.name.orEmpty(),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                state.user?.email.orEmpty(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (state.user?.role == "ADMIN") {
                Spacer(Modifier.height(10.dp))
                StatusPill("ADMIN", MaterialTheme.colorScheme.primary)
            }
        }
        Spacer(Modifier.height(12.dp))
        DeviceCard(state.boundDevice, bound = true)
    }
}

@Composable
private fun DeviceRevokedScreen(state: AppUiState, onLogout: () -> Unit) {
    ScreenFrame {
        BrandMark()
        Spacer(Modifier.height(24.dp))
        StatusPill("REVOKED", MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(14.dp))
        Text(
            "Device access revoked",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "An administrator revoked this device. Sign in on a new device or contact your administrator.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        DeviceCard(state.devices.firstOrNull(), bound = false)
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = onLogout,
            enabled = !state.busy,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Text("Sign out")
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
        Spacer(Modifier.height(28.dp))
        Text(
            title,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    Brush.linearGradient(
                        listOf(Color(0xFF4F9DFF), Color(0xFF3DDC97)),
                    ),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "V",
                color = Color(0xFF04101F),
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.titleLarge,
            )
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
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(12.dp))
}

@Composable
private fun MessageBanner(error: String?, info: String?) {
    val message = error ?: info ?: return
    val isError = error != null
    Surface(
        color = if (isError) Color(0xFF2A1215) else Color(0xFF10231B),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = message,
            modifier = Modifier.padding(14.dp),
            color = if (isError) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.secondary
            },
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    Spacer(Modifier.height(14.dp))
}

@Composable
private fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
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
            StatusPill(
                label = if (bound) "BOUND" else device.status,
                color = if (approved || bound) {
                    MaterialTheme.colorScheme.secondary
                } else {
                    MaterialTheme.colorScheme.primary
                },
            )
        }
    }
}

@Composable
private fun StatusPill(label: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.16f),
        shape = RoundedCornerShape(50),
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            color = color,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

private fun shortFingerprint(value: String): String =
    if (value.length <= 28) value else value.take(28) + "…"
