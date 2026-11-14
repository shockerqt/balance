# Editorial weight sheet (BAL-073)

The approved [Balance Diary Gestures v1.5](https://sandbox.shocker.cl/m/balance-diary-gestures)
reference owns this sheet. Its `.bdg-sheet-backdrop` and `.bdg-weight-sheet`
are an intrinsic column aligned to the bottom, without snaps or sheet dragging.
The earlier Balance Clean Redesign reference supplies the shared visual language.

The route now uses the existing Expo Router `transparentModal` presentation,
with a fade, a decorative handle, backdrop/cancel/Android Back, and one ordinary
footer in flow. It does not promise native formSheet, detents, expansion or drag
dismissal. The header and editor scroll together when space is limited; Save and
Delete stay outside that scroll. This explicitly replaces the earlier two-detent
implementation that hid the footer at the partial Android detent.

The 28dp surface, 19dp heading, 48dp decimal readout and 20dp unit, prior-weight
delta, 72dp ruler, steppers and 52dp minimum actions preserve the approved hierarchy.
The ruler translates ten dp per 0.1kg beneath its fixed needle. Parser limits remain
1–500kg in exact 100g units. Dirty hydration, valid blur normalization, invalid
editable input, canonical store mutations and delete confirmation remain owned by
the existing weight services/stores. Callbacks validate current preference/date,
focus and session authority; successful save/cancel/delete invalidate that authority.
The existing embedded Inter SemiBold remains the approved approximation for the
browser display weight; no font, asset or native dependency is added.

## Viewport and keyboard ownership

Only this route owns its local residual keyboard avoidance. An ordinary full-size
root View, without padding/transforms, is measured with `measureInWindow`. Current
root bounds and the current keyboard frame determine
`clamp(rootY + rootHeight - keyboard.screenY, 0, rootHeight)` synchronously.
A native resize that already ends at the keyboard produces zero residual.
Keyboard height, navigation inset and initial screen height are not subtracted.
The residual is padding on an inner View, so it cannot resize the measured root.

The usable View is measured after that padding and the single safe-top inset.
Its height minus the actual flow footer height caps the scroll. Bottom safe-area
padding is applied once in the footer. Before measures exist, the cap is undefined
and the intrinsic surface remains bounded by its flex viewport/maxHeight100%; it
is not collapsed to height zero. Input opens only after a fresh valid root measure
and a useful body cap. A body with no usable space is not accepted as ready.

Keyboard events and measurements update current refs. Measurement session/tickets
reject old callbacks; hide clears the keyboard frame and residual immediately.
Accepted measures recompute with the keyboard that exists when the callback runs.
No calculated padding crosses an await, and there is no KeyboardAvoidingView,
private native footer, detent update, timer, polling or global keyboard service.

On iOS, the known screenY0 cross-fade case queries the public accessibility
preference as metadata. Session, measurement and keyboard-episode tokens guard its
response; a late response after hide/new show/blur cannot apply old compensation.
Until that special case is known, editing remains unready instead of assuming a
keyboard covering the whole root. A failed query remains unverified for that case.

Source contracts inspected: Screens4.26 `Screen.kt:223` publishes ordinary screen
layout, while its formSheet path has separate private layout; Router57 passes
transparentModal without an opaque content background. RN0.86
`KeyboardAvoidingView.js:95` supplies the intersection formula, but its async
calculation/offset update behavior is not used. Android `ReactRootView.java:950`
produces keyboard screenY from visible bounds/soft-input mode; iOS
`RCTKeyboardObserver.mm:114` converts keyboard frames to UIWindow coordinates.
JS measurements use the layout tree and do not themselves prove physical bounds.

## Verification and evidence

`tests/weight-entry-editorial.test.cjs` mounts the actual route and drives deferred
root measurements, keyboard events and accessibility preferences. It covers both
resize/event orders, late/changed origins, hide before an old callback resolves,
bootstrap event precedence, focus/date invalidation, retained actions, cross-fade
races and the actual root Stack options. A single require in the already executed
`native-interface-lifecycle.test.cjs` registers this suite in `test:native-daily`.
These are model/host lifecycle tests, not Yoga, Android or keyboard screenshots.

Run the editorial suite, `npm run test:weight`, `npm run test:native-daily`,
`npx tsc --noEmit` and `git diff --check`. The existing native compatibility gate,
exact-head/integrated CI and declared Deliver Balance Clients → Publish Balance
Daily OTA DAG remain mandatory; no native gate exemption is implied.

Physical Android and iOS acceptance remains pending. Record complete root,
usable viewport, surface, scroll and action bounds against system/IME, with the
actual device/OS, scale/theme, SHA, runtime and loaded updateID. Check small
height, large text, long/error content, keyboard show/hide/reverse, an already
visible keyboard, iOS cross-fade, TalkBack/VoiceOver and backdrop/Back/cancel.
Neither green tests, merge nor published OTA proves the phone loaded the update
or that Save/Delete are unobscured. BAL-073 stays active until that evidence and
publication identity are recorded; private screenshots stay outside public GitHub.
