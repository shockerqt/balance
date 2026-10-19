package expo.modules.balancedailylog

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Shapes
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.json.JSONObject

@Composable internal fun WireframeTheme(colors: JSONObject, content: @Composable () -> Unit) {
  fun read(key: String, fallback: Long): Color = runCatching { Color(android.graphics.Color.parseColor(colors.getString(key))) }.getOrDefault(Color(fallback))
  val background = read("background", 0xFF101820)
  val surface = read("surface", 0xFF19232C)
  val raised = read("surfaceRaised", 0xFF23333F)
  val text = read("text", 0xFFEDF3F5)
  val muted = read("textSecondary", 0xFFA8BAC4)
  val border = read("border", 0xFF36444F)
  val accent = read("primary", 0xFF86B8D3)
  val onAccent = read("onPrimary", 0xFF102531)
  val error = read("danger", 0xFFF1A5A0)
  MaterialTheme(colorScheme = darkColorScheme(
    primary = accent, onPrimary = onAccent, primaryContainer = raised, onPrimaryContainer = accent,
    secondary = muted, onSecondary = background, secondaryContainer = raised, onSecondaryContainer = text,
    tertiary = muted, onTertiary = background, tertiaryContainer = raised, onTertiaryContainer = text,
    background = background, onBackground = text, surface = surface, onSurface = text,
    surfaceVariant = raised, onSurfaceVariant = muted, surfaceTint = Color.Transparent,
    outline = Color(0xFF647986), outlineVariant = border, error = error, onError = background,
    errorContainer = Color(0xFF3B2425), onErrorContainer = error,
    inverseSurface = text, inverseOnSurface = background, inversePrimary = raised,
    surfaceDim = background, surfaceBright = raised, surfaceContainerLowest = background,
    surfaceContainerLow = surface, surfaceContainer = raised, surfaceContainerHigh = raised,
    surfaceContainerHighest = border
  ), shapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp), small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp)
  ), content = content)
}
