package expo.modules.balancedailylog

import android.content.Context
import android.os.Build
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.LinearGradientShader
import kotlin.math.*
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

internal data class OrganicGradients(val header: Brush, val action: Brush)
internal val LocalOrganicGradients = staticCompositionLocalOf { OrganicGradients(Brush.linearGradient(listOf(Color.Transparent, Color.Transparent)), Brush.linearGradient(listOf(Color.Transparent, Color.Transparent))) }

/** Read-only Android palette, resolved once by the existing JS theme authority. */
internal fun systemThemeColors(context: Context, dark: Boolean): Map<String, String>? {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
  val c = if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
  fun hex(color: Color) = String.format("#%06X", color.toArgb() and 0xFFFFFF)
  return mapOf("background" to hex(c.background), "surface" to hex(c.surfaceContainerLow),
    "surfaceRaised" to hex(c.surfaceContainer), "text" to hex(c.onSurface),
    "textSecondary" to hex(c.onSurfaceVariant), "outline" to hex(c.outline),
    "primary" to hex(c.primary), "onPrimary" to hex(c.onPrimary),
    "secondary" to hex(c.secondaryContainer), "onSecondary" to hex(c.onSecondaryContainer))
}

@Composable internal fun WireframeTheme(colors: JSONObject, content: @Composable () -> Unit) {
  val dark = colors.optString("scheme", "dark") != "light"
  val fallback = if (dark) darkColorScheme() else lightColorScheme()
  fun read(key: String, backup: Color): Color = runCatching { Color(android.graphics.Color.parseColor(colors.getString(key))) }.getOrDefault(backup)
  val bg = read("background", fallback.background)
  val surface = read("surface", fallback.surface)
  val raised = read("surfaceRaised", fallback.surfaceContainer)
  val ink = read("text", fallback.onSurface)
  val muted = read("textSecondary", fallback.onSurfaceVariant)
  val primary = read("primary", fallback.primary)
  val onPrimary = read("onPrimary", fallback.onPrimary)
  val secondary = read("secondary", fallback.secondaryContainer)
  val onSecondary = read("onSecondary", fallback.onSecondaryContainer)
  fun gradient(key: String, backup: Color): Brush {
    val values = colors.optJSONArray(key)
    val stops = (0 until (values?.length() ?: 0)).mapNotNull { i -> runCatching { Color(android.graphics.Color.parseColor(values!!.getString(i))) }.getOrNull() }
    val palette = if (stops.size >= 2) stops else listOf(backup, backup)
    // Match CSS115deg header /135deg action on the actual component bounds.
    val angle = Math.toRadians(if (key == "headerGradient") 115.0 else 135.0)
    return object : ShaderBrush() {
      override fun createShader(size: Size): Shader {
        val x = sin(angle).toFloat(); val y = -cos(angle).toFloat()
        val half = (abs(size.width * x) + abs(size.height * y)) / 2f
        val center = Offset(size.width / 2f, size.height / 2f)
        return LinearGradientShader(center - Offset(x * half, y * half), center + Offset(x * half, y * half), palette)
      }
    }
  }
  val gradients = OrganicGradients(gradient("headerGradient", surface), gradient("actionGradient", primary))
  val inter = remember { FontFamily(Font(R.font.inter, FontWeight.Normal), Font(R.font.inter_medium, FontWeight.Medium), Font(R.font.inter_semibold, FontWeight.SemiBold), Font(R.font.inter_bold, FontWeight.Bold)) }
  val outfit = remember { FontFamily(Font(R.font.outfit_regular, FontWeight.Normal), Font(R.font.outfit, FontWeight.Medium), Font(R.font.outfit_semibold, FontWeight.SemiBold)) }
  val typography = Typography(
    headlineMedium = TextStyle(fontFamily = outfit, fontSize = 28.sp, fontWeight = FontWeight.Medium),
    headlineSmall = TextStyle(fontFamily = outfit, fontSize = 24.sp, fontWeight = FontWeight.Medium),
    titleLarge = TextStyle(fontFamily = outfit, fontSize = 20.sp, fontWeight = FontWeight.Medium),
    titleMedium = TextStyle(fontFamily = outfit, fontSize = 15.sp, fontWeight = FontWeight.Medium),
    titleSmall = TextStyle(fontFamily = inter, fontSize = 13.sp, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontFamily = inter, fontSize = 14.sp),
    bodyMedium = TextStyle(fontFamily = inter, fontSize = 13.sp),
    bodySmall = TextStyle(fontFamily = inter, fontSize = 11.sp),
    labelLarge = TextStyle(fontFamily = inter, fontSize = 13.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontFamily = inter, fontSize = 11.sp),
    labelSmall = TextStyle(fontFamily = inter, fontSize = 10.sp)
  )
  CompositionLocalProvider(LocalOrganicGradients provides gradients) {
    MaterialTheme(colorScheme = fallback.copy(
      tertiary = read("amber", fallback.tertiary), onTertiary = bg,
      primary = primary, onPrimary = onPrimary, primaryContainer = secondary, onPrimaryContainer = onSecondary,
      secondary = primary, onSecondary = onPrimary, secondaryContainer = secondary, onSecondaryContainer = onSecondary,
      background = bg, onBackground = ink, surface = surface, onSurface = ink,
      surfaceVariant = raised, onSurfaceVariant = muted, surfaceTint = Color.Transparent,
      outline = read("outline", fallback.outline), outlineVariant = read("border", fallback.outlineVariant),
      error = read("danger", fallback.error), inverseSurface = ink, inverseOnSurface = bg,
      surfaceDim = bg, surfaceBright = raised, surfaceContainerLowest = bg,
      surfaceContainerLow = surface, surfaceContainer = raised, surfaceContainerHigh = raised,
      surfaceContainerHighest = raised
    ), typography = typography, shapes = Shapes(
      extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(12.dp),
      medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(24.dp), extraLarge = RoundedCornerShape(28.dp)
    ), content = content)
  }
}

@Composable internal fun OrganicButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) {
  Button(onClick = onClick, enabled = enabled,
    modifier = modifier.heightIn(min = 48.dp).alpha(if (enabled) 1f else .38f).background(LocalOrganicGradients.current.action, MaterialTheme.shapes.large),
    shape = MaterialTheme.shapes.large,
    colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, contentColor = MaterialTheme.colorScheme.onPrimary, disabledContainerColor = Color.Transparent, disabledContentColor = MaterialTheme.colorScheme.onPrimary),
    content = content)
}

/** The approved controls are solid tonal fields; only focus draws an indicator. */
@Composable internal fun OrganicTextField(value: String, onValueChange: (String) -> Unit,
  modifier: Modifier = Modifier, enabled: Boolean = true, label: (@Composable () -> Unit)? = null,
  leadingIcon: (@Composable () -> Unit)? = null, suffix: (@Composable () -> Unit)? = null,
  singleLine: Boolean = false, keyboardOptions: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default) {
  TextField(value, onValueChange, modifier = modifier, enabled = enabled, label = label,
    leadingIcon = leadingIcon, suffix = suffix, singleLine = singleLine, keyboardOptions = keyboardOptions,
    shape = RoundedCornerShape(14.dp), colors = TextFieldDefaults.colors(
      focusedLabelColor = MaterialTheme.colorScheme.onSurfaceVariant,
      focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
      unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
      unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent))
}
