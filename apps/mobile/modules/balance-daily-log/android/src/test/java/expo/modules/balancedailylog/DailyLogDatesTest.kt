package expo.modules.balancedailylog

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DailyLogDatesTest {
  @Test fun pagerCrossesLeapDayAndYearWithoutTimezoneArithmetic() {
    for (text in listOf("1900-01-01", "2024-02-28", "2024-02-29", "2026-12-31", "9999-12-31")) {
      val date = LocalDate.parse(text)
      assertEquals(date, DailyLogDates.date(DailyLogDates.page(date)))
      assertEquals(date, DailyLogDates.fromUtcMillis(DailyLogDates.utcMillis(date)))
    }
    val page = DailyLogDates.page(LocalDate.parse("2024-02-28"))
    assertEquals(LocalDate.parse("2024-02-29"), DailyLogDates.date(page + 1))
    assertEquals(LocalDate.parse("2024-03-01"), DailyLogDates.date(page + 2))
  }
  @Test fun invalidDateCommandsCannotCrashThePager() {
    assertNull(DailyLogDates.parse("2026-02-30"))
    assertNull(DailyLogDates.parse("not-a-date"))
    assertNull(DailyLogDates.parse("10000-01-01"))
    assertEquals(0, DailyLogDates.page(LocalDate.of(1800, 1, 1)))
  }
}
