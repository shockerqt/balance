# Organic presentation — BAL-041

Accepted Sandbox handoff: source7b6181012f905304750b945c7264a16b8dfb54ef,
visual revision3b801d9, UDS-017/PR17. Four paired custom schemes, Outfit/Inter,
borderless tonal groups, solid readable fields/rows, continuous catalog, compact
date/totals/week header and icon-only central registration action.

## Theme authority and persistence

The existing TypeScript ThemeProvider resolves one scheme for both Expo and the
current Compose views. Appearance (System/Light/Dark) and colors (System/Forest/
Lagoon/Lavender/Peach) are independent. Local device preferences are persisted
under `@balance_theme_v2`; old libro/libroNoche choices migrate to explicit light/
dark Forest. They are device settings, with no account/backend preference field.
Late hydration cannot overwrite a user choice and writes are serialized.

The read-only `getSystemColors` function on the existing BalanceDailyLog module
reads Android12+ Material dynamic roles. Foreground/system-scheme changes refresh
the resolved roles. Missing support uses the complete Forest pair. Custom schemes
retain their accepted explicit roles instead of regenerating from a seed.
System action gradient stops move toward the contrasting extreme while custom
schemes retain reviewed stops. UI colors never encode nutrition values.

Both existing hosts receive identical resolved roles, scheme and gradient stops.
Neither is keyed/remounted on theme change: current drafts, selection, pager/date,
filters, focus nonce and canonical snapshot revisions retain their owners. Compose
owns rendering and transient interaction; TS stores/outbox own data and writes.
No new auth, database, transport, circumference or reminder implementation.

## Connected presentation

Compose keeps diary/weight/summary/profile and full-screen food entry. The daily
nutrition summary is part of the compact gradient date/week header and opens its
existing nutrition sheet; it no longer consumes another card above the food list.
Filled native text fields and tonal sections replace frame-heavy presentation.
The + retains an accessible name and no visible label. Expo secondary tools use
the same roles/fonts through shared primitives. Library rows keep canonical data,
source labels, portion and aligned energy; all-items view is one sorted list.
Official entries remain read-only through the existing food editor.

Fonts are bundled locally with OFL licenses; there is no runtime font download.
Android resources and Expo font assets are copies of the same font files.
Typography keeps existing compact sizes and supports system scaling.

## Validation and delivery

Run mobile TypeScript and tests, including `npm run test:theme` for paired roles,
gradient interpolation, legacy preference migration, invalid values and System
fallback. Native CI compiles the existing module and runs its JVM unit tests.
Physical text scaling/TalkBack/keyboard/insets, native gradients and continuity
need review on the Android device; browser design acceptance does not prove them.

This changes Kotlin, fonts and native configuration. Candidate app1.7.0/code10
uses a new appVersion runtime. `NEW_APK_REQUIRED` is expected until a new exact
APK is verified and the baseline is promoted through its declared delivery flow.
Do not bypass the baseline, publish an OTA locally, or present this as JS-only.
Use the existing Dev build/temporary requested Metro for iteration where compatible;
the changed native host requires a matching new build. Internal APK creation uses
EAS under bounded budget only after exact-source checks and resolved config review.


## Corrected layout fidelity

The first1.7.0 candidate preserved too much BAL-040 geometry and was rejected by
the operator. Static review/green compilation did not validate visual similarity.
The corrective1.8.0/code11 iteration adopts UDS-017 anatomy: centered date between
arrows,22sp energy total,48dp week cells,76dp hour headings on the background,
72dp contiguous food rows in asymmetric tonal groups and56dp central action.
The date is still a calendar control; non-today dates expose a return-to-today
control. Selection, canonical edit/save callbacks and day-pager authority remain.

CurrentProfile (not the historical profile fixture) defines Preferences and Tools
groups. Settings uses compact mode/color selectors in four tonal groups; library
and food forms follow the accepted continuous list and grouped field layouts.
Android library food/new-food routes are full-page tools, matching the reference;
actual edit/confirmation sheets retain their own routes. Field labels use sentence
case and filled48dp minimum controls; native gradients use CSS-equivalent angles.

CI renders the owning Compose composables with synthetic test-only data under
Robolectric native graphics, exportsPNG screenshots and exercises visible actions.
Those images establish component geometry and are not screenshots of an installed
APK, real account data, or proof of physical Android accessibility. Compare the
390x844 reference diary fixture against UDS-0173b801d9 before delivering another
candidate. Never call compilation alone visual acceptance.
