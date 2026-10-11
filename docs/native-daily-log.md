# Android daily log v2

BAL-037 replaces the Android daily screen with a local Expo module implemented
in Kotlin and Jetpack Compose. Other platforms retain the existing screen.
The module is part of the APK; Expo Go and older Balance Development builds
cannot load it. Compose dependencies are pinned through BOM `2026.09.00`; the
Compose compiler follows Expo's Kotlin version.

## Ownership

`apps/mobile/modules/balance-daily-log/android` owns the screen, native
HorizontalPager, lazy list, calendar, summary, weight display, selection and
batch dialogs. JavaScript supplies a JSON presentation snapshot from the existing
meal/weight/preferences stores and handles domain actions. Native code has no
network client, account credentials, persistence, nutritional scaling or sync
journal. Addition, individual editing and weight entry open the existing routes.
Batch retiming/deletion invoke the existing store actions; deletion requires a
native confirmation.

The pager moves with the finger and reports only settled dates. That report
updates `logsDateStore`, preserving compatibility with routes outside the screen.
Acknowledgements marked `fromNative` cannot send an earlier swipe back into the
pager. External date commands can jump the pager. A command revision invalidates queued
navigation and actions, including an external away-and-back date change. Selection disables horizontal
paging and Back clears selection. All prepared pages show data, but only the
settled page accepts food actions. Selection is intersected with current food IDs
when data changes. The week starts Monday; the calendar interprets Material's
UTC milliseconds as calendar dates, avoiding Chilean timezone shifts.

Each mounted account and return to the screen gets a fresh opaque UI session. Every event carries this
session and an increasing sequence; the adapter rejects stale/replayed events,
inactive dates and missing food IDs. Focus/unmount guards prevent queued callbacks
from executing after leaving the screen. Data projection preserves canonical
nutrition precision and rounds only display strings. All food rows are lazy,
including hundreds of records in the same hour. No JavaScript call drives gesture
frames. Cached day snapshots are resent when canonical data changes; this is
not an independent native cache or background synchronization system.

## Build and development on the VPS

Use the repository's EAS Development profile from the task worktree:

```sh
cd apps/mobile
npx eas-cli@21.7.0 build --platform android --profile development --non-interactive
```

The result is an internally distributed APK named **Balance Dev**, package
`com.balance.app.dev`, channel `development`, runtime `1.2.0`, versionCode `3`.
It installs alongside Balance Daily. Use the existing Development Metro access
mechanism after installation (`npm start` binds localhost); exposing or changing
VPS networking is a separate operation. The development client loads the app
from Metro. Installing a dev client does not publish the screen to Daily.

Kotlin, Compose, Gradle or module registration changes require a new EAS APK.
TypeScript changes compatible with that binary continue to use Fast Refresh.
The Daily gate includes local native module source/configuration. Its old
`1.1.0` baseline must continue to fail with `NEW_APK_REQUIRED`; this Development
APK is not a validated Daily baseline. A future Daily release needs its own APK,
phone validation and reviewed baseline update before OTA can resume.

## Verification

`npm run test:native-daily` covers projections and the event input boundary.
`Verify Balance Native Daily Log` generates the Expo Android project, compiles
the Kotlin module and executes native calendar arithmetic tests. The Development
APK is built only through EAS, not distributed by this workflow. Standard mobile
CI continues to typecheck, test domain flows and export Android Hermes bytecode.

Physical review remains necessary: slow/cancelled/rapid swipes, week/year jumps,
calendar, long vertical scroll and dense hours, selection/Back, edit/add return,
retiming/delete, weight/future-date guard, account change, font scaling and screen
reader. A successful compile or APK does not establish touch/pixel acceptance.
