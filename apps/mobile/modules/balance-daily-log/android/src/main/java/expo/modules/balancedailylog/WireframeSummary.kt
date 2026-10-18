package expo.modules.balancedailylog

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun WireSummary(data: JSONObject, enabled: Boolean, onOpenDate: (LocalDate, Boolean) -> Unit) {
  var body by rememberSaveable { mutableStateOf(false) }
  var period by rememberSaveable { mutableIntStateOf(7) }
  var endText by rememberSaveable { mutableStateOf(data.optString("today")) }
  var picker by remember { mutableStateOf(false) }
  val end = LocalDate.parse(endText)
  val start = end.minusDays(period.toLong() - 1)
  val days = data.optJSONObject("days") ?: JSONObject()
  val records = remember(data, start, end, body) {
    days.keys().asSequence().map { LocalDate.parse(it) }.filter { it >= start && it <= end }.sorted().mapNotNull { date ->
      val day = days.getJSONObject(date.toString())
      if (if (body) !day.isNull("weightKg") else day.optBoolean("recorded")) date to day else null
    }.toList()
  }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
    item { Text("Resumen", style = MaterialTheme.typography.headlineSmall) }
    item {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(!body, { body = false }, label = { Text("Alimentación") }, enabled = enabled)
        FilterChip(body, { body = true }, label = { Text("Cuerpo") }, enabled = enabled)
      }
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(7, 30, 90).forEach { n -> FilterChip(period == n, { period = n }, label = { Text("$n días") }, enabled = enabled) }
      }
      OutlinedButton(onClick = { picker = true }, enabled = enabled) { Text("Hasta $end") }
    }
    if (body && !data.optBoolean("showWeight")) item { Text("Activa el seguimiento de peso en Perfil para consultar su evolución.") }
    else if (records.isEmpty()) item {
      Text("Sin registros en este período", style = MaterialTheme.typography.titleMedium)
      Text("Elige otras fechas o registra ${if (body) "tu peso" else "un alimento"}.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else if (body) item("weight") {
      WirePlot("Peso", "kg", records, start, end, listOf("weightKg"), listOf("Peso"), false, true, enabled) { onOpenDate(it, true) }
    } else {
      item("energy") { WirePlot("Energía registrada", "kcal", records, start, end, listOf("calories"), listOf("Energía"), true, false, enabled) { onOpenDate(it, false) } }
      item("macros") { WirePlot("Macronutrientes", "g", records, start, end, listOf("protein", "carbs", "fat"), listOf("Proteínas", "Carbohidratos", "Grasas"), false, false, enabled) { onOpenDate(it, false) } }
    }
    item { Text(if (body) "La línea une mediciones reales según el tiempo transcurrido." else "Los días sin alimentos registrados se muestran sin datos. Las curvas se interrumpen en esas fechas.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
  }
  if (picker && enabled) {
    val state = rememberDatePickerState(initialSelectedDateMillis = DailyLogDates.utcMillis(end), yearRange = 1900..9999)
    DatePickerDialog(onDismissRequest = { picker = false }, confirmButton = { TextButton(onClick = {
      state.selectedDateMillis?.let { endText = DailyLogDates.fromUtcMillis(it).toString() }; picker = false
    }) { Text("Elegir fecha final") } }, dismissButton = { TextButton(onClick = { picker = false }) { Text("Cancelar") } }) { DatePicker(state) }
  }
}

@Composable private fun WirePlot(title: String, unit: String, records: List<Pair<LocalDate, JSONObject>>, start: LocalDate, end: LocalDate,
  keys: List<String>, labels: List<String>, bars: Boolean, body: Boolean, enabled: Boolean, onOpen: (LocalDate) -> Unit) {
  var selectedText by rememberSaveable { mutableStateOf(records.last().first.toString()) }
  val selected = records.indexOfFirst { it.first.toString() == selectedText }.let { if (it < 0) records.lastIndex else it }
  val selectedRecord = records[selected]
  fun values(record: Pair<LocalDate, JSONObject>) = keys.map { key ->
    if (body) record.second.optDouble(key) else record.second.optJSONObject("totals")?.optDouble(key, 0.0) ?: 0.0
  }
  val maximum = records.flatMap(::values).maxOrNull()?.coerceAtLeast(1.0) ?: 1.0
  val minimum = if (body) (records.flatMap(::values).minOrNull() ?: 0.0) - 0.5 else 0.0
  val top = maximum + if (body) 0.5 else maximum * 0.1
  val span = ChronoUnit.DAYS.between(start, end).coerceAtLeast(1).toFloat()
  val colors = MaterialTheme.colorScheme
  val paints = listOf(colors.onSurface, colors.onSurfaceVariant, colors.outline)
  OutlinedCard(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(title, style = MaterialTheme.typography.titleMedium)
      Text("${wireNumber(minimum)}–${wireNumber(top)} $unit", style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
      Canvas(Modifier.fillMaxWidth().height(140.dp).semantics {
        contentDescription = "$title, desde $start hasta $end. Usa los botones de fecha para consultar valores y abrir registros."
      }.pointerInput(records, start, end, enabled) {
        detectTapGestures { point ->
          if (enabled) {
            val target = point.x / size.width * span
            selectedText = records.minBy { abs(ChronoUnit.DAYS.between(start, it.first).toFloat() - target) }.first.toString()
          }
        }
      }) {
        fun x(date: LocalDate) = (ChronoUnit.DAYS.between(start, date).toFloat() + 0.5f) / (span + 1) * size.width
        fun y(value: Double) = size.height - (((value - minimum) / (top - minimum)).toFloat().coerceIn(0f, 1f) * (size.height - 6))
        drawLine(colors.outlineVariant, Offset(0f, size.height), Offset(size.width, size.height))
        records.forEachIndexed { i, record ->
          val v = values(record)
          keys.indices.forEach { series ->
            val point = Offset(x(record.first), y(v[series]))
            if (bars) drawRect(paints[series], Offset(point.x - size.width / (span + 1) * .3f, point.y), Size((size.width / (span + 1) * .6f).coerceAtLeast(1f), size.height - point.y))
            else {
              if (i > 0 && (body || ChronoUnit.DAYS.between(records[i - 1].first, record.first) == 1L)) {
                val previous = records[i - 1]
                drawLine(paints[series], Offset(x(previous.first), y(values(previous)[series])), point, strokeWidth = 2.dp.toPx(),
                  pathEffect = if (series == 0) null else PathEffect.dashPathEffect(floatArrayOf(if (series == 1) 10f else 3f, 5f)))
              }
              drawCircle(paints[series], 2.dp.toPx(), point)
            }
          }
        }
        drawLine(colors.primary, Offset(x(selectedRecord.first), 0f), Offset(x(selectedRecord.first), size.height), 1.dp.toPx())
      }
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(start.toString(), style = MaterialTheme.typography.labelSmall); Text(end.toString(), style = MaterialTheme.typography.labelSmall) }
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = { selectedText = records[selected - 1].first.toString() }, enabled = enabled && selected > 0) { Text("‹ Anterior") }
        Text(selectedRecord.first.toString(), modifier = Modifier.padding(top = 12.dp), style = MaterialTheme.typography.labelMedium)
        TextButton(onClick = { selectedText = records[selected + 1].first.toString() }, enabled = enabled && selected < records.lastIndex) { Text("Siguiente ›") }
      }
      values(selectedRecord).forEachIndexed { i, n -> Text("${labels[i]}: ${wireNumber(n)} $unit", style = MaterialTheme.typography.bodySmall) }
      OutlinedButton(onClick = { onOpen(selectedRecord.first) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("Abrir registros de esa fecha") }
    }
  }
}
