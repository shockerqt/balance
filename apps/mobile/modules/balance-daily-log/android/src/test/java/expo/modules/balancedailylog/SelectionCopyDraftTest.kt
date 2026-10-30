package expo.modules.balancedailylog

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SelectionCopyDraftTest {
  @Test fun receiptBelongsToOneOperationAndFocusSession() {
    val original = SelectionCopyDraft("operation-a", "focus-a", LocalDate.parse("2026-10-30"),
      listOf("one", "two"), mapOf("one" to 10L, "two" to 20L), LocalDate.parse("2026-11-01"), "14:25")
    assertTrue(original.accepts("focus-a", "operation-a"))
    assertFalse(original.accepts("focus-b", "operation-a"))
    assertFalse(original.accepts("focus-a", "operation-b"))
    val retry = original.copy(saving = false, error = "No se pudo guardar")
    assertEquals(original.operationId, retry.operationId)
    assertEquals(original.revisions, retry.revisions)
    assertEquals(original.destinationDate, retry.destinationDate)
    assertEquals(original.time, retry.time)
  }
}
