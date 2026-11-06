# React Native interface spike (BAL-048)

Phase 1 adds a read-only day-pager/list comparison. Android still starts in the
accepted Compose interface. No screen parity or physical-phone performance
acceptance is claimed by this spike.

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
rejection, blur cancellation and target-first distant jumps. Those are software
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
only. Position/velocity select one prepared neighbor, and only a completed spring
reports to the date authority with its expected revision. External commands snap,
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
