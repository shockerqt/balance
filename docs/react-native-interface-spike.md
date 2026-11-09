# React Native interface spike (BAL-048)

Phase 1 adds a read-only day-pager/list comparison. This document describes that
Development-only trial. Phase three now connects the Android entry points to
the [complete React Native interface](react-native-interface.md); the comparison
route remains available only in Development. No physical-phone release performance
acceptance is inferred from the spike.

## Open on the existing Development APK

Use the BAL-048 worktree and the installed `com.balance.app.dev` Development
client. Start Metro only on the operator's request. The local procedure is:

```bash
cd /home/ubuntu/workspace/balance--BAL-048-rebuild-interface-in-react-native/apps/mobile
APP_VARIANT=development EXPO_PUBLIC_BALANCE_RN_SPIKE=1 npx expo start \
  --dev-client --host localhost --port 8081 --no-dev --minify
```

This listens on localhost. Use an already approved connectivity procedure for
the physical phone; this document does not authorize port exposure or a tunnel.
Open Settings and choose **Comparar diario React Native**. The route is also
`/rn-log-spike`. Both that route and its Settings entry require the development
configuration variant plus `EXPO_PUBLIC_BALANCE_RN_SPIKE=1`; Daily and production
redirect to the regular log even if the public switch is present. `__DEV__` is
not the gate because it is false in this required minified trial.

The spike displays real store data without offering write operations. It reuses
the existing date authority, so selecting a date also selects it in the regular
log. Authentication, namespaces, history, nutrition scaling, persistence and sync
keep their existing implementations.

## Phone comparison

Use the same phone, source SHA, account, date sequence, orientation and foreground
conditions for both engines. Record the installed APK version/build identity and
whether its native modules match this source. The choices are pinned FlashList
2.3.3 and Legend List 3.7.1. Both use the same timeline cells, item types
(`empty`, `summary`, `food`), keys and 250 dp draw distance; Legend explicitly
sets `recycleItems`.

1. Choose FlashList, then a dense day and press **Medir**. Scroll from top to
   bottom and back, including a dense single-hour group. Pause briefly, then
   drag slowly left/right and release with short drags and quick flicks.
2. Check the week marker follows the drag, vertical scroll does not switch days,
   and one completed gesture settles at most one neighboring date.
3. Use the calendar and week strip to jump to distant and adjacent dates. Rapidly
   alternate arrows and selections, including while a spring is settling.
4. Press **Detener** and record the anonymous timing/count result. Switch to
   Legend and repeat the identical sequence at least three times per engine.
   Also test an empty day and a day with one food. Compare visual blanking,
   scroll/gesture feel and UI-frame intervals rather than choosing a library
   from one score. Account/session changes and leaving/returning to the route
   must reconcile to the current date without accepting a queued old settle.

Results remain local in memory. They contain engine/mode, bounded commit samples
and aggregate UI-frame intervals during active pan/settle or vertical scrolling;
no dates, foods, account identifiers, network traffic or persistence are added.
Calendar navigation keeps the trial alive while pausing offscreen frame counts;
Profiler samples while the route is unfocused use phase `-1`.
The >25 ms count is a fixed exploratory threshold, not a refresh-rate adjusted
jank percentage. UI-thread frame intervals do not prove input-to-pixel latency.
There is no synthetic history mutation to manufacture a dense day.

## React commit evidence

The spike wraps the rendered screen in React Profiler and samples its UI-thread
interaction phase when a commit is reported. Samples include actual render
cost, command-to-first-commit time and whether the command was a settled-page
acknowledgement or an external jump. Only actual Profiler callbacks count.
The production React renderer normally disables Profiler callbacks, including
`--no-dev --minify`: **unavailable** is reported when there are no callbacks;
that result is never evidence of zero commits. Collect commit evidence with a
profiling-capable/debug renderer in a separate development trial. Do not mix
those timings with minified list/gesture measurements. An incoming store update
can legitimately produce a data commit during a drag; navigation-only trials
must record their sync conditions.

Renderer tests demonstrate zero React commits over 200 simulated gesture updates,
fixed neighboring pane identity, post-spring date acknowledgement, stale revision
rejection, blur cancellation and target-first distant jumps. Chained-swipe tests
also cover one spring per ordinary release with no new list mount during the
slide, late bounds preserving the next spring, interrupting springs,
reversing/cancelling an interrupted gesture,
acknowledgements arriving during the next drag, and ten releases with delayed JS. Those are software
regressions, not instrumented physical-phone or Daily release evidence.

## Store and pager boundaries

`useMealDay(date)` uses a committed, immutable date snapshot and a date-scoped
subscription. `useMealActions()` supplies stable existing store actions without
subscribing to history. The compatibility `useMealStore()` API remains available.
Account replacement creates a new view adapter and exposes an empty view before
that account's hydration; it never publishes the prior account into the new
adapter. Publishing happens after commit, not during provider rendering.

