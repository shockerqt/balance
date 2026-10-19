package expo.modules.balancedailylog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import org.json.JSONObject
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter

@Composable internal fun WireNavigation(destination: Int, enabled: Boolean, onSelect: (Int) -> Unit, onAdd: () -> Unit) {
  Row(Modifier.fillMaxWidth().heightIn(min = 68.dp), verticalAlignment = Alignment.CenterVertically) {
    listOf("Alimentos", "Mediciones", "+", "Resumen", "Perfil").forEachIndexed { index, label ->
      val target = if (index > 2) index - 1 else index
      if (index == 2) Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
        FilledIconButton(onClick = onAdd, enabled = enabled, modifier = Modifier.size(48.dp).semantics { contentDescription = "Registrar alimento o peso" }) { Icon(WireIcons.Add, null) }
      } else NavigationBarItem(selected = destination == target, onClick = { onSelect(target) }, enabled = enabled,
        icon = { Icon(listOf(WireIcons.Diary, WireIcons.Measurements, WireIcons.Add, WireIcons.Summary, WireIcons.Profile)[index], null) },
        label = { Text(label, fontSize = 9.sp, maxLines = 1) }, alwaysShowLabel = true,
        colors = NavigationBarItemDefaults.colors(selectedIconColor = MaterialTheme.colorScheme.primary,
          selectedTextColor = MaterialTheme.colorScheme.onSurface, indicatorColor = MaterialTheme.colorScheme.primaryContainer,
          unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant, unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant))
    }
  }
}

