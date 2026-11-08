package com.vaultix.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Calm, minimal Stock Android (Material 3) Dark Palette
// Soft Cerulean/Periwinkle primary with calming botanical Sage secondary
private val SlateBluePrimary = Color(0xFFA8C7FA)
private val OnSlateBluePrimary = Color(0xFF0B305B)
private val SlateBluePrimaryContainer = Color(0xFF1E3A5F)
private val OnSlateBluePrimaryContainer = Color(0xFFD2E3FC)

private val SageSecondary = Color(0xFFA8D0BE)
private val OnSageSecondary = Color(0xFF143729)
private val SageSecondaryContainer = Color(0xFF244337)
private val OnSageSecondaryContainer = Color(0xFFC7EBDC)

private val SandTertiary = Color(0xFFD7C3B0)
private val OnSandTertiary = Color(0xFF3B2E21)
private val SandTertiaryContainer = Color(0xFF534436)
private val OnSandTertiaryContainer = Color(0xFFF4DFCC)

// Pure calm dark neutrals (no purplish/blue tint)
private val DarkBackground = Color(0xFF121417)
private val DarkOnBackground = Color(0xFFE2E4E9)
private val DarkSurface = Color(0xFF121417)
private val DarkOnSurface = Color(0xFFE2E4E9)

private val DarkSurfaceVariant = Color(0xFF262930)
private val DarkOnSurfaceVariant = Color(0xFF9DA2AC)

private val DarkSurfaceContainerLowest = Color(0xFF0D0F12)
private val DarkSurfaceContainerLow = Color(0xFF181B1F)
private val DarkSurfaceContainer = Color(0xFF1D2025)
private val DarkSurfaceContainerHigh = Color(0xFF282B31)
private val DarkSurfaceContainerHighest = Color(0xFF33363D)

private val DarkOutline = Color(0xFF434750)
private val DarkOutlineVariant = Color(0xFF2A2D35)

// Calm coral error (soft and muted, not aggressive red)
private val CoralError = Color(0xFFF2B8B5)
private val OnCoralError = Color(0xFF601410)
private val CoralErrorContainer = Color(0xFF3D1615)
private val OnCoralErrorContainer = Color(0xFFF9DEDC)

val VaultixDarkColorScheme = darkColorScheme(
    primary = SlateBluePrimary,
    onPrimary = OnSlateBluePrimary,
    primaryContainer = SlateBluePrimaryContainer,
    onPrimaryContainer = OnSlateBluePrimaryContainer,

    secondary = SageSecondary,
    onSecondary = OnSageSecondary,
    secondaryContainer = SageSecondaryContainer,
    onSecondaryContainer = OnSageSecondaryContainer,

    tertiary = SandTertiary,
    onTertiary = OnSandTertiary,
    tertiaryContainer = SandTertiaryContainer,
    onTertiaryContainer = OnSandTertiaryContainer,

    background = DarkBackground,
    onBackground = DarkOnBackground,

    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,

    surfaceContainerLowest = DarkSurfaceContainerLowest,
    surfaceContainerLow = DarkSurfaceContainerLow,
    surfaceContainer = DarkSurfaceContainer,
    surfaceContainerHigh = DarkSurfaceContainerHigh,
    surfaceContainerHighest = DarkSurfaceContainerHighest,

    outline = DarkOutline,
    outlineVariant = DarkOutlineVariant,

    error = CoralError,
    onError = OnCoralError,
    errorContainer = CoralErrorContainer,
    onErrorContainer = OnCoralErrorContainer,
)

@Composable
fun VaultixTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = VaultixDarkColorScheme,
        typography = Typography(),
        content = content,
    )
}
