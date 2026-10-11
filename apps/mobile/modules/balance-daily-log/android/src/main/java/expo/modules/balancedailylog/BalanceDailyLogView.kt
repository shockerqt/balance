package expo.modules.balancedailylog

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import org.json.JSONObject

internal data class DateCommand(val date: LocalDate, val fromNative: Boolean)

class BalanceDailyLogView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onAction by EventDispatcher()
  internal val active = mutableStateOf(false)
  private val data = mutableStateOf(JSONObject())
  private val command = mutableStateOf(DateCommand(LocalDate.now(), false))
  private var sequence = 0L
  private var session = ""

  init {
    addView(ComposeView(context).apply {
      setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
      setContent {
        val snapshot = data.value
        val colors = snapshot.optJSONObject("colors") ?: JSONObject()
        val background = color(colors, "background", Color(0xFF12160F))
        MaterialTheme(colorScheme = darkColorScheme(
          primary = color(colors, "primary", Color(0xFFEEF2E6)),
          onPrimary = color(colors, "onPrimary", Color(0xFF12160F)),
          surface = color(colors, "surface", Color(0xFF1A1F16)),
          surfaceContainer = color(colors, "surfaceRaised", Color(0xFF232A1E)),
          onSurface = color(colors, "text", Color(0xFFEEF2E6)),
          onSurfaceVariant = color(colors, "textSecondary", Color(0xFF9AA392)),
          outlineVariant = color(colors, "border", Color(0xFF333C2C)),
          background = background,
          error = color(colors, "danger", Color(0xFFFF6B6B))
        )) {
          DailyLog(snapshot, command.value, active.value, ::emit)
        }
      }
    }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setData(value: String) {
    val parsed = runCatching { JSONObject(value) }.getOrNull() ?: return
    val nextSession = parsed.optString("session")
    if (nextSession != session) { session = nextSession; sequence = 0L }
    data.value = parsed
  }
  fun setDateCommand(value: String) {
    val parsed = runCatching { JSONObject(value) }.getOrNull() ?: return
    val date = DailyLogDates.parse(parsed.optString("date")) ?: return
    command.value = DateCommand(date, parsed.optBoolean("fromNative"))
  }
  private fun emit(action: String, date: LocalDate, ids: List<String>, time: String?) {
    if (!active.value || session.isEmpty()) return
    sequence += 1
    val event = mutableMapOf<String, Any>("session" to session, "sequence" to sequence, "action" to action, "date" to date.toString())
    if (ids.isNotEmpty()) event["ids"] = ids
    if (time != null) event["time"] = time
    onAction(event)
  }
}

private fun color(colors: JSONObject, key: String, fallback: Color): Color =
  runCatching { Color(android.graphics.Color.parseColor(colors.getString(key))) }.getOrDefault(fallback)
private fun foods(day: JSONObject): List<JSONObject> {
  val array = day.optJSONArray("foods") ?: return emptyList()
  return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}
private val spanish = Locale.forLanguageTag("es-CL")
private val dayFormat = DateTimeFormatter.ofPattern("EEEE d 'de' MMMM", spanish)
private val monthFormat = DateTimeFormatter.ofPattern("MMMM yyyy", spanish)
private val weekdayFormat = DateTimeFormatter.ofPattern("EEEEE", spanish)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DailyLog(data: JSONObject, command: DateCommand, active: Boolean,
  emit: (String, LocalDate, List<String>, String?) -> Unit) {
  val pager = rememberPagerState(initialPage = DailyLogDates.page(command.date)) { DailyLogDates.count }
  val scope = rememberCoroutineScope()
  val latestEmit by rememberUpdatedState(emit)
  val latestActive by rememberUpdatedState(active)
  val settled = DailyLogDates.date(pager.settledPage)
  val visible = DailyLogDates.date(pager.currentPage)
  val today = DailyLogDates.parse(data.optString("today")) ?: LocalDate.now()
  val days = data.optJSONObject("days") ?: JSONObject()
  val empty = data.optJSONObject("empty") ?: JSONObject()
  var selected by remember { mutableStateOf(setOf<String>()) }
  var selectionDate by remember { mutableStateOf(settled) }
  var calendar by remember { mutableStateOf(false) }
  var deleteConfirmation by remember { mutableStateOf(false) }
  var moveTime by remember { mutableStateOf(false) }
  val settledDay = days.optJSONObject(settled.toString()) ?: empty
  val available = foods(settledDay).map { it.optString("id") }.toSet()
  val locked = pager.isScrollInProgress || !active

  // Native acknowledgements never animate the pager backwards after a newer
  // swipe. Only an external date command controls it from JavaScript.
  LaunchedEffect(command) {
    if (!command.fromNative && DailyLogDates.page(command.date) != pager.settledPage) {
      selected = emptySet()
      pager.scrollToPage(DailyLogDates.page(command.date))
    }
  }
  LaunchedEffect(pager) {
    snapshotFlow { pager.settledPage to pager.isScrollInProgress }.distinctUntilChanged().collect { (page, scrolling) ->
      if (!scrolling && latestActive) latestEmit("date", DailyLogDates.date(page), emptyList(), null)
    }
  }
  LaunchedEffect(settled, available, active) {
    selected = if (selectionDate != settled || !active) emptySet() else selected.intersect(available)
    selectionDate = settled
    if (!active) { calendar = false; deleteConfirmation = false; moveTime = false }
  }
  BackHandler(active && selected.isNotEmpty()) { selected = emptySet() }
  fun action(kind: String, ids: List<String> = emptyList(), time: String? = null) {
    if (!locked && pager.currentPage == pager.settledPage) emit(kind, settled, ids, time)
  }
  fun go(date: LocalDate) {
    if (active && selected.isEmpty()) scope.launch { pager.animateScrollToPage(DailyLogDates.page(date)) }
  }

  Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text("REGISTRO DIARIO", fontSize = 11.sp, letterSpacing = 1.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(visible.format(monthFormat).replaceFirstChar { it.titlecase(spanish) }, style = MaterialTheme.typography.titleLarge)
      }
      TextButton(onClick = { go(today) }, enabled = !locked && selected.isEmpty()) { Text("Hoy") }
      TextButton(onClick = { calendar = true }, enabled = !locked && selected.isEmpty(),
        modifier = Modifier.semantics { contentDescription = "Elegir fecha" }) { Text("Fecha") }
    }
    val weekStart = visible.minusDays((visible.dayOfWeek.value - 1).toLong())
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
      repeat(7) { offset ->
        val date = weekStart.plusDays(offset.toLong())
        val chosen = date == visible
        Surface(modifier = Modifier.weight(1f).padding(2.dp),
          color = if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.background,
          shape = RoundedCornerShape(12.dp),
          onClick = { go(date) }, enabled = !locked && selected.isEmpty()) {
          Column(Modifier.padding(vertical = 10.dp).semantics(mergeDescendants = true) {
            contentDescription = date.format(dayFormat)
            this.selected = chosen
          }, horizontalAlignment = Alignment.CenterHorizontally) {
            Text(date.format(weekdayFormat).uppercase(spanish), fontSize = 11.sp)
            Text(date.dayOfMonth.toString(), fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            val hasFood = foods(days.optJSONObject(date.toString()) ?: empty).isNotEmpty()
            Text(if (date == today) "HOY" else if (hasFood) "•" else " ", fontSize = 9.sp)
          }
        }
      }
    }
    HorizontalDivider(Modifier.padding(top = 8.dp))
    HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth(),
      beyondViewportPageCount = 1, userScrollEnabled = active && selected.isEmpty(), key = { it }) { page ->
      val date = DailyLogDates.date(page)
      val day = days.optJSONObject(date.toString()) ?: empty
      DayContent(date, day, data, today, selected, enabled = active && page == pager.settledPage && !pager.isScrollInProgress,
        onFood = { id ->
          if (selected.isEmpty()) action("edit", listOf(id)) else selected = if (id in selected) selected - id else selected + id
        },
        onLongFood = { id -> selected = selected + id; selectionDate = date },
        onGroup = { ids ->
          selected = if (ids.all { it in selected }) selected - ids.toSet() else selected + ids
          selectionDate = date
        },
        onAdd = { time -> action("add", time = time) }, onWeight = { action("weight") })
    }
    Surface(color = MaterialTheme.colorScheme.surface) {
      if (selected.isEmpty()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = { go(settled.minusDays(1)) }, enabled = !locked,
            modifier = Modifier.semantics { contentDescription = "Día anterior" }) { Text("‹", fontSize = 28.sp) }
          FilledTonalButton(onClick = { action("add") }, enabled = !locked, modifier = Modifier.weight(1f)) { Text("+  Registrar alimento") }
          IconButton(onClick = { go(settled.plusDays(1)) }, enabled = !locked,
            modifier = Modifier.semantics { contentDescription = "Día siguiente" }) { Text("›", fontSize = 28.sp) }
        }
      } else {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${selected.size} seleccionados", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = { selected = emptySet() }) { Text("Cancelar") }
          }
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton(onClick = { moveTime = true }, enabled = !locked) { Text("Cambiar hora") }
            TextButton(onClick = { deleteConfirmation = true }, enabled = !locked) { Text("Eliminar", color = MaterialTheme.colorScheme.error) }
          }
        }
      }
    }
  }
  if (calendar) {
    val state = rememberDatePickerState(initialSelectedDateMillis = DailyLogDates.utcMillis(settled), yearRange = 1900..9999)
    DatePickerDialog(onDismissRequest = { calendar = false },
      confirmButton = { TextButton(onClick = {
        state.selectedDateMillis?.let { go(DailyLogDates.fromUtcMillis(it)) }; calendar = false
      }, enabled = state.selectedDateMillis != null) { Text("Ir al día") } },
      dismissButton = { TextButton(onClick = { calendar = false }) { Text("Cancelar") } }) {
      DatePicker(state = state, title = { Text("Elegir fecha", Modifier.padding(24.dp)) })
    }
  }
  if (deleteConfirmation) AlertDialog(onDismissRequest = { deleteConfirmation = false },
    title = { Text("Eliminar ${selected.size} registros") },
    text = { Text("Se eliminarán los alimentos seleccionados de este día.") },
    confirmButton = { TextButton(onClick = { action("delete", selected.toList()); selected = emptySet(); deleteConfirmation = false }) { Text("Eliminar") } },
    dismissButton = { TextButton(onClick = { deleteConfirmation = false }) { Text("Cancelar") } })
  if (moveTime) {
    val firstTime = foods(settledDay).firstOrNull { it.optString("id") in selected }?.optString("time") ?: "12:00"
    val state = rememberTimePickerState(initialHour = firstTime.substringBefore(":").toIntOrNull() ?: 12,
      initialMinute = firstTime.substringAfter(":").toIntOrNull() ?: 0, is24Hour = true)
    AlertDialog(onDismissRequest = { moveTime = false }, title = { Text("Cambiar hora") },
      text = { TimeInput(state = state) },
      confirmButton = { TextButton(onClick = {
        action("move", selected.toList(), String.format(Locale.ROOT, "%02d:%02d", state.hour, state.minute))
        selected = emptySet(); moveTime = false
      }) { Text("Guardar") } }, dismissButton = { TextButton(onClick = { moveTime = false }) { Text("Cancelar") } })
  }
}

