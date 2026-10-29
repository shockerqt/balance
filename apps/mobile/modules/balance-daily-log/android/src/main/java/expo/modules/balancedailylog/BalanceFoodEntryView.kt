package expo.modules.balancedailylog

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoComposeView
import expo.modules.kotlin.views.ComposeProps
import expo.modules.kotlin.views.ComposableScope
import org.json.JSONObject
import org.json.JSONArray
import java.time.LocalDate
import java.util.Locale
import java.text.Normalizer

class BalanceFoodEntryView(context: Context, appContext: AppContext) : ExpoComposeView<ComposeProps>(context, appContext, withHostingView = true) {
  private val onAction by EventDispatcher()
  internal val active = mutableStateOf(false)
  private val data = mutableStateOf(JSONObject())
  private val status = mutableStateOf(JSONObject())
  private var sequence = 0L
  private var session = ""
  fun setData(value: String) {
    val parsed = runCatching { JSONObject(value) }.getOrNull() ?: return
    if (session != parsed.optString("session")) { session = parsed.optString("session"); sequence = 0 }
    data.value = parsed
  }
  fun setStatus(value: String) { status.value = runCatching { JSONObject(value) }.getOrDefault(JSONObject()) }
  @Composable override fun ComposableScope.Content() {
    val snapshot = data.value
    val renderSession = snapshot.optString("session")
    val colors = snapshot.optJSONObject("colors") ?: JSONObject()
    WireframeTheme(colors) {
      // Focus nonces invalidate callbacks; the route draft survives focus changes.
      key(snapshot.optString("draftId", renderSession)) {
        FoodEntryScreen(snapshot, status.value, active.value) { action, input ->
          if (active.value && session.isNotEmpty() && session == renderSession) {
            sequence += 1
            onAction(mapOf("session" to session, "sequence" to sequence, "action" to action, "input" to (input?.toString() ?: "")))
          }
        }
      }
    }
  }
}
private fun objects(array: JSONArray?): List<JSONObject> = if (array == null) emptyList() else
  (0 until array.length()).mapNotNull { array.optJSONObject(it) }
