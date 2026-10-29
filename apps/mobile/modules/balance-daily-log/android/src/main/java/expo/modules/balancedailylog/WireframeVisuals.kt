package expo.modules.balancedailylog

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.DateTimeFormatter

// One optical size/stroke throughout the native shell, without icon fonts or
// another native dependency. These simple vectors are drawn in a 24-unit grid.
private fun wireVector(name: String, draw: PathBuilder.() -> Unit): ImageVector =
  ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
    path(fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f,
      strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) { draw() }
  }.build()

internal object WireIcons {
  val Image = wireVector("Image") {
    moveTo(5f, 3f); lineTo(19f, 3f); quadTo(21f, 3f, 21f, 5f); lineTo(21f, 19f); quadTo(21f, 21f, 19f, 21f); lineTo(5f, 21f); quadTo(3f, 21f, 3f, 19f); lineTo(3f, 5f); quadTo(3f, 3f, 5f, 3f); close()
    moveTo(3f, 17f); lineTo(9f, 11f); lineTo(13f, 15f); lineTo(17f, 10f); lineTo(21f, 14f)
    moveTo(8f, 7f); lineTo(8.01f, 7f)
  }
  val Diary = wireVector("Diary") {
    moveTo(4f, 3f); lineTo(4f, 9f); quadTo(4f, 12f, 7f, 12f); quadTo(10f, 12f, 10f, 9f); lineTo(10f, 3f)
    moveTo(7f, 3f); lineTo(7f, 21f); moveTo(20f, 3f); quadTo(15f, 7f, 15f, 13f); lineTo(20f, 13f); lineTo(20f, 3f); lineTo(20f, 21f)
  }
  val Measurements = wireVector("Measurements") {
    moveTo(4f, 3f); lineTo(21f, 20f); lineTo(17f, 24f); lineTo(0f, 7f); close()
    moveTo(6f, 6f); lineTo(4f, 8f); moveTo(10f, 10f); lineTo(8f, 12f); moveTo(14f, 14f); lineTo(12f, 16f); moveTo(18f, 18f); lineTo(16f, 20f)
  }
  val Summary = wireVector("Summary") {
    moveTo(4f, 3f); lineTo(4f, 20f); lineTo(21f, 20f)
    moveTo(8f, 15f); lineTo(12f, 10f); lineTo(16f, 13f); lineTo(21f, 6f)
  }
  val Profile = wireVector("Profile") {
    moveTo(16f, 7f); curveTo(16f, 12.3f, 8f, 12.3f, 8f, 7f)
    curveTo(8f, 1.7f, 16f, 1.7f, 16f, 7f); close()
    moveTo(4f, 21f); lineTo(4f, 19f); quadTo(4f, 14f, 9f, 14f)
    lineTo(15f, 14f); quadTo(20f, 14f, 20f, 19f); lineTo(20f, 21f)
  }
  val Add = wireVector("Add") { moveTo(12f, 5f); lineTo(12f, 19f); moveTo(5f, 12f); lineTo(19f, 12f) }
  val Import = wireVector("Import") {
    moveTo(12f, 3f); lineTo(12f, 15f); moveTo(7f, 10f); lineTo(12f, 15f); lineTo(17f, 10f)
    moveTo(4f, 15f); lineTo(4f, 20f); lineTo(20f, 20f); lineTo(20f, 15f)
  }
  val Settings = wireVector("Settings") {
    moveTo(4f, 7f); lineTo(8f, 7f); moveTo(12f, 7f); lineTo(20f, 7f)
    moveTo(8f, 4f); lineTo(8f, 10f); moveTo(4f, 17f); lineTo(12f, 17f)
    moveTo(16f, 17f); lineTo(20f, 17f); moveTo(16f, 14f); lineTo(16f, 20f)
  }
  val Left = wireVector("Previous") { moveTo(15f, 6f); lineTo(9f, 12f); lineTo(15f, 18f) }
  val Right = wireVector("Next") { moveTo(9f, 6f); lineTo(15f, 12f); lineTo(9f, 18f) }
  val Down = wireVector("Expand") { moveTo(6f, 9f); lineTo(12f, 15f); lineTo(18f, 9f) }
  val Back = wireVector("Back") {
    moveTo(12f, 5f); lineTo(5f, 12f); lineTo(12f, 19f); moveTo(5f, 12f); lineTo(20f, 12f)
  }
  val Search = wireVector("Search") {
    moveTo(17f, 10f); curveTo(17f, 19.3f, 3f, 19.3f, 3f, 10f)
    curveTo(3f, 0.7f, 17f, 0.7f, 17f, 10f); close(); moveTo(15f, 15f); lineTo(21f, 21f)
  }
  val Calendar = wireVector("Calendar") {
    moveTo(5f, 5f); lineTo(19f, 5f); quadTo(21f, 5f, 21f, 7f)
    lineTo(21f, 19f); quadTo(21f, 21f, 19f, 21f); lineTo(5f, 21f)
    quadTo(3f, 21f, 3f, 19f); lineTo(3f, 7f); quadTo(3f, 5f, 5f, 5f); close()
    moveTo(7f, 3f); lineTo(7f, 7f); moveTo(17f, 3f); lineTo(17f, 7f)
    moveTo(3f, 11f); lineTo(21f, 11f)
  }
  val Clock = wireVector("Clock") {
    moveTo(21f, 12f); curveTo(21f, 24f, 3f, 24f, 3f, 12f)
    curveTo(3f, 0f, 21f, 0f, 21f, 12f); close()
    moveTo(12f, 7f); lineTo(12f, 12f); lineTo(15f, 14f)
  }
}

internal object WireSpace {
  val Page = 16.dp
  val Small = 8.dp
  val Medium = 12.dp
  val Section = 24.dp
}

internal fun wireDate(date: LocalDate): String = date.format(DateTimeFormatter.ofPattern("d MMM yyyy", wireLocale))
internal fun wireLongDate(date: LocalDate): String = date.format(DateTimeFormatter.ofPattern("EEEE d 'de' MMMM yyyy", wireLocale))