@Composable internal fun WireDestination(destination: Int, data: JSONObject, enabled: Boolean, measurementDate: String,
  onMeasurementDate: (String) -> Unit, onWeight: () -> Unit,
  onOpenDate: (LocalDate, Boolean) -> Unit, onAction: (String, Map<String, Any>) -> Unit) {
  when (destination) {
    1 -> WireMeasurements(data, enabled, measurementDate, onMeasurementDate, onWeight)
    2 -> WireSummary(data, enabled, onOpenDate)
    3 -> WireProfile(data, enabled, onAction)
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun WireMeasurements(data: JSONObject, enabled: Boolean, selected: String, onDate: (String) -> Unit, onWeight: () -> Unit) {
  val date = LocalDate.parse(selected)
  val today = LocalDate.parse(data.getString("today"))
  var monthText by rememberSaveable { mutableStateOf(YearMonth.from(date).toString()) }
  var picker by remember { mutableStateOf(false) }
  val month = YearMonth.parse(monthText)
  val days = data.optJSONObject("days") ?: JSONObject()
  LaunchedEffect(selected) { monthText = YearMonth.from(date).toString() }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(WireSpace.Page), verticalArrangement = Arrangement.spacedBy(WireSpace.Page)) {
    item { Text("Mediciones", style = MaterialTheme.typography.headlineSmall); Text("Peso", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    if (!data.optBoolean("showWeight")) item {
      Text("El seguimiento de peso está desactivado. Puedes activarlo en Perfil.")
    } else {
      item {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = { val first = month.minusMonths(1).atDay(1); monthText = YearMonth.from(first).toString(); onDate(first.toString()) }, enabled = enabled && month.year > 1900,
            modifier = Modifier.semantics { contentDescription = "Mes anterior" }) { Icon(WireIcons.Left, null) }
          TextButton(onClick = { picker = true }, enabled = enabled, modifier = Modifier.weight(1f)) { Text(month.format(DateTimeFormatter.ofPattern("MMMM yyyy", wireLocale))) }
          IconButton(onClick = { val first = month.plusMonths(1).atDay(1); monthText = YearMonth.from(first).toString(); onDate(first.toString()) }, enabled = enabled && month.year < 9998,
            modifier = Modifier.semantics { contentDescription = "Mes siguiente" }) { Icon(WireIcons.Right, null) }
        }
        Row(Modifier.fillMaxWidth()) { listOf("L", "M", "M", "J", "V", "S", "D").forEach { Text(it, modifier = Modifier.weight(1f).wrapContentWidth(), style = MaterialTheme.typography.labelSmall) } }
        val offset = month.atDay(1).dayOfWeek.value - 1
        repeat((offset + month.lengthOfMonth() + 6) / 7) { week ->
          Row(Modifier.fillMaxWidth()) {
            repeat(7) { weekday ->
              val number = week * 7 + weekday - offset + 1
              if (number !in 1..month.lengthOfMonth()) Spacer(Modifier.weight(1f).height(48.dp))
              else {
                val candidate = month.atDay(number)
                val recorded = days.optJSONObject(candidate.toString())?.isNull("weightKg") == false
                Surface(onClick = { onDate(candidate.toString()) }, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics {
                  contentDescription = "${wireLongDate(candidate)}, ${if (recorded) "con peso registrado" else "sin peso registrado"}"
                  this.selected = candidate == date
                }, shape = MaterialTheme.shapes.small,
                  contentColor = if (candidate == date) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                  color = if (candidate == date) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.background) {
                  Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(number.toString()); Text(if (recorded) "•" else " ", fontSize = 9.sp)
                  }
                }
              }
            }
          }
        }
        Text("• Peso registrado", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      item {
        val day = days.optJSONObject(selected)
        val hasWeight = day != null && !day.isNull("weightKg")
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
          Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(wireDate(date), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(if (hasWeight) "${wireNumber(day!!.optDouble("weightKg"))} kg" else "Sin peso registrado", style = MaterialTheme.typography.headlineSmall)
            Button(onClick = onWeight, enabled = enabled && date <= today) { Text(if (hasWeight) "Editar peso" else "Registrar peso") }
            if (date > today) Text("Elige hoy o una fecha anterior para registrar peso.", style = MaterialTheme.typography.bodySmall)
          }
        }
      }
      val error = data.optJSONObject("weightError")
      if (error != null) item { Text(error.optString("message"), color = MaterialTheme.colorScheme.error) }
    }
  }
  if (picker && enabled) {
    val state = rememberDatePickerState(initialSelectedDateMillis = DailyLogDates.utcMillis(date), yearRange = 1900..9999)
    DatePickerDialog(onDismissRequest = { picker = false }, confirmButton = { TextButton(onClick = {
      state.selectedDateMillis?.let { onDate(DailyLogDates.fromUtcMillis(it).toString()) }; picker = false
    }) { Text("Elegir fecha") } }, dismissButton = { TextButton(onClick = { picker = false }) { Text("Cancelar") } }) { DatePicker(state) }
  }
}

@Composable internal fun WireWeightDialog(date: LocalDate, data: JSONObject, onDismiss: () -> Unit, onAction: (String, Map<String, Any>) -> Unit) {
  val day = data.optJSONObject("days")?.optJSONObject(date.toString())
  val existing = day != null && !day.isNull("weightKg")
  var quantity by rememberSaveable(date.toString()) { mutableStateOf(if (existing) wireNumber(day!!.optDouble("weightKg")) else "") }
  var error by remember { mutableStateOf("") }
  var deleting by remember { mutableStateOf(false) }
  val allowed = date <= LocalDate.parse(data.optString("today")) && data.optBoolean("showWeight")
  AlertDialog(onDismissRequest = onDismiss, title = { Text(if (existing) "Editar peso" else "Registrar peso") }, text = {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(wireDate(date))
      OutlinedTextField(quantity, { quantity = it }, label = { Text("Peso en kg") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
      Text("De 1 a 500 kg · precisión de 0,1 kg", style = MaterialTheme.typography.bodySmall)
      if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
      if (existing) TextButton(onClick = { deleting = true }, enabled = allowed) { Text("Eliminar peso", color = MaterialTheme.colorScheme.error) }
    }
  }, confirmButton = { TextButton(onClick = {
    if (allowed && WireframeModel.weightGrams(quantity) != null) onAction("weight-save", mapOf("quantity" to quantity))
    else error = "Revisa el peso y la fecha."
  }, enabled = allowed) { Text("Guardar") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } })
  if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("¿Eliminar el peso del ${wireDate(date)}?") },
    confirmButton = { TextButton(onClick = { onAction("weight-delete", emptyMap()) }) { Text("Eliminar") } },
    dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancelar") } })
}

@Composable private fun WireProfile(data: JSONObject, enabled: Boolean, onAction: (String, Map<String, Any>) -> Unit) {
  val profile = data.optJSONObject("profile") ?: JSONObject()
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(WireSpace.Page), verticalArrangement = Arrangement.spacedBy(WireSpace.Section)) {
    item { Text("Perfil", style = MaterialTheme.typography.headlineSmall) }
    item {
      Text(profile.optString("name"), style = MaterialTheme.typography.titleLarge)
      Text(if (profile.optBoolean("guest")) "Datos en este dispositivo" else "Cuenta conectada", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    item { HorizontalDivider(); Text("Preferencias", Modifier.padding(top = 16.dp), style = MaterialTheme.typography.titleMedium) }
    item {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text("Seguimiento de peso"); Text("Conserva el historial al desactivar", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Switch(data.optBoolean("showWeight"), { onAction("preference", mapOf("enabled" to it)) }, enabled = enabled && data.optBoolean("preferencesReady"))
      }
      if (!data.isNull("preferencesError")) Text(data.optString("preferencesError"), color = MaterialTheme.colorScheme.error)
    }
    item { Text("Unidades", style = MaterialTheme.typography.titleMedium); Text("Peso: kg · Alimentos: g / ml · Energía: kcal", Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        WireToolRow("Administrar biblioteca", WireIcons.Diary, enabled) { onAction("library", emptyMap()) }
        HorizontalDivider(Modifier.padding(horizontal = WireSpace.Page))
        WireToolRow("Importar MacroFactor", WireIcons.Import, enabled) { onAction("import", emptyMap()) }
        HorizontalDivider(Modifier.padding(horizontal = WireSpace.Page))
        WireToolRow("Cuenta y configuración", WireIcons.Settings, enabled) { onAction("settings", emptyMap()) }
      }
    }
  }
}

@Composable private fun WireToolRow(label: String, icon: ImageVector, enabled: Boolean, click: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  val content = if (enabled) colors.onSurface else colors.onSurface.copy(alpha = 0.38f)
  val secondary = if (enabled) colors.onSurfaceVariant else colors.onSurfaceVariant.copy(alpha = 0.38f)
  Surface(onClick = click, enabled = enabled, color = Color.Transparent, modifier = Modifier.semantics { role = Role.Button }) {
    ListItem(headlineContent = { Text(label, style = MaterialTheme.typography.labelLarge, color = content) }, leadingContent = { Icon(icon, null, tint = secondary) },
      trailingContent = { Icon(WireIcons.Right, null, Modifier.size(18.dp), tint = secondary) },
      colors = ListItemDefaults.colors(containerColor = Color.Transparent))
  }
}
