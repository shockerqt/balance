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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoComposeView
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.ComposableScope
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import org.json.JSONObject

class BalanceDailyLogView(context: Context, appContext: AppContext) : ExpoComposeView<ComposeProps>(context, appContext, withHostingView = true) {
  private val onAction by EventDispatcher()
  internal val active = mutableStateOf(false)
  private val data = mutableStateOf(JSONObject())
  private val command = mutableStateOf(DateCommand(LocalDate.now(), false, CommandToken("", 0)))
  private var sequence = 0L
  private var session = ""

  @Composable
  override fun ComposableScope.Content() {
    val snapshot = data.value
    val renderSession = snapshot.optString("session")
    val colors = snapshot.optJSONObject("colors") ?: JSONObject()
    val background = color(colors, "background", Color(0xFF101820))
    WireframeTheme(colors) {
      Surface(modifier = Modifier.fillMaxSize(), color = background,
        contentColor = MaterialTheme.colorScheme.onSurface) {
        DailyLog(snapshot, command.value, active.value,
          { action, date, ids, time, revision -> if (session == renderSession) emit(action, date, ids, time, revision) },
          { action, date, ids, time, revision, input -> if (session == renderSession) emitExtra(action, date, ids, time, revision, input) })
      }
    }
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
    command.value = DateCommand(date, parsed.optBoolean("fromNative"), CommandToken(parsed.optString("session"), parsed.optLong("revision")))
  }
  private fun emit(action: String, date: LocalDate, ids: List<String>, time: String?, revision: Long) {
    emitExtra(action, date, ids, time, revision, emptyMap())
  }
  private fun emitExtra(action: String, date: LocalDate, ids: List<String>, time: String?, revision: Long, input: Map<String, Any>) {
    if (!active.value || session.isEmpty() || command.value.token.session != session) return
    sequence += 1
    val event = mutableMapOf<String, Any>("session" to session, "sequence" to sequence, "commandRevision" to revision, "action" to action, "date" to date.toString())
    if (ids.isNotEmpty()) event["ids"] = ids
    if (time != null) event["time"] = time
    if (input.isNotEmpty()) event["input"] = input
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
  emit: (String, LocalDate, List<String>, String?, Long) -> Unit,
  emitExtra: (String, LocalDate, List<String>, String?, Long, Map<String, Any>) -> Unit) {
  val pager = rememberPagerState(initialPage = DailyLogDates.page(command.date)) { DailyLogDates.count }
  val scope = rememberCoroutineScope()
  var destination by rememberSaveable { mutableIntStateOf(0) }
  var registering by remember { mutableStateOf(false) }
  var measurementDate by rememberSaveable { mutableStateOf(command.date.toString()) }
  var weightDialog by remember { mutableStateOf(false) }
  val destinations = rememberSaveableStateHolder()
  val latestEmit by rememberUpdatedState(emit)
  val latestActive by rememberUpdatedState(active)
  var appliedCommand by remember { mutableStateOf<CommandToken?>(null) }
  val latestCommand by rememberUpdatedState(command)
  val settled = DailyLogDates.date(pager.settledPage)
  val visible = DailyLogDates.date(pager.currentPage)
  val today = DailyLogDates.parse(data.optString("today")) ?: LocalDate.now()
  val days = data.optJSONObject("days") ?: JSONObject()
  val empty = data.optJSONObject("empty") ?: JSONObject()
  var selected by remember { mutableStateOf(setOf<String>()) }
  var selectionDate by remember { mutableStateOf(settled) }
  var calendar by remember { mutableStateOf(false) }
  var nutrition by remember { mutableStateOf(false) }
  var deleteConfirmation by remember { mutableStateOf(false) }
  var moveTime by remember { mutableStateOf(false) }
  val settledDay = days.optJSONObject(settled.toString()) ?: empty
  val available = foods(settledDay).map { it.optString("id") }.toSet()
  val pendingCommand = command.token != appliedCommand
  val locked = pager.isScrollInProgress || pendingCommand || !active

  // Native acknowledgements never animate the pager backwards after a newer
  // swipe. Only an external date command controls it from JavaScript.
  LaunchedEffect(command) {
    if (!command.fromNative) {
      selected = emptySet()
      deleteConfirmation = false
      moveTime = false
      if (pager.isScrollInProgress || DailyLogDates.page(command.date) != pager.settledPage) {
        // A save from a secondary tool may return while another destination is
        // shown. Attach the pager before awaiting its first layout/scroll.
        measurementDate = command.date.toString()
        destination = 0
        pager.scrollToPage(DailyLogDates.page(command.date))
      }
      appliedCommand = command.token
    }
  }
  LaunchedEffect(pager) {
    snapshotFlow { PageSettlement(pager.settledPage, pager.isScrollInProgress, appliedCommand, latestActive) }.distinctUntilChanged().collect { settlement ->
      if (settlement.canEmit(latestCommand)) {
        latestEmit("date", DailyLogDates.date(settlement.page), emptyList(), null, settlement.applied!!.revision)
      }
    }
  }
  LaunchedEffect(settled, available, active) {
    selected = if (selectionDate != settled || !active) emptySet() else selected.intersect(available)
    selectionDate = settled
    if (!active) { nutrition = false; calendar = false; deleteConfirmation = false; moveTime = false; registering = false; weightDialog = false }
  }
  // Calendar and food pages represent one selected day. The pager stays native;
  // a hidden calendar selection is applied when the food destination is shown.
  LaunchedEffect(settled) { measurementDate = settled.toString() }
  BackHandler(active && destination != 0) {
    destination = 0
    scope.launch { pager.scrollToPage(DailyLogDates.page(LocalDate.parse(measurementDate))) }
  }
  BackHandler(active && selected.isNotEmpty()) { selected = emptySet() }
  fun action(kind: String, ids: List<String> = emptyList(), time: String? = null) {
    if (!locked && pager.currentPage == pager.settledPage) emit(kind, settled, ids, time, appliedCommand!!.revision)
  }
  fun go(date: LocalDate) {
    if (!locked && selected.isEmpty()) scope.launch { pager.animateScrollToPage(DailyLogDates.page(date)) }
  }

  Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
    if (destination == 0) {
    destinations.SaveableStateProvider(0) {
    WireDiaryHeader(visible, today, days, empty, !locked && selected.isEmpty(), { go(it) }, { calendar = true }, { nutrition = true })
    HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth(),
      beyondViewportPageCount = 1, userScrollEnabled = active && !pendingCommand && selected.isEmpty(), key = { it }) { page ->
      val date = DailyLogDates.date(page)
      val day = days.optJSONObject(date.toString()) ?: empty
      DayContent(date, day, data, today, selected, enabled = active && page == pager.settledPage && !locked,
        onFood = { id ->
          if (selected.isEmpty()) action("edit", listOf(id)) else selected = if (id in selected) selected - id else selected + id
        },
        onLongFood = { id -> selected = selected + id; selectionDate = date },
        onGroup = { ids ->
          selected = if (ids.all { it in selected }) selected - ids.toSet() else selected + ids
          selectionDate = date
        },
        onAdd = { time -> action("add", time = time) },
        onEdit = { food, quantity, mode, time ->
          if (!locked) emitExtra("edit-save", date, listOf(food.optString("id")), time, appliedCommand!!.revision,
            mapOf("quantity" to quantity, "mode" to mode, "revision" to food.optLong("revision")))
        })
    }
    }
    } else {
      Box(Modifier.weight(1f).fillMaxWidth()) {
        destinations.SaveableStateProvider(destination) {
          WireDestination(destination, data, active && !locked, measurementDate,
            onMeasurementDate = { measurementDate = it },
            onWeight = { weightDialog = true },
            onOpenDate = { date, body ->
              measurementDate = date.toString()
              if (body) { destination = 1 }
              else { destination = 0; scope.launch { pager.scrollToPage(DailyLogDates.page(date)) } }
            },
            onAction = { kind, input -> if (!locked) emitExtra(kind, settled, emptyList(), null, appliedCommand!!.revision, input) })
        }
      }
    }
    Surface(color = MaterialTheme.colorScheme.surface) {
      if (selected.isEmpty()) {
        WireNavigation(destination, !locked, onSelect = {
          destination = it
          if (it == 0) scope.launch { pager.scrollToPage(DailyLogDates.page(LocalDate.parse(measurementDate))) }
        }, onAdd = { registering = true })
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
  if (registering && active) ModalBottomSheet(onDismissRequest = { registering = false }) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text("Registrar", style = MaterialTheme.typography.titleLarge)
      Text(wireLongDate(LocalDate.parse(measurementDate)), color = MaterialTheme.colorScheme.onSurfaceVariant)
      OrganicButton(onClick = {
        registering = false; destination = 0
        val target = LocalDate.parse(measurementDate)
        scope.launch { pager.scrollToPage(DailyLogDates.page(target)) }
        emitExtra("register", target, emptyList(), null, appliedCommand!!.revision, emptyMap())
      }, modifier = Modifier.fillMaxWidth()) { Text("Alimento") }
      OutlinedButton(onClick = { registering = false; weightDialog = true },
        enabled = data.optBoolean("showWeight"), modifier = Modifier.fillMaxWidth()) { Text("Peso") }
      if (!data.optBoolean("showWeight")) Text("Activa el seguimiento de peso en Perfil.", style = MaterialTheme.typography.bodySmall)
      Spacer(Modifier.height(24.dp))
    }
  }
  if (weightDialog && active) WireWeightDialog(LocalDate.parse(measurementDate), data, onDismiss = { weightDialog = false }) { kind, input ->
    if (!locked) emitExtra(kind, LocalDate.parse(measurementDate), emptyList(), null, appliedCommand!!.revision, input)
    weightDialog = false
  }
  if (nutrition && active) WireNutritionSheet(visible, days.optJSONObject(visible.toString()) ?: empty) { nutrition = false }
  if (calendar) {
    val state = rememberDatePickerState(initialSelectedDateMillis = DailyLogDates.utcMillis(settled), yearRange = 1900..9999)
    DatePickerDialog(onDismissRequest = { calendar = false },
      confirmButton = { OrganicButton(onClick = {
        state.selectedDateMillis?.let { go(DailyLogDates.fromUtcMillis(it)) }; calendar = false
      }, enabled = state.selectedDateMillis != null) { Text("Ir al día") } },
      dismissButton = { FilledTonalButton(modifier = Modifier.heightIn(min = 48.dp), shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp), onClick = { calendar = false }) { Text("Cancelar") } }) {
      DatePicker(state = state, title = { Text("Elegir fecha", Modifier.padding(24.dp)) })
    }
  }
  if (deleteConfirmation) AlertDialog(containerColor = MaterialTheme.colorScheme.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(28.dp), onDismissRequest = { deleteConfirmation = false },
    title = { Text("Eliminar ${selected.size} registros") },
    text = { Text("Se eliminarán los alimentos seleccionados de este día.") },
    confirmButton = { OrganicButton(onClick = { action("delete", selected.toList()); selected = emptySet(); deleteConfirmation = false }) { Text("Eliminar") } },
    dismissButton = { FilledTonalButton(modifier = Modifier.heightIn(min = 48.dp), shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp), onClick = { deleteConfirmation = false }) { Text("Cancelar") } })
  if (moveTime) {
    val firstTime = foods(settledDay).firstOrNull { it.optString("id") in selected }?.optString("time") ?: "12:00"
    val state = rememberTimePickerState(initialHour = firstTime.substringBefore(":").toIntOrNull() ?: 12,
      initialMinute = firstTime.substringAfter(":").toIntOrNull() ?: 0, is24Hour = true)
    AlertDialog(containerColor = MaterialTheme.colorScheme.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(28.dp), onDismissRequest = { moveTime = false }, title = { Text("Cambiar hora") },
      text = { TimeInput(state = state) },
      confirmButton = { OrganicButton(onClick = {
        action("move", selected.toList(), String.format(Locale.ROOT, "%02d:%02d", state.hour, state.minute))
        selected = emptySet(); moveTime = false
      }) { Text("Guardar") } }, dismissButton = { FilledTonalButton(modifier = Modifier.heightIn(min = 48.dp), shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp), onClick = { moveTime = false }) { Text("Cancelar") } })
  }
}
