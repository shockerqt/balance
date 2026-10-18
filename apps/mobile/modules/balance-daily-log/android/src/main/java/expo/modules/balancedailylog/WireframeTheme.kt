package expo.modules.balancedailylog

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import org.json.JSONObject

@Composable internal fun WireframeTheme(colors: JSONObject, content: @Composable () -> Unit) {
  fun read(key: String, fallback: Long): Color = runCatching { Color(android.graphics.Color.parseColor(colors.getString(key))) }.getOrDefault(Color(fallback))
  val background = read("background", 0xFF111315)
  val surface = read("surface", 0xFF1B1E22)
  val raised = read("surfaceRaised", 0xFF272B30)
  val text = read("text", 0xFFEEF0F2)
  val muted = read("textSecondary", 0xFFA9AFB6)
  val border = read("border", 0xFF3A4047)
  val error = read("danger", 0xFFF1A5A0)
  MaterialTheme(colorScheme = darkColorScheme(
    primary = text, onPrimary = background, primaryContainer = raised, onPrimaryContainer = text,
    secondary = muted, onSecondary = background, secondaryContainer = raised, onSecondaryContainer = text,
    tertiary = muted, onTertiary = background, tertiaryContainer = raised, onTertiaryContainer = text,
    background = background, onBackground = text, surface = surface, onSurface = text,
    surfaceVariant = raised, onSurfaceVariant = muted, surfaceTint = Color.Transparent,
    outline = muted, outlineVariant = border, error = error, onError = background,
    errorContainer = Color(0xFF3B2425), onErrorContainer = error,
    inverseSurface = text, inverseOnSurface = background, inversePrimary = raised,
    surfaceDim = background, surfaceBright = raised, surfaceContainerLowest = background,
    surfaceContainerLow = surface, surfaceContainer = raised, surfaceContainerHigh = raised,
    surfaceContainerHighest = border
  ), content = content)
}
