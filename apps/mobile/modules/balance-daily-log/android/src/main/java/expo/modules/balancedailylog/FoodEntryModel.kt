package expo.modules.balancedailylog

import java.math.BigDecimal
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale

internal object FoodEntryModel {
  fun decimal(value: String, positive: Boolean = false): Double? {
    val normalized = value.trim().replace(',', '.')
    if (!Regex("[0-9]+(?:\\.[0-9]+)?").matches(normalized)) return null
    val number = normalized.toDoubleOrNull() ?: return null
    return number.takeIf { it.isFinite() && if (positive) it > 0 else it >= 0 }
  }
  fun canonical(quantity: String, portionQuantity: Double = 1.0, canonicalQuantity: Double = 1.0): Double? {
    if (!portionQuantity.isFinite() || portionQuantity <= 0 || !canonicalQuantity.isFinite() || canonicalQuantity <= 0) return null
    return decimal(quantity, true)?.let { it / portionQuantity * canonicalQuantity }?.takeIf { it.isFinite() && it > 0 }
  }
  fun validDateTime(date: String, time: String): Boolean = runCatching {
    LocalDate.parse(date).year in 1970..9999 && Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]").matches(time) && LocalTime.parse(time) != null
  }.getOrDefault(false)
  fun input(value: Double): String = BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
  fun display(value: Double?): String = if (value == null || !value.isFinite()) "—" else
    String.format(Locale.forLanguageTag("es-CL"), "%.2f", value).trimEnd('0').trimEnd(',').trimEnd('.')
}
