package expo.modules.balancedailylog

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class WireframeModelTest {
  @Test fun groupingNeverWrapsSameDayMidnight() {
    assertEquals("08:00", WireframeModel.hour("08:30"))
    assertEquals("09:00", WireframeModel.hour("08:31"))
    assertEquals("23:00", WireframeModel.hour("23:59"))
  }
  @Test fun singleRingShowsOnlyProgressiveExcess() {
    assertEquals(0f to 0f, WireframeModel.ring(0.0))
    assertEquals(1f, WireframeModel.ring(1.2).first)
    assertEquals(0.2f, WireframeModel.ring(1.2).second, 0.00001f)
    assertEquals(1f to 1f, WireframeModel.ring(3.0))
  }
  @Test fun weightResolutionAndChileanGapMatchBackend() {
    assertEquals(72500, WireframeModel.weightGrams("72,5"))
    assertNull(WireframeModel.weightGrams("72.55"))
    assertNull(WireframeModel.weightGrams("500.1"))
    assertNull(WireframeModel.weightGrams("0"))
    assertFalse(WireframeModel.validTime(LocalDate.parse("2026-09-06"), "00:30"))
    assertTrue(WireframeModel.validTime(LocalDate.parse("2026-10-18"), "23:59"))
  }
}
