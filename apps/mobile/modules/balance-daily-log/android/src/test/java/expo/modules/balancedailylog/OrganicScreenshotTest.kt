package expo.modules.balancedailylog

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.LocalDate

/** Synthetic fixtures only. Real Compose rendering; no golden comparison is implied. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w390dp-h844dp-mdpi")
class OrganicScreenshotTest {
  @get:Rule val compose = createComposeRule()

  @Test fun forestDarkDiary() = diary(dark = true, populated = true)
  @Test fun forestLightDiary() = diary(dark = false, populated = true)
  @Test fun forestDarkEmptyDiary() = diary(dark = true, populated = false)
  @Test fun forestLightEmptyDiary() = diary(dark = false, populated = false)

  private fun diary(dark: Boolean, populated: Boolean) {
    val date = LocalDate.of(2026, 10, 15)
    val food = JSONObject().put("id", "synthetic-oats").put("name", "Avena de prueba")
      .put("portion", "40 g").put("time", "08:30").put("calories", "150")
      .put("macros", "P 5 · C 27 · G 3").put("totals", JSONObject()
        .put("calories", 150).put("protein", 5).put("carbs", 27).put("fat", 3))
    val macros = JSONArray().put(JSONObject().put("name", "Proteínas").put("value", if (populated) "5" else "0"))
      .put(JSONObject().put("name", "Carbohidratos").put("value", if (populated) "27" else "0"))
      .put(JSONObject().put("name", "Grasas").put("value", if (populated) "3" else "0"))
    val day = JSONObject().put("foods", if (populated) JSONArray().put(food) else JSONArray())
      .put("calories", if (populated) "150" else "0").put("target", "2000")
      .put("progress", if (populated) .075 else 0.0).put("macros", macros)
    val data = JSONObject().put("today", date.toString())
      .put("days", JSONObject().put(date.toString(), day)).put("showWeight", false)
    var adds = 0
    var destination = -1
    var movedTo: LocalDate? = null
    var nutritionOpened = false
    compose.setContent {
      WireframeTheme(forest(dark)) {
        Surface(Modifier.fillMaxSize()) {
          Column(Modifier.fillMaxSize()) {
            WireDiaryHeader(visible = date, today = date, days = data.getJSONObject("days"),
              empty = JSONObject().put("calories", "0").put("target", "2000"), enabled = true,
              go = { movedTo = it }, onCalendar = {}, onNutrition = { nutritionOpened = true })
            Box(Modifier.weight(1f)) {
              DayContent(date = date, day = day, data = data, today = date,
                selected = emptySet(), enabled = true, onFood = {}, onLongFood = {},
                onGroup = {}, onAdd = { adds++ }, onEdit = { _, _, _, _ -> })
            }
            WireNavigation(destination = 0, enabled = true,
              onSelect = { destination = it }, onAdd = { adds++ })
          }
        }
      }
    }
    compose.onNodeWithText("Alimentos").assertIsDisplayed().assertIsSelected()
    compose.onNodeWithContentDescription("Día anterior").assertIsDisplayed().performClick()
    compose.runOnIdle { assertEquals(date.minusDays(1), movedTo) }
    compose.onNodeWithContentDescription("Ver detalle nutricional", substring = true)
      .assertIsDisplayed().performClick()
    compose.runOnIdle { assertTrue(nutritionOpened) }
    if (populated) {
      compose.onNodeWithText("08:00").assertIsDisplayed().performClick()
      compose.onNodeWithText("Avena de prueba", useUnmergedTree = true).assertIsDisplayed()
      compose.onNodeWithContentDescription("Agregar alimento a las 08:00")
        .assertIsEnabled().performClick()
    } else {
      compose.onNodeWithText("Sin alimentos registrados").assertIsDisplayed()
      compose.onNodeWithText("Agregar alimento").assertIsEnabled().performClick()
    }
    compose.onNodeWithContentDescription("Registrar alimento o peso")
      .assertIsDisplayed().assertIsEnabled().performClick()
    compose.runOnIdle { assertEquals(2, adds) }
    // Save before navigation assertions so a later semantic failure retains the render.
    screenshot("forest-${if (dark) "dark" else "light"}-${if (populated) "diary" else "empty"}")
    compose.onNodeWithText("Perfil").performClick()
    compose.runOnIdle { assertEquals(3, destination) }
  }

  private fun screenshot(name: String) {
    compose.waitForIdle()
    val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
    val directory = File(checkNotNull(System.getProperty("organic.screenshots.dir")))
    check(directory.isDirectory || directory.mkdirs())
    File(directory, "$name.png").outputStream().use {
      assertTrue("PNG encoder failed", bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
    }
    assertEquals("mdpi viewport width", 390, bitmap.width)
    // Activity content excludes system bars on some Robolectric/Compose versions.
    assertTrue("Unexpected viewport height: ${bitmap.height}", bitmap.height in 760..844)
    val pixels = IntArray(bitmap.width * bitmap.height)
    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    assertTrue("Transparent render", pixels.count { Color.alpha(it) > 250 } > pixels.size * .95)
    val luminance = pixels.map { (Color.red(it) * 299 + Color.green(it) * 587 + Color.blue(it) * 114) / 1000 }
    assertTrue("Flat/blank render", luminance.max() - luminance.min() > 60)
    assertTrue("Insufficient rendered detail", pixels.toSet().size > 100)
    val background = pixels[pixels.size / 2]
    assertTrue("Almost uniform render", pixels.count { it != background } > pixels.size / 100)
  }

  // Frozen Bosque roles from src/theme/organic-palettes.ts (UDS-017), not Material defaults.
  private fun forest(dark: Boolean): JSONObject {
    val keys = listOf("background", "surface", "surfaceRaised", "text", "textSecondary",
      "outline", "primary", "onPrimary", "secondary", "onSecondary")
    val values = if (dark) listOf("#141e1b", "#1c2b25", "#293a31", "#edf3e9", "#bdceba",
      "#8b9f88", "#c9e5ae", "#233716", "#344c38", "#e1f0d9")
    else listOf("#f4f5ef", "#e9eee3", "#dfe8d8", "#27352a", "#506450",
      "#6a7d65", "#42633a", "#ffffff", "#dbeacb", "#2c4125")
    return JSONObject().apply {
      put("scheme", if (dark) "dark" else "light")
      keys.zip(values).forEach { (key, value) -> put(key, value) }
      put("headerGradient", JSONArray(if (dark) listOf("#213c34", "#2c3d42", "#413745")
        else listOf("#ddebcf", "#cce8e1", "#e9dcef")))
      put("actionGradient", JSONArray(if (dark) listOf("#bddfa2", "#a4d2bf", "#d6bbdf")
        else listOf("#355a35", "#245e58", "#65475d")))
    }
  }
}
