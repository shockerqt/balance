package expo.modules.balancedailylog

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BalanceFoodEntryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BalanceFoodEntry")
    View<BalanceFoodEntryView>(BalanceFoodEntryView::class) {
      Events("onAction")
      Prop("data") { view: BalanceFoodEntryView, value: String -> view.setData(value) }
      Prop("status") { view: BalanceFoodEntryView, value: String -> view.setStatus(value) }
      Prop("active") { view: BalanceFoodEntryView, value: Boolean -> view.active.value = value }
    }
  }
}