private fun textNutrition(n: JSONObject, key: String): String = if (n.isNull(key)) "" else n.optDouble(key).toString()

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable private fun FoodEntryScreen(data: JSONObject, status: JSONObject, active: Boolean, emit: (String, JSONObject?) -> Unit) {
  val templates = remember(data) { objects(data.optJSONArray("templates")).filter { !it.optBoolean("_deleted") }.sortedBy { it.optString("name").lowercase(Locale.ROOT) } }
  val fields = remember(data) { objects(data.optJSONArray("nutrientFields")) }
  var query by rememberSaveable { mutableStateOf("") }
  var editing by rememberSaveable { mutableStateOf(false) }
  var filter by rememberSaveable { mutableStateOf("all") }
  var labelBasis by rememberSaveable { mutableStateOf("per100") }
  var labelSize by rememberSaveable { mutableStateOf("100") }
  var discardToLabel by remember { mutableStateOf(false) }
  // Store the selected revision with the draft. A later catalogue refresh must
  // not silently change the historical snapshot being reviewed.
  var chosenJson by rememberSaveable { mutableStateOf("") }
  val chosen = remember(chosenJson) { if (chosenJson.isEmpty()) null else JSONObject(chosenJson) }
  var name by rememberSaveable { mutableStateOf("") }
  var unit by rememberSaveable { mutableStateOf("g") }
  var quantity by rememberSaveable { mutableStateOf("100") }
  var portionId by rememberSaveable { mutableStateOf("") }
  var nutrientsJson by rememberSaveable { mutableStateOf("{}") }
  val nutrients = remember(nutrientsJson) { JSONObject(nutrientsJson) }
  var date by rememberSaveable { mutableStateOf(data.optString("date")) }
  var time by rememberSaveable { mutableStateOf(data.optString("time")) }
  val dateLabel = DailyLogDates.parse(date)?.let(::wireDate) ?: "Elegir fecha"
  var dirty by rememberSaveable { mutableStateOf(false) }
  var localError by remember { mutableStateOf("") }
  var dismissedError by remember { mutableStateOf("") }
  var pending by remember { mutableStateOf(false) }
  var discard by remember { mutableStateOf(false) }
  var discardToSearch by remember { mutableStateOf(false) }
  var calendar by remember { mutableStateOf(false) }
  var clock by remember { mutableStateOf(false) }
  var optional by rememberSaveable { mutableStateOf(false) }
  var nutrientMenu by remember { mutableStateOf(false) }
  var portionMenu by remember { mutableStateOf(false) }
  var extras by rememberSaveable { mutableStateOf("") }
  val focus = LocalFocusManager.current
  val saving = pending || status.optBoolean("saving")
  val enabled = active && !saving
  LaunchedEffect(status.toString()) { if (!status.optBoolean("saving")) pending = false }
  val details = chosen?.optJSONObject("details")
  val portions = remember(chosenJson) { objects(details?.optJSONArray("portions")) }
  val portion = portions.firstOrNull { it.optString("id") == portionId }
  val canonical = FoodEntryModel.canonical(quantity, portion?.optDouble("portionQuantity") ?: 1.0, portion?.optDouble("canonicalQuantity") ?: 1.0)
  val labelFactor = if (labelBasis == "portion") FoodEntryModel.decimal(labelSize)?.takeIf { it > 0 }?.let { 100 / it }?.takeIf { it.isFinite() } else 1.0
  val nutrition = details?.optJSONObject("nutritionPer100") ?: JSONObject().apply {
    fields.forEach { field -> FoodEntryModel.decimal(nutrients.optString(field.optString("key")))?.let { n -> labelFactor?.let { factor -> (n * factor).takeIf { it.isFinite() }?.let { put(field.optString("key"), it) } } } }
  }
  val results = remember(templates, query, filter) {
    fun normalize(text: String) = Normalizer.normalize(text, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT)
    val q = normalize(query.trim())
    templates.filter { (q.isEmpty() || normalize(it.optString("name")).contains(q)) &&
      (filter == "all" || (filter == "official") == it.optBoolean("isOfficial")) }
  }
  fun labels() {
    chosenJson = ""; name = query.trim(); unit = "g"; quantity = "100"; nutrientsJson = "{}"; portionId = ""
    editing = true; dirty = false; labelBasis = "per100"; labelSize = "100"; localError = ""
  }
  fun leave() { discardToLabel = false; discardToSearch = false; if (!saving) { if (dirty) discard = true else emit("cancel", null) } }
  BackHandler(active) { leave() }
  fun pick(food: JSONObject) {
    chosenJson = food.toString(); name = food.optString("name")
    unit = food.getJSONObject("details").optString("canonicalUnit", "g")
    portionId = ""; quantity = "100"; editing = true; dirty = false; localError = ""; dismissedError = status.optString("error")
  }
  fun submit() {
    if (!enabled) return
    focus.clearFocus()
    if (!FoodEntryModel.validDateTime(date, time) || canonical == null) { localError = "Revisa la cantidad, la fecha y la hora."; return }
    if (name.trim().isEmpty() || name.codePointCount(0, name.length) > 160) { localError = "Escribe un nombre de hasta 160 caracteres."; return }
    if (chosen == null && labelFactor == null) { localError = "Indica cuántos $unit contiene la porción de la etiqueta."; return }
    if (chosen == null && fields.any { field ->
      val value = nutrients.optString(field.optString("key"))
      (field.optBoolean("required") || value.isNotBlank()) && FoodEntryModel.decimal(value) == null
    }) { localError = "Completa energía, proteínas, carbohidratos y grasas por 100 $unit. Los valores deben ser cero o mayores."; return }
    val input = JSONObject().put("date", date).put("time", time).put("quantity", quantity)
      .put("templateId", chosen?.optString("id") ?: "").put("templateRevision", chosen?.optLong("updatedAt") ?: 0)
      .put("portionId", portionId).put("name", name).put("unit", unit).put("nutrients", nutrients)
      .put("labelBasis", labelBasis).put("labelSize", labelSize)
    pending = true; localError = ""; emit("save", input)
  }
  Scaffold(modifier = Modifier.fillMaxSize().imePadding(), containerColor = MaterialTheme.colorScheme.background,
    contentWindowInsets = WindowInsets(0, 0, 0, 0),
    topBar = { Column {
      TopAppBar(modifier = Modifier.background(LocalOrganicGradients.current.header), title = { Text("Agregar alimento", fontSize = 21.sp, fontFamily = MaterialTheme.typography.titleLarge.fontFamily) },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
        navigationIcon = { IconButton(onClick = { leave() }, enabled = enabled,
          modifier = Modifier.semantics { contentDescription = "Volver al registro diario" }) { Icon(WireIcons.Back, null) } })
      Row(Modifier.fillMaxWidth().padding(horizontal = WireSpace.Page), horizontalArrangement = Arrangement.spacedBy(WireSpace.Small)) {
        TextButton(onClick = { calendar = true }, enabled = enabled, modifier = Modifier.weight(1f).semantics { contentDescription = "Fecha del consumo: $dateLabel" }) {
          Icon(WireIcons.Calendar, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
          Text(dateLabel, maxLines = 1)
        }
        TextButton(onClick = { clock = true }, enabled = enabled, modifier = Modifier.weight(1f).semantics { contentDescription = "Hora del consumo en Chile: $time" }) {
          Icon(WireIcons.Clock, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(time)
        }
      }
      OrganicSegments(listOf("Bibliotecas", "Etiquetas"), if (editing && chosen == null) 1 else 0, enabled, { target ->
        if (target == 0) {
          if (dirty) { discardToSearch = true; discardToLabel = false; discard = true } else { editing = false; chosenJson = "" }
        } else if (!(editing && chosen == null)) {
          if (dirty) { discardToLabel = true; discardToSearch = false; discard = true } else labels()
        }
      }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
    } },
    bottomBar = {
      if (editing) Surface(color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(WireSpace.Page), verticalArrangement = Arrangement.spacedBy(WireSpace.Small)) {
          val error = localError.ifEmpty { status.optString("error").takeUnless { it == dismissedError } ?: "" }
          if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.semantics { contentDescription = "Error: $error" })
          OrganicButton(onClick = { submit() }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
            if (saving) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
            Text(if (saving) "Guardando…" else "Registrar alimento")
          }
        }
      }
    }) { padding ->
    if (!editing) {
      LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(WireSpace.Page), verticalArrangement = Arrangement.spacedBy(0.dp)) {
        item("search") {
          TextField(value = query, onValueChange = { query = it }, enabled = enabled, singleLine = true,
            label = { Text("Buscar en tus alimentos") }, leadingIcon = { Icon(WireIcons.Search, null) }, modifier = Modifier.fillMaxWidth())
        }
        item("filter") {
          FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("all" to "Todas", "personal" to "Mi biblioteca", "official" to "Oficial").forEach { (key, label) ->
              FilterChip(filter == key, { filter = key }, label = { Text(label) }, enabled = enabled)
            }
          }
        }
        item("heading") {
          Text(if (query.isBlank()) "Tu biblioteca" else "${results.size} resultados", Modifier.padding(top = WireSpace.Small), style = MaterialTheme.typography.titleMedium)
        }
        if (!data.optBoolean("ready")) item("loading") { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Cargando alimentos…") }
        else if (results.isEmpty()) item("empty") { Text("No hay alimentos que coincidan. Puedes registrar uno sin guardarlo en la biblioteca.", Modifier.padding(vertical = 24.dp)) }
        items(results, key = { it.optString("id") }, contentType = { "food" }) { food ->
          val d = food.getJSONObject("details"); val n = d.getJSONObject("nutritionPer100")
          Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(0.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth().clickable(enabled) { pick(food) }) {
            Row(Modifier.heightIn(min = 80.dp).padding(horizontal = 18.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(food.optString("name"), fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Text("100 ${d.optString("canonicalUnit")} · ${if (food.optBoolean("isOfficial")) "Oficial" else "Personal"}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
              Column(horizontalAlignment = Alignment.End) {
                Text(FoodEntryModel.display(n.optDouble("calories")), fontSize = 15.sp)
                Text("kcal", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
          }
        }
      }
    } else {
      Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = WireSpace.Page, vertical = WireSpace.Medium), verticalArrangement = Arrangement.spacedBy(WireSpace.Page)) {
        TextButton(onClick = { if (dirty) { discardToSearch = true; discardToLabel = false; discard = true } else { editing = false; chosenJson = ""; localError = "" } }, enabled = enabled) { Text("Elegir otro alimento") }
        if (chosen == null) TextField(value = name, onValueChange = { name = it; dirty = true }, enabled = enabled,
          label = { Text("Nombre del alimento") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        else { Text(name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
          Text("${if (chosen.optBoolean("isOfficial")) "Oficial" else "Biblioteca personal"} · información por 100 $unit", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
          TextField(value = quantity, onValueChange = { quantity = it; dirty = true }, enabled = enabled, label = { Text("Cantidad") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true, modifier = Modifier.weight(1f))
          Box(Modifier.weight(1f)) {
            OutlinedButton(onClick = { portionMenu = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(portion?.optString("name") ?: unit) }
            DropdownMenu(expanded = portionMenu, onDismissRequest = { portionMenu = false }) {
              val units = if (chosen == null) listOf("g", "ml") else listOf(unit)
              units.forEach { option -> DropdownMenuItem(text = { Text(option) }, onClick = { if (chosen != null && portionId.isNotEmpty()) quantity = canonical?.let { FoodEntryModel.input(it) } ?: "100"; unit = option; portionId = ""; portionMenu = false; dirty = true }) }
              portions.forEach { option -> DropdownMenuItem(text = { Text(option.optString("name")) }, onClick = { portionId = option.optString("id"); quantity = FoodEntryModel.input(option.optDouble("portionQuantity")); portionMenu = false; dirty = true }) }
            }
          }
        }
        if (portion != null) Text("Equivale a ${FoodEntryModel.display(canonical)} $unit", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(color = MaterialTheme.colorScheme.surface, shape = MaterialTheme.shapes.large) {
          Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("En esta cantidad", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            fun total(key: String): Double? {
              val n = if (nutrition.isNull(key)) null else nutrition.optDouble(key).takeIf { it.isFinite() }
              return if (canonical == null || n == null) null else n * canonical / 100.0
            }
            Text("${FoodEntryModel.display(total("calories"))} kcal", fontSize = 36.sp, fontWeight = FontWeight.SemiBold)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              listOf("protein" to "Proteínas", "carbs" to "Carbos", "fat" to "Grasas").forEach { (key, label) ->
                Column { Text("${FoodEntryModel.display(total(key))} g", fontWeight = FontWeight.Medium); Text(label, style = MaterialTheme.typography.bodySmall) }
              }
            }
          }
        }
        if (chosen == null) {
          Text("Información de la etiqueta", style = MaterialTheme.typography.titleLarge)
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(labelBasis == "per100", { labelBasis = "per100"; dirty = true }, label = { Text("Por 100 $unit") }, enabled = enabled)
            FilterChip(labelBasis == "portion", { labelBasis = "portion"; dirty = true }, label = { Text("Por porción") }, enabled = enabled)
          }
          if (labelBasis == "portion") TextField(labelSize, { labelSize = it; dirty = true }, label = { Text("Tamaño de la porción en $unit") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true, modifier = Modifier.fillMaxWidth())
          Text("Transcribe los valores de esa base. Deja en blanco los nutrientes que no conozcas.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          fields.take(4).forEach { field -> NutrientInput(field, nutrients.optString(field.optString("key")), enabled) { value -> nutrientsJson = JSONObject(nutrientsJson).put(field.optString("key"), value).toString(); dirty = true } }
          TextButton(onClick = { optional = !optional }, enabled = enabled) {
            Icon(if (optional) WireIcons.Down else WireIcons.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
            Text(if (optional) "Ocultar nutrientes opcionales" else "Fibra y otros nutrientes")
          }
          if (optional) {
            fields.drop(4).take(3).forEach { field -> NutrientInput(field, nutrients.optString(field.optString("key")), enabled) { value -> nutrientsJson = JSONObject(nutrientsJson).put(field.optString("key"), value).toString(); dirty = true } }
            fields.drop(7).filter { it.optString("key") in extras.split('|') }.forEach { field -> NutrientInput(field, nutrients.optString(field.optString("key")), enabled) { value -> nutrientsJson = JSONObject(nutrientsJson).put(field.optString("key"), value).toString(); dirty = true } }
            Box {
              OutlinedButton(onClick = { nutrientMenu = true }, enabled = enabled) { Text("Añadir otro nutriente") }
              DropdownMenu(expanded = nutrientMenu, onDismissRequest = { nutrientMenu = false }, modifier = Modifier.heightIn(max = 360.dp)) {
                fields.drop(7).filter { it.optString("key") !in extras.split('|') }.forEach { field -> DropdownMenuItem(text = { Text(field.optString("label")) }, onClick = { extras += "|${field.optString("key")}"; nutrientMenu = false }) }
              }
            }
          }
        } else {
          Text("Información nutricional", style = MaterialTheme.typography.titleMedium)
          fields.forEach { field ->
            val key = field.optString("key"); val value = if (fields.indexOf(field) < 7) textNutrition(nutrition, key) else textNutrition(nutrition.optJSONObject("extendedNutrition") ?: JSONObject(), key)
            if (value.isNotEmpty()) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              Text(field.optString("label")); Text("${FoodEntryModel.display(value.toDoubleOrNull()?.let { n -> canonical?.let { n * it / 100 } })} ${field.optString("unit")}")
            }
          }
        }
        Spacer(Modifier.height(12.dp))
      }
    }
  }
  if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text("¿Descartar este registro?") },
    text = { Text("Los cambios de este alimento todavía no están guardados.") },
    confirmButton = { TextButton(onClick = { discard = false; dirty = false; editing = false; chosenJson = ""; if (discardToLabel) { labels(); discardToLabel = false } else if (!discardToSearch) emit("cancel", null) }) { Text("Descartar") } },
    dismissButton = { TextButton(onClick = { discard = false }) { Text("Seguir editando") } })
  if (calendar) {
    val picker = rememberDatePickerState(initialSelectedDateMillis = DailyLogDates.utcMillis(LocalDate.parse(date)), yearRange = 1970..9999)
    DatePickerDialog(onDismissRequest = { calendar = false }, confirmButton = { TextButton(onClick = {
      picker.selectedDateMillis?.let { date = DailyLogDates.fromUtcMillis(it).toString(); dirty = true }; calendar = false
    }, enabled = picker.selectedDateMillis != null) { Text("Elegir fecha") } }, dismissButton = { TextButton(onClick = { calendar = false }) { Text("Cancelar") } }) { DatePicker(picker) }
  }
  if (clock) {
    val picker = rememberTimePickerState(time.substringBefore(':').toInt(), time.substringAfter(':').toInt(), true)
    AlertDialog(onDismissRequest = { clock = false }, title = { Text("Hora del registro") }, text = { TimePicker(picker) },
      confirmButton = { TextButton(onClick = { time = String.format(Locale.ROOT, "%02d:%02d", picker.hour, picker.minute); dirty = true; clock = false }) { Text("Elegir hora") } },
      dismissButton = { TextButton(onClick = { clock = false }) { Text("Cancelar") } })
  }
}
@Composable private fun NutrientInput(field: JSONObject, value: String, enabled: Boolean, change: (String) -> Unit) {
  TextField(value = value, onValueChange = change, enabled = enabled, singleLine = true,
    label = { Text(field.optString("label") + if (field.optBoolean("required")) " *" else " (opcional)") },
    suffix = { Text(field.optString("unit")) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
}
