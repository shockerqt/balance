package expo.modules.balancedailylog

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
  Column(Modifier.fillMaxSize()) {
  WirePageHeader("Resumen", "Tendencias de tus registros")
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(WireSpace.Page), verticalArrangement = Arrangement.spacedBy(WireSpace.Page)) {
    item {
      OrganicSegments(listOf("Alimentación", "Cuerpo"), if (body) 1 else 0, enabled, { body = it == 1 })
      Spacer(Modifier.height(12.dp))
      OrganicSegments(listOf("7 días", "30 días", "90 días"), listOf(7, 30, 90).indexOf(period), enabled, { period = listOf(7, 30, 90)[it] })
      TextButton(onClick = { picker = true }, enabled = enabled) {
        Icon(WireIcons.Calendar, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Hasta ${wireDate(end)}")
      }
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
  }
  if (picker && enabled) {
    val state = rememberDatePickerState(initialSelectedDateMillis = DailyLogDates.utcMillis(end), yearRange = 1900..9999)
    DatePickerDialog(onDismissRequest = { picker = false }, confirmButton = { TextButton(onClick = {
      state.selectedDateMillis?.let { endText = DailyLogDates.fromUtcMillis(it).toString() }; picker = false
    }) { Text("Elegir fecha final") } }, dismissButton = { TextButton(onClick = { picker = false }) { Text("Cancelar") } }) { DatePicker(state) }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun WirePlot(title: String, unit: String, records: List<Pair<LocalDate, JSONObject>>, start: LocalDate, end: LocalDate,
  keys: List<String>, labels: List<String>, bars: Boolean, body: Boolean, enabled: Boolean, onOpen: (LocalDate) -> Unit) {
  var selectedText by rememberSaveable { mutableStateOf(records.last().first.toString()) }
  var dateMenu by remember { mutableStateOf(false) }
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
  val paints = listOf(colors.primary, colors.onSurface, colors.onSurfaceVariant)
  val ticks = listOf(top, (top + minimum) / 2, minimum)
  fun pattern(series: Int) = if (series == 0) null else PathEffect.dashPathEffect(floatArrayOf(if (series == 1) 10f else 3f, 5f))
  Surface(Modifier.fillMaxWidth(), color = androidx.compose.ui.graphics.Color.Transparent) {
    Column(Modifier.padding(horizontal = 8.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        Text(unit, style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
      }
      if (keys.size > 1) FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        labels.forEachIndexed { series, label ->
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Canvas(Modifier.size(20.dp, 12.dp)) {
              drawLine(paints[series], Offset(0f, size.height / 2), Offset(size.width, size.height / 2),
                strokeWidth = 2.dp.toPx(), pathEffect = pattern(series))
            }
            Text(label, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
          }
        }
      }
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text(wireDate(selectedRecord.first), fontSize = 11.sp, color = colors.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          values(selectedRecord).forEachIndexed { i, n ->
            Text("${if (keys.size > 1) labels[i].take(1) + " " else ""}${wireNumber(n)} $unit", fontSize = if (keys.size == 1) 20.sp else 12.sp, fontFamily = MaterialTheme.typography.titleLarge.fontFamily)
          }
        }
      }
      Row(Modifier.fillMaxWidth().height(140.dp)) {
        Column(Modifier.width(48.dp).fillMaxHeight().padding(end = 8.dp), verticalArrangement = Arrangement.SpaceBetween,
          horizontalAlignment = Alignment.End) {
          ticks.forEach { Text(wireNumber(it), style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant) }
        }
      Canvas(Modifier.weight(1f).fillMaxHeight().semantics {
        contentDescription = "$title, desde ${wireDate(start)} hasta ${wireDate(end)}. Usa los botones de fecha para consultar valores y abrir registros."
      }.pointerInput(records, start, end, enabled) {
        detectTapGestures { point ->
          if (enabled) {
            val target = point.x / size.width * (span + 1) - 0.5f
            selectedText = records.minBy { abs(ChronoUnit.DAYS.between(start, it.first).toFloat() - target) }.first.toString()
          }
        }
      }) {
        fun x(date: LocalDate) = (ChronoUnit.DAYS.between(start, date).toFloat() + 0.5f) / (span + 1) * size.width
        val inset = 4.dp.toPx()
        fun y(value: Double) = size.height - inset - (((value - minimum) / (top - minimum)).toFloat().coerceIn(0f, 1f) * (size.height - inset * 2))
        ticks.forEach { tick -> drawLine(colors.outline.copy(alpha = .5f), Offset(0f, y(tick)), Offset(size.width, y(tick)), strokeWidth = 0.5.dp.toPx()) }
        drawLine(colors.primary.copy(alpha = 0.5f), Offset(x(selectedRecord.first), 0f), Offset(x(selectedRecord.first), size.height), 1.dp.toPx())
        records.forEachIndexed { i, record ->
          val v = values(record)
          keys.indices.forEach { series ->
            val point = Offset(x(record.first), y(v[series]))
            if (bars) drawRect(paints[series], Offset(point.x - size.width / (span + 1) * .3f, point.y), Size((size.width / (span + 1) * .6f).coerceAtLeast(1f), (y(minimum) - point.y).coerceAtLeast(0f)))
            else {
              if (i > 0 && (body || ChronoUnit.DAYS.between(records[i - 1].first, record.first) == 1L)) {
                val previous = records[i - 1]
                drawLine(paints[series], Offset(x(previous.first), y(values(previous)[series])), point, strokeWidth = 2.dp.toPx(),
                  pathEffect = pattern(series))
              }
              drawCircle(paints[series], (if (i == selected) 4.dp else 2.dp).toPx(), point)
            }
          }
        }
      }
      }
      Row(Modifier.fillMaxWidth().padding(start = 48.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(wireDate(start), style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
        Text(wireDate(end), style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceVariant)
      }
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
          TextButton(onClick = { dateMenu = true }, enabled = enabled) {
            Text(wireDate(selectedRecord.first), fontSize = 12.sp)
            Spacer(Modifier.width(6.dp)); Icon(WireIcons.Down, null, Modifier.size(16.dp))
          }
          DropdownMenu(expanded = dateMenu, onDismissRequest = { dateMenu = false }) {
            records.forEach { record -> DropdownMenuItem(text = { Text(wireDate(record.first)) }, onClick = { selectedText = record.first.toString(); dateMenu = false }) }
          }
        }
        TextButton(onClick = { onOpen(selectedRecord.first) }, enabled = enabled) {
          Text("Abrir registros", fontSize = 12.sp); Spacer(Modifier.width(4.dp)); Icon(WireIcons.Right, null, Modifier.size(16.dp))
        }
      }
    }
  }
}
