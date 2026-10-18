package expo.modules.balancedailylog

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

internal object WireframeModel {
  fun hour(time: String): String {
    val parsed = LocalTime.parse(time)
    return "%02d:00".format(java.util.Locale.ROOT, (parsed.hour + if (parsed.minute > 30) 1 else 0).coerceAtMost(23))
  }
  fun ring(progress: Double): Pair<Float, Float> =
    progress.coerceIn(0.0, 1.0).toFloat() to (progress - 1).coerceIn(0.0, 1.0).toFloat()
  fun weightGrams(value: String): Int? {
    val number = FoodEntryModel.decimal(value) ?: return null
    val grams = (number * 1000).toInt()
    return grams.takeIf { number in 1.0..500.0 && kotlin.math.abs(number * 1000 - grams) < 0.00001 && grams % 100 == 0 }
  }
  fun validTime(date: LocalDate, time: String): Boolean = runCatching {
    if (!FoodEntryModel.validDateTime(date.toString(), time)) return@runCatching false
    val local = LocalDateTime.of(date, LocalTime.parse(time))
    val offsets = ZoneId.of("America/Santiago").rules.getValidOffsets(local)
    offsets.isNotEmpty() && local.toInstant(offsets.first()).toEpochMilli() > 0
  }.getOrDefault(false)
}
