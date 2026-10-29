package expo.modules.balancedailylog

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

internal fun wireObjects(array: JSONArray?): List<JSONObject> = if (array == null) emptyList() else (0 until array.length()).mapNotNull { array.optJSONObject(it) }
internal fun wireNumber(value: Double?): String = FoodEntryModel.display(value)
internal fun wireMacros(totals: JSONObject): String = listOf("P" to "protein", "C" to "carbs", "G" to "fat").joinToString(" · ") { (label, key) -> "$label ${wireNumber(totals.optDouble(key, 0.0))} g" }
internal val wireLocale = Locale.forLanguageTag("es-CL")

@Composable internal fun RowScope.WireDateCell(date: LocalDate, chosen: Boolean, day: JSONObject, enabled: Boolean, click: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  val progress = day.optDouble("progress", 0.0)
  val ring = WireframeModel.ring(progress)
  Surface(onClick = click, enabled = enabled, color = if (chosen) colors.secondaryContainer else Color.Transparent,
    contentColor = if (chosen) colors.primary else colors.onSurfaceVariant,
    shape = RoundedCornerShape(16.dp), modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics {
      selected = chosen
      contentDescription = "${date.format(DateTimeFormatter.ofPattern("EEEE d MMMM", wireLocale))}, ${day.optString("calories", "0")} kcal registradas, ${wireNumber(progress * 100)} por ciento de la meta"
    }) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(vertical = 3.dp)) {
      Text(date.format(DateTimeFormatter.ofPattern("EEEEE", wireLocale)).uppercase(wireLocale), fontSize = 10.sp)
      Box(Modifier.size(30.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().padding(2.dp)) {
          drawCircle(colors.outline, style = Stroke(2.dp.toPx()))
          if (ring.first > 0) drawArc(colors.onSurfaceVariant, -90f, ring.first * 360, false, style = Stroke(2.dp.toPx()))
          if (ring.second > 0) drawArc(colors.tertiary, -90f, ring.second * 360, false, style = Stroke(2.dp.toPx()))
        }
        Text(date.dayOfMonth.toString(), fontSize = 11.sp, color = if (chosen) colors.primary else colors.onSurface,
          fontWeight = if (chosen) FontWeight.Bold else FontWeight.Normal)
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun DayContent(date: LocalDate, day: JSONObject, data: JSONObject, today: LocalDate, selected: Set<String>, enabled: Boolean,
  onFood: (String) -> Unit, onLongFood: (String) -> Unit, onGroup: (List<String>) -> Unit, onAdd: (String) -> Unit,
  onEdit: (JSONObject, String, String, String) -> Unit) {
  val entries = remember(day) { wireObjects(day.optJSONArray("foods")) }
  val groups = remember(entries) { entries.groupBy { WireframeModel.hour(it.optString("time")) } }
  var opened by rememberSaveable(date.toString()) { mutableStateOf("") }
  var editing by remember { mutableStateOf<JSONObject?>(null) }
  LaunchedEffect(enabled) { if (!enabled) { editing = null } }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(0.dp)) {
    if (entries.isEmpty()) item("empty") {
      Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Sin alimentos registrados", style = MaterialTheme.typography.titleLarge)
        Text("Registra un alimento para este día.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick = { onAdd("12:00") }, enabled = enabled) { Text("Agregar alimento") }
      }
    }
    groups.forEach { (hour, group) ->
      val ids = group.map { it.optString("id") }
      val expanded = hour in opened.split('|') || ids.any { it in selected }
      val totals = JSONObject()
      listOf("calories", "protein", "carbs", "fat").forEach { key -> totals.put(key, group.sumOf { it.optJSONObject("totals")?.optDouble(key, 0.0) ?: 0.0 }) }
      item("hour-$hour") {
        Row(Modifier.testTag("organic-hour-$hour").fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          if (selected.isNotEmpty()) Checkbox(ids.all { it in selected }, { onGroup(ids) }, enabled = enabled)
          Surface(onClick = { opened = if (expanded) opened.split('|').filter { it != hour }.joinToString("|") else "$opened|$hour" }, enabled = enabled,
            color = Color.Transparent, modifier = Modifier.weight(1f).semantics { stateDescription = if (expanded) "Expandido" else "Plegado" }) {
            Column(Modifier.heightIn(min = 76.dp).padding(top = 12.dp, bottom = 12.dp, end = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(hour, fontSize = 18.sp, fontFamily = MaterialTheme.typography.titleLarge.fontFamily, fontWeight = FontWeight.SemiBold)
                Text("${group.size} alimentos", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                Text("${wireNumber(totals.optDouble("calories"))} kcal", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Icon(if (expanded) WireIcons.Down else WireIcons.Right, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
              }
              Text(wireMacros(totals), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
          if (selected.isEmpty()) IconButton(onClick = { onAdd(hour) }, enabled = enabled, modifier = Modifier.size(48.dp).semantics { contentDescription = "Agregar alimento a las $hour" }) {
            Icon(WireIcons.Add, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
          }
        }
      }
      if (expanded) items(group, key = { "food-${it.optString("id")}" }, contentType = { "food" }) { food ->
        val id = food.optString("id")
        val chosen = id in selected
        val position = group.indexOf(food)
        val divider = MaterialTheme.colorScheme.background
        Surface(color = if (chosen) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
          shape = RoundedCornerShape(topStart = if (position == 0) 18.dp else 0.dp, topEnd = if (position == 0) 6.dp else 0.dp, bottomStart = if (position == group.lastIndex) 18.dp else 0.dp, bottomEnd = if (position == group.lastIndex) 18.dp else 0.dp),
          modifier = Modifier.testTag("organic-food-$id").fillMaxWidth().drawWithContent { drawContent(); if (position > 0) drawLine(divider, Offset.Zero, Offset(size.width, 0f), strokeWidth = 1.dp.toPx()) }.combinedClickable(enabled = enabled,
            onClick = { if (selected.isEmpty()) editing = food else onFood(id) },
            onLongClickLabel = "Seleccionar alimento", onLongClick = { onLongFood(id) })
            .semantics(mergeDescendants = true) { this.selected = chosen; contentDescription = "${food.optString("name")}, ${food.optString("portion")}, ${food.optString("time")}, ${food.optString("calories")} kcal, ${food.optString("macros")}" }) {
          Row(Modifier.heightIn(min = 72.dp).padding(vertical = 12.dp, horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (selected.isNotEmpty()) Checkbox(chosen, null, modifier = Modifier.size(24.dp))
            else Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { Icon(WireIcons.Image, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(food.optString("name"), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Text("${food.optString("calories")} kcal", fontSize = 13.sp)
              }
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${food.optString("portion")} · ${food.optString("time")}", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(food.optString("macros"), fontSize = 11.sp, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
          }
        }
      }
    }
  }
  editing?.let { food -> if (enabled) WireEditFood(food, date, onDismiss = { editing = null }) { quantity, mode, time ->
    onEdit(food, quantity, mode, time); editing = null
  } }
}

@Composable private fun WireEditFood(food: JSONObject, date: LocalDate, onDismiss: () -> Unit, onSave: (String, String, String) -> Unit) {
  var quantity by rememberSaveable(food.optString("id")) { mutableStateOf(FoodEntryModel.input(food.optDouble("quantity"))) }
  var mode by rememberSaveable(food.optString("id")) { mutableStateOf(if (food.isNull("portionSnapshot")) "canonical" else "portion") }
  var time by rememberSaveable(food.optString("id")) { mutableStateOf(food.optString("time")) }
  var error by remember { mutableStateOf("") }
  val portion = food.optJSONObject("portionSnapshot")
  AlertDialog(onDismissRequest = onDismiss, title = { Text(food.optString("name")) }, text = {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text("${wireDate(date)} · la información nutricional histórica se conserva", style = MaterialTheme.typography.bodySmall)
      TextField(quantity, { quantity = it }, label = { Text("Cantidad") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(mode == "canonical", { mode = "canonical"; quantity = FoodEntryModel.input(food.optDouble("canonicalQuantity")) }, label = { Text(food.optString("unit")) })
        if (portion != null) FilterChip(mode == "portion", { mode = "portion"; quantity = FoodEntryModel.input(food.optDouble("quantity")) }, label = { Text(portion.optString("name")) })
      }
      TextField(time, { time = it }, label = { Text("Hora · HH:mm") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii))
      if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
    }
  }, confirmButton = { TextButton(onClick = {
    if (FoodEntryModel.decimal(quantity)?.let { it > 0 } == true && WireframeModel.validTime(date, time)) onSave(quantity, mode, time)
    else error = "Revisa la cantidad y la hora de Chile."
  }) { Text("Guardar") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun WireNutritionSheet(date: LocalDate, day: JSONObject, onDismiss: () -> Unit) {
  ModalBottomSheet(onDismissRequest = onDismiss) {
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      item { Text("Nutrición · ${wireDate(date)}", style = MaterialTheme.typography.titleLarge) }
      item { Text("${wireNumber(day.optDouble("progress", 0.0) * 100)}% de la meta de energía registrada", color = MaterialTheme.colorScheme.onSurfaceVariant) }
      items(wireObjects(day.optJSONArray("details"))) { field ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Text(field.optString("label"), Modifier.weight(1f))
          Text(if (field.isNull("value")) "Sin datos" else "${wireNumber(field.optDouble("value"))} ${field.optString("unit")}${if (field.optBoolean("partial")) " · parcial" else ""}")
        }
      }
      item { Text("Los valores parciales incluyen solo los alimentos con ese dato.", style = MaterialTheme.typography.bodySmall) }
    }
  }
}
