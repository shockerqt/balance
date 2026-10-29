package expo.modules.balancedailylog

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
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
  Row(Modifier.testTag("organic-navigation").fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(start = 8.dp, end = 8.dp, top = 14.dp, bottom = 16.dp), verticalAlignment = Alignment.CenterVertically) {
    val icons = listOf(WireIcons.Diary, WireIcons.Measurements, WireIcons.Add, WireIcons.Summary, WireIcons.Profile)
    listOf("Alimentos", "Mediciones", "+", "Resumen", "Perfil").forEachIndexed { index, label ->
      val target = if (index > 2) index - 1 else index
      if (index == 2) Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
        FilledIconButton(onClick = onAdd, enabled = enabled, colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.Transparent, contentColor = MaterialTheme.colorScheme.onPrimary), shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 10.dp, bottomStart = 22.dp), modifier = Modifier.size(56.dp).background(LocalOrganicGradients.current.action, RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 10.dp, bottomStart = 22.dp)).semantics { contentDescription = "Registrar alimento o peso" }) { Icon(WireIcons.Add, null, Modifier.size(24.dp)) }
      } else Surface(onClick = { onSelect(target) }, enabled = enabled, color = Color.Transparent,
        modifier = Modifier.weight(1f).semantics { selected = destination == target; role = Role.Tab }) {
        Column(Modifier.heightIn(min = 58.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
          Box(Modifier.background(if (destination == target) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent, RoundedCornerShape(16.dp)).padding(horizontal = 15.dp, vertical = 5.dp), contentAlignment = Alignment.Center) {
            Icon(icons[index], null, Modifier.size(20.dp), tint = if (destination == target) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
          }
          Text(label, fontSize = 10.sp, maxLines = 1, color = if (destination == target) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = if (destination == target) FontWeight.SemiBold else FontWeight.Normal)
        }
      }
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
  Column(Modifier.fillMaxSize()) {
  WirePageHeader("Mediciones", "Peso")
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(WireSpace.Page), verticalArrangement = Arrangement.spacedBy(WireSpace.Page)) {
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
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
          Text(wireLongDate(date), fontFamily = MaterialTheme.typography.titleLarge.fontFamily, fontSize = 18.sp)
          if (hasWeight) Surface(onClick = onWeight, enabled = enabled && date <= today, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Editar peso" }) {
            Row(Modifier.heightIn(min = 64.dp).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              Text("Peso", modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
              Text("${wireNumber(day!!.optDouble("weightKg"))} kg", fontSize = 24.sp, fontFamily = MaterialTheme.typography.titleLarge.fontFamily, color = MaterialTheme.colorScheme.primary)
              Icon(WireIcons.Right, null, Modifier.size(16.dp))
            }
          } else {
            Text("Sin peso registrado este día.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            FilledTonalButton(onClick = onWeight, enabled = enabled && date <= today) { Text("Registrar peso") }
            if (date > today) Text("Elige hoy o una fecha anterior para registrar peso.", style = MaterialTheme.typography.bodySmall)
          }
        }
      }
      val error = data.optJSONObject("weightError")
      if (error != null) item { Text(error.optString("message"), color = MaterialTheme.colorScheme.error) }
    }
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
      TextField(quantity, { quantity = it }, label = { Text("Peso en kg") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
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
  Column(Modifier.fillMaxSize()) {
  WirePageHeader("Perfil", "Tu cuenta y tus herramientas")
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(WireSpace.Page), verticalArrangement = Arrangement.spacedBy(WireSpace.Section)) {
    item {
      Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(Modifier.size(56.dp).background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(20.dp)), contentAlignment = Alignment.Center) { Icon(WireIcons.Profile, null, Modifier.size(28.dp)) }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text(profile.optString("name"), style = MaterialTheme.typography.titleLarge)
          Text(if (profile.optBoolean("guest")) "Datos en este dispositivo" else "Cuenta conectada", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        }
      }
    }
    item {
      OrganicSection("Preferencias") {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Seguimiento de peso", fontSize = 13.sp)
            Text("Tu historial se conserva al desactivar", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          Switch(data.optBoolean("showWeight"), { onAction("preference", mapOf("enabled" to it)) }, enabled = enabled && data.optBoolean("preferencesReady"))
        }
        if (!data.isNull("preferencesError")) Text(data.optString("preferencesError"), color = MaterialTheme.colorScheme.error)
        Text("kg · g / ml · kcal", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    item {
      OrganicSection("Herramientas") {
        WireToolRow("Biblioteca", WireIcons.Diary, enabled) { onAction("library", emptyMap()) }
        WireToolRow("Importar MacroFactor", WireIcons.Import, enabled) { onAction("import", emptyMap()) }
        WireToolRow("Cuenta y configuración", WireIcons.Settings, enabled) { onAction("settings", emptyMap()) }
      }
    }
  }
}
}

@Composable private fun WireToolRow(label: String, icon: ImageVector, enabled: Boolean, click: () -> Unit) {
  val colors = MaterialTheme.colorScheme
  val content = if (enabled) colors.onSurface else colors.onSurface.copy(alpha = 0.38f)
  val secondary = if (enabled) colors.onSurfaceVariant else colors.onSurfaceVariant.copy(alpha = 0.38f)
  Surface(onClick = click, enabled = enabled, color = Color.Transparent, modifier = Modifier.semantics { role = Role.Button }) {
    ListItem(headlineContent = { Text(label, style = MaterialTheme.typography.labelLarge, color = content) },
      trailingContent = { Icon(WireIcons.Right, null, Modifier.size(18.dp), tint = secondary) },
      colors = ListItemDefaults.colors(containerColor = Color.Transparent))
  }
}

@Composable internal fun WirePageHeader(title: String, subtitle: String? = null) {
  Column(Modifier.fillMaxWidth().background(LocalOrganicGradients.current.header).padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Text(title, fontFamily = MaterialTheme.typography.titleLarge.fontFamily, fontSize = 28.sp, fontWeight = FontWeight.Medium)
    if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable internal fun OrganicSegments(labels: List<String>, selected: Int, enabled: Boolean, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
    labels.forEachIndexed { i, label ->
      Surface(onClick = { onSelect(i) }, enabled = enabled, color = if (i == selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainer,
        shape = if (i == selected) RoundedCornerShape(24.dp) else RoundedCornerShape(topStart = if (i == 0) 24.dp else 5.dp, bottomStart = if (i == 0) 24.dp else 5.dp, topEnd = if (i == labels.lastIndex) 24.dp else 5.dp, bottomEnd = if (i == labels.lastIndex) 24.dp else 5.dp), modifier = Modifier.weight(1f).semantics { this.selected = i == selected; role = Role.Tab }) {
        Box(Modifier.heightIn(min = 44.dp).padding(horizontal = 8.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
          Text(label, fontSize = 13.sp, fontWeight = if (i == selected) FontWeight.SemiBold else FontWeight.Normal, textDecoration = if (i == selected) androidx.compose.ui.text.style.TextDecoration.Underline else null, color = if (i == selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}

@Composable internal fun OrganicSection(title: String, content: @Composable ColumnScope.() -> Unit) {
  Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      Text(title, fontSize = 18.sp, fontFamily = MaterialTheme.typography.titleLarge.fontFamily, fontWeight = FontWeight.Medium)
      content()
    }
  }
}