The existing projector indexes documents by immutable identity, day and relative
order. Only changed documents are converted; only affected days allocate food
arrays. Moves invalidate source and destination, while tombstones and complete
replacement remove old buckets. Reorder semantics and unknown-versus-zero
nutrition are preserved. The canonical array API still requires O(history)
identity/order reconciliation: this is not an O(delta) canonical store rewrite.

The pager retains PreparedDayWindow's absolute calendar-day layout, using the
installed Gesture Handler/Reanimated modules. Pan frames update shared UI values
only. Position/velocity advance at most one day per gesture, relative to the previous
release's intended destination. A new pan grabs the current presentation without
waiting for the spring or React acknowledgement. A bounded five-day window normally prepares after the final settle, keeping new
list mounting and measurement off the ordinary slide. It prepares earlier only
when a chained destination extends beyond the current window. Stale preparation
callbacks are discarded during a new drag; bounds changes resume a spring only
if it was waiting for unavailable content, preserving an already valid spring's
velocity.
If JS falls behind many gestures, presentation stays inside the prepared window
until the final intended day is ready, then catches up without exposing an empty
intermediate range. Only a completed final spring reports the settled date to the
authority with its expected revision. An interrupted chain may settle several
days from the last reported date; its acknowledgements do not command or rebase a
newer active gesture. External commands snap,
including adjacent calendar selections; distant jumps mount the target alone in
the first commit and prepare neighbors on a later frame. Paging is paused until
those neighbors exist. Focus, unmount, resize and external commands cancel stale
animation work. The week marker interpolates the same shared day position.

## Delivery and next phases

The dependency additions are JavaScript-only, but the declared Daily native
contract conservatively fingerprints dependency/lockfile changes. It must remain
fail closed; this spike does not alter its exemptions or update the APK baseline.
Do not merge expecting an automatic compatible OTA without first resolving that
reviewed compatibility gate. No APK was requested or built for this phase.
See `delivery.md` and `eas-daily-use.md`.

Record physical measurements before selecting the final list. Then rebuild the
remaining destinations, full-screen registration, selection/edit/move/delete/copy,
weight and other parity flows in React Native, and switch Android entry points.
Daily release acceptance precedes removal of Compose and its config plugin;
removal explicitly requires `NEW_APK_REQUIRED`, a new APK/runtime delivery and
operator acceptance. These phases remain outstanding in BAL-048.

References: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/),
[FlashList 2 usage](https://shopify.github.io/flash-list/docs/usage/),
[Legend List 3 API](https://legendapp.com/open-source/list/v3/api/),
[Reanimated spring semantics](https://docs.swmansion.com/react-native-reanimated/docs/animations/withSpring/).

## Native Android paging comparison

The spike now starts with **Pager Android**, using the existing
`react-native-pager-view` 8.0.2 (Android ViewPager2), already included in the
installed Development APK. This changes no native dependency or APK. Its actual
physics differ from Compose Foundation's HorizontalPager; equivalence is not
claimed. Press **Usar movimiento anterior** to compare the custom Reanimated
pager with identical React Native content. Keep the same list engine, dates and
measurement sequence. Results include `pagerEngine` to distinguish the trials.

Native scroll events update the shared position/week marker on the UI thread.
Page-selected events alone never change the date; the date authority is notified
only after idle, with stale view/session/revision checks. Own acknowledgements
preserve an ongoing next native gesture. External jumps, focus return and resize
create a fresh native surface at the target instead of commanding a scroll
through intermediate dates. The target content mounts first, then neighbors.

This candidate retains a bounded 15-date content window (seven dates either
side); Android keeps adjacent native pages attached with `offscreenPageLimit=1`.
Ordinary settled pages do not recenter the native pager or mount another date's
list. Near a window edge it rebases after settling. That edge remount is a known
flicker/continuity risk, not a proven final infinite-pager design. Test at least
eight successive swipes and reversals as well as slow drags, flicks, calendar
jumps and vertical-scroll arbitration. Compare initial preparation cost/memory
as well as steady paging: this window differs from the custom five-date window.
The final engine/window strategy remains pending physical comparison.


## Operator comparison decision (2026-11-09)

After trying both, the operator prefers Legend's presentation and reports no clear
subjective distinction between the two pager candidates. Legend is now the
initial list engine for continued implementation; both pager candidates remain
available. This is a physical qualitative preference, not a numerical benchmark
or a claim that Legend is universally faster. No additional manual list/pager
tuning rounds are requested. The agent completes the technical pager review;
the expected next operator validation is one combined Daily acceptance session
once the full interface is ready, with targeted retesting only for a concrete
failure. Existing final native APK/delivery acceptance gates still apply.
