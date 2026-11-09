# React Native Android interface

BAL-048 replaces the Android entry points with a React Native interface using
the existing Organic themes and canonical providers. The old Compose module
remains compiled but unused until final Daily acceptance; removing it and its
plugin requires a separately verified APK/runtime. No native source or runtime
baseline changes in this interface cutover.

## Navigation and diary

Four destinations (Alimentos, Mediciones, Resumen, Perfil) surround central
registration. Library, settings, import and weight entry reuse existing routes.
The diary uses Legend List 3.7.1 with recycled hour-summary, food and empty-hour
cells, preserving the operator's hour-level quick-add controls. Day data uses
`useMealDay`; actions use the existing stable store API. Selection is temporary
per-day UI state; it clears on date/focus changes and pauses native paging without
remounting its surface. Delete confirmation checks the current day/revision and
unchanged visible sources again before acting.

The integrated candidate is installed PagerView 8.0.2. Scroll frames and the week
marker use Reanimated values; only settled idle reports a date to `logsDateStore`.
Own acknowledgements preserve the current native surface. Calendar jumps replace
it directly at the target, preparing neighbours afterwards. Focus, resize,
revision and native-surface checks discard obsolete callbacks. The native window
contains fifteen dates, with adjacent attachment; near an edge it rebases after
idle. The initial preparation/memory cost and potential edge-remount flicker are
known limitations for final physical acceptance. Neither Compose-equivalent
physics nor measured superiority is claimed.

Discrete page-selected/scroll-state events use PagerView's ordinary JavaScript
callbacks with `nativeEvent` payloads. Selection does not depend on a prior
dragging notification; omitted/interleaved state events cannot strand the header
on the old date. Only idle schedules a guarded acknowledgement after the current
native batch. Own acknowledgements update the live revision immediately, so a
queued reversal is valid before React props catch up. Per-frame position remains
a UI worklet and does not wait for a JavaScript movement flag. Regression coverage
also executes the installed PagerView wrapper's callback forwarding, rather than
only injecting raw worklet events.

The operator qualitatively preferred Legend after the Development comparison and
reported no clear pager distinction. No numerical benchmark was supplied. Keep
the Development-only comparison available for diagnostics, without requesting
further manual tuning rounds. Missing production Profiler callbacks mean
unavailable commit measurements, never a measured zero. Renderer drag-frame tests
are software evidence, not release performance measurements.

## Canonical write flows

Full-screen registration uses the same `createFoodEntry` contract as the previous
native adapter: current template revisions, named portions, exact historical
nutrition, custom g/ml labels per100 or per portion and all supported extended
nutrients. Unknown nutrient inputs remain absent rather than becoming zero.

Registration, copy, move and edit await the canonical meal store's durable outbox
receipt. `useMealReceipt` holds only UI state, retains the exact prepared documents
for a failed receipt and prevents duplicate confirmations/removal while saving.
Account replacement unmounts the draft. A receipt received while hidden never
navigates another route; the same completed draft finishes upon refocus.

Copy reuses `prepareSelectionCopy`, validating current source date/revisions,
cloning historical documents and retaining allocated IDs on retry. It leaves the
originals and selected diary date unchanged. Move/edit validate source revisions
and Chilean local times; edit reuses the canonical historical-portion converter.
The canonical stores/outbox remain the only data/durability owners. Existing
delete, preference and weight store semantics are retained.

## Measurements, analysis and nutrition

Measurements offers a month calendar, direct month/year jumps, existing weight
entry/edit/delete and the existing real-data weight trend. Future dates cannot
register weight. Profile retains the supported weight preference and links to
existing account/theme/import/library tools.

Summary shows food/body series for 7/30/90 days, a selectable end date and a route
to the actual selected record. Points use calendar-day spacing. Food curves break
over missing dates; weight curves join actual measurements. Explicit zeros stay
recorded; days without food are omitted rather than averaged as zero. A nutrition
detail route reuses the existing canonical snapshot projector and marks unknown
and partially known nutrients. Calendar arithmetic uses UTC calendar dates while
consumption timestamps and Today retain Chilean identity.

## Verification and delivery

`npm test` and `npx tsc --noEmit` cover the mobile contracts; the existing CI runs
the new interface lifecycle and shell/calendar cases as part of `test:native-daily`.
`node --test scripts/delivery/delivery.test.mjs` verifies the tightly pinned pure-JS
list exception and native/dependency fail-closed cases. See [delivery.md](delivery.md)
for its exact audited inputs. All other APK compatibility inputs remain checked.

Publish only through the existing verified-main Deliver Balance Clients workflow.
An export or passing CI does not prove Daily publication or physical acceptance.
The expected operator check is one final combined Daily session, followed only
by targeted retesting for actual failures. Compose removal waits for that acceptance.

## Verify the code running on a phone

The Android APK version (for example Daily1.9.0) does not identify the OTA that
is currently executing. Settings → Información de la app displays the native
expo-updates running-update ID, channel, runtime and embedded/OTA origin. A
downloaded pending update is identified separately; it is never labelled as the
running update. Recovery launches and disabled OTA are explicit.

Expand Ver diagnóstico del deslizamiento to inspect the last sixteen anonymous
discrete pager events, callback counts and date-confirmation guard reasons.
The trace contains relative page indices and revision counters; it does not
include account IDs, date strings or food records. Per-frame scroll handling is
unchanged and adds no JS trace calls. The trace stays in memory and is shared
only when the operator presses Compartir diagnóstico in the native share sheet.
It creates no server telemetry, persistence or parallel date authority.

## Production compiler and revision subscriptions

The pager's revision prop must use `useLogsDateRevision`, which subscribes to the
existing date authority through `useSyncExternalStore`. Reading `getRevision()`
imperatively during render lets Expo's React Compiler cache the mount revision.
After a calendar jump or an initial swipe, that frozen prop can reject every
subsequent native acknowledgement while the UI-thread underline still moves.
Imperative reads inside event handlers remain appropriate for live validation.
Regression tests execute the actual production Expo preset/React Compiler and
date hooks, covering consecutive settles, Sunday6→Monday7 after a calendar jump,
and away-and-back commands whose final date is unchanged but revision advances.
