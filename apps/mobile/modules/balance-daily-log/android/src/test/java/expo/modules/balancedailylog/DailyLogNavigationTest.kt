package expo.modules.balancedailylog

import java.time.LocalDate
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DailyLogNavigationTest {
  @Test fun returnAfterInactiveSwipeRequiresRestorationEvenWithUnchangedRevision() {
    val date = LocalDate.parse("2026-10-11")
    val first = DateCommand(date, false, CommandToken("focus-1", 0))
    val nextPage = DailyLogDates.page(date.plusDays(1))
    assertFalse(PageSettlement(nextPage, false, first.token, false).canEmit(first))
    val returned = first.copy(token = CommandToken("focus-2", 0))
    // A settled page from the old focus cannot overwrite the authoritative date.
    assertFalse(PageSettlement(nextPage, false, first.token, true).canEmit(returned))
    assertFalse(PageSettlement(nextPage, true, returned.token, true).canEmit(returned))
    assertTrue(PageSettlement(DailyLogDates.page(date), false, returned.token, true).canEmit(returned))
  }
  @Test fun externalCommandsInvalidateSettlementsWhileNativeAcknowledgementsPreserveThem() {
    val date = LocalDate.parse("2026-10-11")
    val command = DateCommand(date, false, CommandToken("focus-1", 3))
    val settled = PageSettlement(DailyLogDates.page(date), false, command.token, true)
    assertTrue(settled.canEmit(command.copy(fromNative = true)))
    assertFalse(settled.canEmit(command.copy(token = command.token.copy(revision = 4))))
    assertFalse(settled.copy(applied = null).canEmit(command))
  }
}
