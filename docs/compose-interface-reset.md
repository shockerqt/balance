# Android Compose interface reset

Design source: [Sandbox PR11](https://github.com/shockerqt/ui-design-sandbox/pull/11),
commit `5d76d60c5b868dc88d69059a4fa48c75f9ac33c6`,
`docs/balance-log-wireframes.md` objectives O1–O6. This consumes the reference;
it does not claim visual approval of the draft or modify Sandbox.

The existing BalanceDailyLog Expo Compose host now owns the four Android
destinations and five equal navigation positions: Alimentos, Mediciones, +,
Resumen, Perfil. Android's tab layout hosts a native Stack so a second tab bar
is not rendered and the shell remains mounted beneath catalog tools. Other
platforms keep their current routes. Canonical stores, auth,
outbox, data namespaces and shared TypeScript domain retain ownership.

The diary preserves its native pager and acknowledgement protocol. The week
strip has a single calorie ring: gray progress to the goal, then amber progress
on the same circumference. It describes registered energy, not completeness.
Compact consumed/target totals open nutrient detail, including unknown and
partial values. Hourly groups use the reference's nearest-hour grouping with
23:31–23:59 clamped to 23:00. Headers collapse/expand; an independent 48dp +
opens registration. Food rows have two lines. Long press selects, and contextual
move/delete controls replace navigation. Native quantity/time edits preserve
the original snapshot and validate its current revision before store updates.

Mediciones uses a real monthly weight calendar; native forms edit/delete the
existing daily kg measurement. Bounds 1–500kg, resolution100g and Santiago
future-date policy remain canonical. Weight is excluded from the food feed.
Resumen derives 7/30/90-day calorie/macronutrient/weight plots from those same
records. Missing food days break curves; measured weight points connect over
elapsed dates. Touch inspection and explicit previous/next date buttons expose
values and links to editable dates. Analysis filters survive destination changes.
Calendar selection follows into the food week; registration commits that return
date before leaving, including when cancelled. External date commands reveal the
pager before awaiting layout, avoiding a locked hidden destination after tool saves.

Food registration remains a full-screen native route with Bibliotecas/Etiquetas,
personal/official filters and accent-insensitive search. Labels accept values
per100 or per explicit positive portion size, normalized once into per100
snapshots. Optional absent nutrition remains absent; explicit zero is retained.
The existing durable outbox completion, duplicate prevention and focus/account
guards remain in place. No per-keystroke or per-frame JS event is introduced.

The presentation uses a custom dark slate palette and a restrained blue accent
for native actions and selected states. Real configured
goals and account identity are shown. Profile exposes the real weight preference
and links to existing account/settings, catalog management and MacroFactor tools.
Those secondary tools and login retain their existing screens; this task resets
the main interface and food registration rather than fabricating unspecified
catalog editors or replacing authentication.

Body circumferences require a separate backend/model/table/sync task and are
not offered as fake local-only forms. Reminder scheduling, editable account names
and unit conversion are not represented as supported preferences.

## Visual refinement

The user's review preserves the existing compact text sizes, including 13sp
food names, 10sp row metadata and 9sp navigation labels; the proposed increase
to 16sp was explicitly declined. The two-line summary and food rows remain.
Native vectors replace text glyph icons with a consistent 24-unit grid and
stroke, without another dependency. The repeated empty food thumbnail is removed
to give names more width. Shared margins, shapes, tonal content surfaces and
selected-state accents establish hierarchy without adding decorative motion.

Food registration uses mutually exclusive segmented modes, a quieter date/time
context and search icon; the repeated result-heading date is removed. Profile
tools become grouped navigation rows with the previous 14sp label role. Display
dates use Spanish day/month/year while persisted date IDs remain ISO. Plots have
explicit legends that match stroke patterns, three scale references, distinct
series tones and aligned inspected values. Missing-data behavior is unchanged.
No per-frame bridge events, data owners or persistence formats are introduced.

Native source changes require a new APK: app/runtime1.5.0, Android versionCode6,
internal EAS preview/daily release. Do not promote delivery/daily-runtime.json or
publish an OTA from this task. Use the declared delivery docs/workflows and
EAS CLI21.7.0. Device acceptance must cover 375–390dp geometry, large text,
keyboard, Android Back, paging/scroll, selection, graph links and save/offline
behavior. Automated checks cannot establish phone smoothness or accessibility.
