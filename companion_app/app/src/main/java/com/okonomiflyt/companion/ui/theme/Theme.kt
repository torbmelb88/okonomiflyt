package com.okonomiflyt.companion.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Mirrors the web app: blue-600 actions, gray-50 page on white cards in
// light mode, gray-900 page on gray-800 cards in dark mode. No dynamic
// (Material You) colour — the phone should look like the web app, not like
// the wallpaper.
private val LightColorScheme = lightColorScheme(
    primary = Blue600,
    onPrimary = Color.White,
    primaryContainer = Blue50,
    onPrimaryContainer = Blue800,
    secondary = Gray600,
    onSecondary = Color.White,
    secondaryContainer = Gray100,
    onSecondaryContainer = Gray900,
    tertiary = Purple600,
    background = Gray50,
    onBackground = Gray900,
    surface = Color.White,
    onSurface = Gray900,
    surfaceVariant = Gray100,
    onSurfaceVariant = Gray500,
    surfaceContainerHighest = Gray100,
    surfaceContainer = Color.White,
    outline = Gray300,
    outlineVariant = Gray200,
    error = Red600,
    onError = Color.White,
    errorContainer = Red50,
    onErrorContainer = Red600,
)

private val DarkColorScheme = darkColorScheme(
    primary = Blue600,
    onPrimary = Color.White,
    primaryContainer = BlueDarkContainer,
    onPrimaryContainer = Blue300,
    secondary = Gray400,
    onSecondary = Gray900,
    secondaryContainer = Gray700,
    onSecondaryContainer = Gray100,
    tertiary = Purple300,
    background = Gray900,
    onBackground = Gray100,
    surface = Gray800,
    onSurface = Gray100,
    surfaceVariant = Gray700,
    onSurfaceVariant = Gray400,
    surfaceContainerHighest = Gray700,
    surfaceContainer = Gray800,
    outline = Gray600,
    outlineVariant = Gray700,
    error = Red300,
    onError = Gray900,
    errorContainer = RedDarkContainer,
    onErrorContainer = Red300,
)

@Composable
fun OkonomiFlytCompanionTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
        typography = Typography,
        content = content
    )
}
