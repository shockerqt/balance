package expo.modules.balancedailylog

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BalanceDailyLogModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BalanceDailyLog")
    View<BalanceDailyLogView>(BalanceDailyLogView::class) {
      Events("onAction")
      Prop("data") { view: BalanceDailyLogView, value: String -> view.setData(value) }
      Prop("dateCommand") { view: BalanceDailyLogView, value: String -> view.setDateCommand(value) }
      Prop("active") { view: BalanceDailyLogView, value: Boolean -> view.active.value = value }
      Prop("copyEnabled") { view: BalanceDailyLogView, value: Boolean -> view.copyEnabled.value = value }
      Prop("copyStatus") { view: BalanceDailyLogView, value: String -> view.setCopyStatus(value) }
    }
  }
}
