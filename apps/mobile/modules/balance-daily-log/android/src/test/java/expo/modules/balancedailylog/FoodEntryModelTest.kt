package expo.modules.balancedailylog
import org.junit.Assert.*
import org.junit.Test
class FoodEntryModelTest {
 @Test fun localeDecimalAndConversion() {
   assertEquals(120.0, FoodEntryModel.canonical("1,5", 1.0, 80.0)!!, 0.0000001)
   assertEquals(0.125, FoodEntryModel.decimal(" 0,125 ")!!, 0.0000001)
   assertEquals(0.0, FoodEntryModel.decimal("0")!!, 0.0)
 }
 @Test fun invalidOrOverflowQuantity() {
   listOf("", "NaN", "Infinity", "-2", "1e3").forEach { assertNull(FoodEntryModel.decimal(it)) }
   assertNull(FoodEntryModel.canonical("0"))
   assertNull(FoodEntryModel.canonical("1", 0.0, 80.0))
   assertNull(FoodEntryModel.canonical("1"+"0".repeat(308), 1.0, 80.0))
 }
 @Test fun dateTimeAndMissingDisplay() {
   assertTrue(FoodEntryModel.validDateTime("2024-02-29", "23:59"))
   assertFalse(FoodEntryModel.validDateTime("2026-02-30", "08:00"))
   assertFalse(FoodEntryModel.validDateTime("2026-10-18", "24:00"))
   assertEquals("—",FoodEntryModel.display(null))
   assertEquals("0",FoodEntryModel.display(0.0))
 }
}
