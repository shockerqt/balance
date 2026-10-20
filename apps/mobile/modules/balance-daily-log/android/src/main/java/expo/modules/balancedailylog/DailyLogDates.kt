package expo.modules.balancedailylog

import java.time.LocalDate
import java.time.temporal.ChronoUnit

// Bounded to valid application date IDs, not LocalDate's wider year range.
internal object DailyLogDates {
  val first: LocalDate = LocalDate.of(1900, 1, 1)
  val last: LocalDate = LocalDate.of(9999, 12, 31)
  val count: Int = ChronoUnit.DAYS.between(first, last).toInt() + 1
  fun date(page: Int): LocalDate = first.plusDays(page.toLong())
  fun page(date: LocalDate): Int = ChronoUnit.DAYS.between(first, date.coerceIn(first, last)).toInt()
  fun parse(value: String): LocalDate? = runCatching { LocalDate.parse(value) }.getOrNull()?.takeIf { it in first..last }
  // Material DatePicker uses UTC midnight; converting in local timezone shifts
  // a Chilean measurement to the preceding day.
  fun utcMillis(date: LocalDate): Long = date.toEpochDay() * 86_400_000L
  fun fromUtcMillis(value: Long): LocalDate = LocalDate.ofEpochDay(Math.floorDiv(value, 86_400_000L))
}
