package expo.modules.balancedailylog

import java.time.LocalDate

internal data class CommandToken(val session: String, val revision: Long)
internal data class DateCommand(val date: LocalDate, val fromNative: Boolean, val token: CommandToken)
internal data class PageSettlement(val page: Int, val scrolling: Boolean, val applied: CommandToken?, val active: Boolean) {
  fun canEmit(command: DateCommand): Boolean = active && !scrolling && applied == command.token
}
