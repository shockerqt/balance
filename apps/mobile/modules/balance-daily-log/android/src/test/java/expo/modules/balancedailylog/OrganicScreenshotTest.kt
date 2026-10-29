package expo.modules.balancedailylog

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
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
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Before fun fullViewport() {
    // Match the reference's entire 390 x 844 content viewport, excluding system chrome.
    compose.activityRule.scenario.onActivity { activity ->
      WindowCompat.setDecorFitsSystemWindows(activity.window, false)
      WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        .hide(WindowInsetsCompat.Type.systemBars())
    }
  }

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
        Surface(Modifier.requiredSize(390.dp, 844.dp)) {
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
    val name = "forest-${if (dark) "dark" else "light"}-${if (populated) "diary" else "empty"}"
    screenshot("$name-initial")
    if (populated) {
      try { compose.onNodeWithText("08:00").performClick() }
      finally { screenshot(name) }
    } else screenshot(name)
    compose.onNodeWithText("Alimentos").assertIsDisplayed()
    compose.onNodeWithContentDescription("Día anterior").assertIsDisplayed().performClick()
    compose.runOnIdle { assertEquals(date.minusDays(1), movedTo) }
    compose.onNodeWithContentDescription("Ver detalle nutricional", substring = true)
      .assertIsDisplayed().performClick()
    compose.runOnIdle { assertTrue(nutritionOpened) }
    if (populated) {
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
    compose.onNodeWithText("Perfil").performClick()
    compose.runOnIdle { assertEquals(3, destination) }
  }

  @Test fun forestDarkProfile() = destination(3, true)
  @Test fun forestLightProfile() = destination(3, false)
  @Test fun forestDarkMeasurements() = destination(1, true)
  @Test fun forestLightMeasurements() = destination(1, false)
  @Test fun forestDarkSummary() = destination(2, true)
  @Test fun forestLightSummary() = destination(2, false)

  private fun destination(target: Int, dark: Boolean) {
    val today = LocalDate.of(2026, 10, 9)
    val days = JSONObject()
    repeat(7) { offset ->
      days.put(today.minusDays(offset.toLong()).toString(), JSONObject()
        .put("recorded", true).put("weightKg", 70.0 + offset * .1)
        .put("totals", JSONObject().put("calories", 1800 + offset * 50)
          .put("protein", 100 + offset).put("carbs", 200 + offset).put("fat", 60)))
    }
    val data = JSONObject().put("today", today.toString()).put("days", days)
      .put("showWeight", true).put("preferencesReady", true)
      .put("profile", JSONObject().put("name", "Perfil sintético").put("guest", true))
    val actions = mutableListOf<Pair<String, Map<String, Any>>>()
    var measurementDate: String? = null
    var weightOpened = false
    var opened: Pair<LocalDate, Boolean>? = null
    var nav = -1
    var adds = 0
    compose.setContent {
      WireframeTheme(forest(dark)) {
        Surface(Modifier.requiredSize(390.dp, 844.dp)) {
          Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) {
              WireDestination(destination = target, data = data, enabled = true,
                measurementDate = today.toString(), onMeasurementDate = { measurementDate = it },
                onWeight = { weightOpened = true }, onOpenDate = { date, body -> opened = date to body },
                onAction = { action, payload -> actions.add(action to payload) })
            }
            WireNavigation(target, true, { nav = it }, { adds++ })
          }
        }
      }
    }
    val label = mapOf(1 to "measurements", 2 to "summary", 3 to "profile").getValue(target)
    val name = "forest-${if (dark) "dark" else "light"}-$label"
    screenshot(name)
    when (target) {
      3 -> {
        compose.onNodeWithText("Perfil sintético").assertIsDisplayed()
        compose.onNode(isToggleable()).assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals("preference" to mapOf("enabled" to false), actions.last()) }
        listOf("Biblioteca" to "library", "Importar MacroFactor" to "import",
          "Cuenta y configuración" to "settings").forEach { (text, action) ->
          compose.onNodeWithText(text).performScrollTo().assertIsDisplayed().performClick()
          compose.runOnIdle { assertEquals(action to emptyMap<String, Any>(), actions.last()) }
        }
      }
      1 -> {
        compose.onNodeWithText("Editar peso").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertTrue(weightOpened) }
        compose.onNodeWithContentDescription("Mes siguiente").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("2026-11-01", measurementDate) }
      }
      2 -> {
        compose.onNodeWithContentDescription("Energía registrada, desde", substring = true).assertIsDisplayed()
        compose.onAllNodesWithText("Abrir registros de esa fecha")[0].performScrollTo().performClick()
        compose.runOnIdle { assertEquals(today to false, opened) }
        compose.onNodeWithText("Cuerpo").performScrollTo().performClick()
        screenshot("$name-body")
        compose.onNodeWithText("Abrir registros de esa fecha").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(today to true, opened) }
      }
    }
    compose.onNodeWithContentDescription("Registrar alimento o peso").assertIsEnabled().performClick()
    compose.onNodeWithText("Alimentos").performClick()
    compose.runOnIdle { assertEquals(1, adds); assertEquals(0, nav) }
  }

  /** Reference 3b801d9: synthetic recreation of the visible diary, never account data. */
  @Test fun forestDarkReference3b801d9() {
    val date = LocalDate.of(2026, 10, 9)
    val foods = JSONArray()
    fun food(id: String, name: String, portion: String, time: String, kcal: Int,
      protein: Int, carbs: Int, fat: Int) {
      foods.put(JSONObject().put("id", "reference-$id").put("name", name).put("portion", portion)
        .put("time", time).put("calories", kcal.toString())
        .put("macros", "P $protein g · C $carbs g · G $fat g")
        .put("totals", JSONObject().put("calories", kcal).put("protein", protein)
          .put("carbs", carbs).put("fat", fat)))
    }
    // The reference's folded groups expose totals/counts only; names below are invented.
    repeat(4) { i -> food("breakfast-$i", "Desayuno sintético ${i + 1}", "1 porción", "08:00",
      111, if (i == 0) 8 else 6, if (i == 0) 12 else 9, if (i == 0) 7 else 5) }
    repeat(4) { i -> food("snack-$i", "Colación sintética ${i + 1}", "1 porción", "11:00",
      if (i == 0) 62 else 61, if (i == 0) 7 else 4, if (i == 0) 10 else 9, if (i == 0) 0 else 1) }
    food("chicken", "Pechuga de pollo", "150 g", "13:10", 248, 46, 0, 5)
    food("rice", "Arroz integral", "450 g", "13:12", 506, 11, 107, 6)
    food("salad", "Ensalada de tomate y pepino", "1 plato · 180 g", "13:12", 38, 2, 8, 0)
    food("oil", "Aceite de oliva", "1 cucharadita · 5 g", "13:12", 45, 0, 0, 5)
    repeat(2) { i -> food("dinner-$i", "Cena sintética ${i + 1}", "1 porción", "18:00", 115, 4,
      if (i == 0) 11 else 10, 7) }
    val day = JSONObject().put("foods", foods).put("calories", "2557").put("target", "2200")
      .put("progress", 2557.0 / 2200).put("macros", JSONArray()
        .put(JSONObject().put("name", "Proteínas").put("value", "155"))
        .put(JSONObject().put("name", "Carbohidratos").put("value", "314"))
        .put(JSONObject().put("name", "Grasas").put("value", "81")))
    // Header is the whole-day reference; the visible group subtotal is intentionally partial.
    val days = JSONObject().put(date.toString(), day)
    val data = JSONObject().put("today", date.toString()).put("days", days).put("showWeight", false)
    var addTime: String? = null
    compose.setContent {
      WireframeTheme(forest(true)) {
        Surface(Modifier.requiredSize(390.dp, 844.dp)) {
          Column(Modifier.fillMaxSize()) {
            WireDiaryHeader(date, date, days, JSONObject().put("target", "2200"), true, {}, {}, {})
            Box(Modifier.weight(1f)) {
              DayContent(date, day, data, date, emptySet(), true, {}, {}, {}, { addTime = it },
                { _, _, _, _ -> })
            }
            WireNavigation(0, true, {}, {})
          }
        }
      }
    }
    screenshot("forest-dark-reference-3b801d9-collapsed")
    try { compose.onNodeWithText("13:00").performClick() }
    finally { screenshot("forest-dark-reference-3b801d9-2026-10-09") }
    listOf("444 kcal", "245 kcal", "837 kcal").forEach {
      compose.onNodeWithText(it, useUnmergedTree = true).assertIsDisplayed()
    }
    // Compare geometry within exactly the same viewport; do not claim a pixel golden match.
    val header = compose.onNodeWithTag("organic-diary-header").fetchSemanticsNode().boundsInRoot
    val group = compose.onNodeWithTag("organic-hour-13:00", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    val chicken = compose.onNodeWithTag("organic-food-reference-chicken", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    val oil = compose.onNodeWithTag("organic-food-reference-oil", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    val nav = compose.onNodeWithTag("organic-navigation").fetchSemanticsNode().boundsInRoot
    assertEquals("Reference header height", 164f, header.height, 10f)
    assertEquals("Reference hour height", 76f, group.height, 2f)
    assertEquals("Reference continuous row height", 72f, chicken.height, 2f)
    assertEquals("Reference grouped food inset", 16f, chicken.left, 1f)
    assertEquals("Four adjacent food rows", 216f, oil.top - chicken.top, 2f)
    assertTrue("Whole rows fit above whole navigation", oil.bottom <= nav.top && nav.bottom <= 844f)
    assertEquals("Reference navigation height", 88f, nav.height, 2f)
    listOf("Pechuga de pollo", "Arroz integral", "Ensalada de tomate y pepino", "Aceite de oliva").forEach {
      compose.onNodeWithText(it, useUnmergedTree = true).assertIsDisplayed()
    }
    compose.onNodeWithContentDescription("Agregar alimento a las 13:00").performClick()
    compose.runOnIdle { assertEquals("13:00", addTime) }
  }

  private fun screenshot(name: String) {
    compose.waitForIdle()
    // PixelCopy-based captureToImage waits for a compositor absent in Robolectric.
    // Draw the real Android decor/Compose view with native Skia on the UI thread.
    val bitmap = compose.runOnIdle {
      val view = compose.activity.window.decorView
      Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
    }
    val directory = File(checkNotNull(System.getProperty("organic.screenshots.dir")))
    check(directory.isDirectory || directory.mkdirs())
    File(directory, "$name.png").outputStream().use {
      assertTrue("PNG encoder failed", bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
    }
    assertEquals("mdpi viewport width", 390, bitmap.width)
    assertEquals("Full reference viewport height", 844, bitmap.height)
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
