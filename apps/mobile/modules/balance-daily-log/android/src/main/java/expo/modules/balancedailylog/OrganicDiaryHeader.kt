package expo.modules.balancedailylog

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.time.LocalDate

@Composable internal fun WireDiaryHeader(visible: LocalDate, today: LocalDate, days: JSONObject, empty: JSONObject, enabled: Boolean,
  go: (LocalDate) -> Unit, onCalendar: () -> Unit, onNutrition: () -> Unit) {
    Column(Modifier.testTag("organic-diary-header").fillMaxWidth().background(LocalOrganicGradients.current.header).padding(vertical = 4.dp)) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
      IconButton(onClick = { go(visible.minusDays(1)) }, enabled = enabled, modifier = Modifier.semantics { contentDescription = "Día anterior" }) { Icon(WireIcons.Left, null, Modifier.size(18.dp)) }
      TextButton(onClick = { onCalendar() }, enabled = enabled, modifier = Modifier.weight(1f)) {
        Text((if (visible == today) "Hoy · " else "") + visible.format(java.time.format.DateTimeFormatter.ofPattern("d MMM", wireLocale)), fontSize = 18.sp, fontFamily = MaterialTheme.typography.titleLarge.fontFamily, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
      }
      if (visible != today) TextButton(onClick = { go(today) }, enabled = enabled) { Text("Hoy", fontSize = 12.sp) }
      IconButton(onClick = { go(visible.plusDays(1)) }, enabled = enabled, modifier = Modifier.semantics { contentDescription = "Día siguiente" }) { Icon(WireIcons.Right, null, Modifier.size(18.dp)) }
    }
    val headerDay = days.optJSONObject(visible.toString()) ?: empty
    val headerMacros = wireObjects(headerDay.optJSONArray("macros")).take(3)
    Surface(onClick = { onNutrition() }, enabled = enabled, color = Color.Transparent,
      modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).semantics(mergeDescendants = true) {
        contentDescription = "${headerDay.optString("calories", "0")} de ${headerDay.optString("target")} kilocalorías. " + headerMacros.joinToString { "${it.optString("name")}: ${it.optString("value")} gramos" } + ". Ver detalle nutricional"
      }) {
      Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(headerDay.optString("calories", "0"), fontSize = 22.sp, fontFamily = MaterialTheme.typography.titleLarge.fontFamily, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)
          Text(" / ${headerDay.optString("target")} kcal", fontSize = 12.sp, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
          Icon(WireIcons.Right, null, Modifier.size(16.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
          headerMacros.forEachIndexed { i, m -> Text("${listOf("P", "C", "G")[i]} ${m.optString("value")} g", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
      }
    }
    val weekStart = visible.minusDays((visible.dayOfWeek.value - 1).toLong())
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
      repeat(7) { offset ->
        val date = weekStart.plusDays(offset.toLong())
        val chosen = date == visible
        val day = days.optJSONObject(date.toString()) ?: empty
        WireDateCell(date, chosen, day, enabled) { go(date) }

      }
    }
    Spacer(Modifier.height(4.dp))
    }

}
