package expo.modules.balancedailylog

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BalanceDailyLogModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BalanceDailyLog")
    Function("getSystemColors") { dark: Boolean ->
      appContext.reactContext?.let { systemThemeColors(it, dark) }
    }
    View<BalanceDailyLogView>(BalanceDailyLogView::class) {
      Events("onAction")
      Prop("data") { view: BalanceDailyLogView, value: String -> view.setData(value) }
      Prop("dateCommand") { view: BalanceDailyLogView, value: String -> view.setDateCommand(value) }
      Prop("active") { view: BalanceDailyLogView, value: Boolean -> view.active.value = value }
    }
  }
}