@Composable
private fun DayContent(date: LocalDate, day: JSONObject, data: JSONObject, today: LocalDate, selected: Set<String>, enabled: Boolean,
  onFood: (String) -> Unit, onLongFood: (String) -> Unit, onGroup: (List<String>) -> Unit, onAdd: (String) -> Unit, onWeight: () -> Unit) {
  val entries = remember(day) { foods(day) }
  val groups = remember(entries) { entries.groupBy { it.optString("time").substringBefore(":") } }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    item("date") { Text(date.format(dayFormat).replaceFirstChar { it.titlecase(spanish) }, style = MaterialTheme.typography.titleMedium) }
    item("summary") { NutritionSummary(day, data.optJSONObject("colors") ?: JSONObject()) }
    if (data.optBoolean("showWeight")) item("weight") {
      val hasWeight = !day.isNull("weight") && day.optString("weight").isNotEmpty()
      OutlinedCard(onClick = onWeight, enabled = enabled && date <= today, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
          Text("Peso del día", color = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(if (hasWeight) day.optString("weight") else if (date > today) "Fecha futura" else "+ Registrar", fontWeight = FontWeight.SemiBold)
        }
      }
    }
    val error = data.optJSONObject("weightError")
    if (error?.optString("dateId") == date.toString()) item("weightError") { Text(error.optString("message"), color = MaterialTheme.colorScheme.error) }
    if (entries.isEmpty()) item("empty") {
      Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Un día por registrar", style = MaterialTheme.typography.titleLarge)
        Text("Añade tu primera comida.", Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    groups.forEach { (hour, group) ->
      item("hour-$hour") {
        val ids = group.map { it.optString("id") }
        Row(Modifier.fillMaxWidth().combinedClickable(enabled = enabled,
          onClick = { if (selected.isNotEmpty()) onGroup(ids) }, onLongClick = { onGroup(ids) })
          .padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
          Text("$hour:00", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
          if (selected.isNotEmpty()) TextButton(onClick = { onGroup(ids) }, enabled = enabled) { Text(if (ids.all { it in selected }) "Quitar grupo" else "Seleccionar grupo") }
          else TextButton(onClick = { onAdd("$hour:00") }, enabled = enabled, modifier = Modifier.semantics { contentDescription = "Registrar alimento a las $hour horas" }) { Text("+ Añadir") }
        }
      }
      items(group, key = { "food-${it.optString("id")}" }, contentType = { "food" }) { food ->
        val id = food.optString("id")
        val chosen = id in selected
        Surface(shape = RoundedCornerShape(12.dp), color = if (chosen) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surface,
          modifier = Modifier.fillMaxWidth().combinedClickable(enabled = enabled, onClick = { onFood(id) }, onLongClick = { onLongFood(id) })
            .semantics(mergeDescendants = true) { this.selected = chosen; if (selected.isNotEmpty()) role = Role.Checkbox }) {
          Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            if (selected.isNotEmpty()) Checkbox(checked = chosen, onCheckedChange = null, modifier = Modifier.padding(end = 8.dp))
            Column(Modifier.weight(1f)) {
              Text(food.optString("name"), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
              Text("${food.optString("time")} · ${food.optString("portion")}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
              Text(food.optString("macros"), Modifier.padding(top = 6.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(Modifier.padding(start = 12.dp), horizontalAlignment = Alignment.End) {
              Text(food.optString("calories"), fontWeight = FontWeight.SemiBold, fontSize = 20.sp)
              Text("kcal", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
    }
    item("hint") { if (entries.isNotEmpty()) Text("Mantén pulsado un alimento para seleccionar varios.", Modifier.padding(vertical = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
  }
}

@Composable
private fun NutritionSummary(day: JSONObject, colors: JSONObject) {
  Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
    Row(verticalAlignment = Alignment.Bottom) {
      Text(day.optString("calories", "0"), fontSize = 40.sp, fontWeight = FontWeight.SemiBold)
      Text(" / ${day.optString("target", "2200")} kcal", Modifier.padding(start = 8.dp, bottom = 6.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    LinearProgressIndicator(progress = { day.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
    val macros = day.optJSONArray("macros")
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      if (macros != null) repeat(macros.length()) { index ->
        val macro = macros.getJSONObject(index)
        Column(Modifier.weight(1f).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(8.dp)).padding(8.dp)) {
          Text(macro.optString("name"), style = MaterialTheme.typography.labelSmall, color = color(colors, macro.optString("color"), MaterialTheme.colorScheme.onSurfaceVariant))
          Text("${macro.optString("value")} g", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Text("/${macro.optString("target")} g", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}
