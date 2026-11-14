# Diary fidelity corrective phases (BAL-059 / BAL-067)

Reference: [Balance Diary Gestures v1.5.0](https://sandbox.shocker.cl/m/balance-diary-gestures), building on [Clean Redesign v1.0.0](https://sandbox.shocker.cl/m/balance-clean-redesign). Later approved compaction, optional monochrome macros and dock gestures take precedence over the original static diary.

The operator rejected the visual appearance of Daily1.11.0/code14 and later reported blank summary expansion and mixed day/header transitions. These corrective phases change JavaScript presentation only; native assets, font registration, theme tokens, dependencies, domain stores and canonical pager acceptance retain their existing owners.

| Area | Reference mapping | Implementation |
| --- | --- | --- |
| Food details | Name plus one ellipsized portion/macros detail; kcal at right | One combined detail line; Simple remains the default preference |
| Group spacing |12px between groups, no extra top gap on first group | First group omits header padding; later groups retain12px |
| Group macros | Passive monochrome12px beside13px kcal | Separate label and caption roles |
| Day summary |16px padding,12px gap | Existing card uses16px padding |
| Compact date | Bricolage17px, lowercase month, -0.17 letter spacing | Existing registered SemiBold16 family; no synthetic font weight |
| Title transition | Preserve approved endpoints and typography; correct the reference's blank intermediate interval | Complementary expanded1-p/compactp curves and measured title translation; one date/calendar semantic owner |
| Week strip | Pills60..36px, numbers17..15px, mark4..3px | UI-thread geometry follows the same collapse progress; day hit area includes4px vertical slop |
| Calendar | Expanded44px surface; compact44x28 transparent/icon18 | Existing date-picker route and date commands retained |
| Dock | Stable60x52 hit box, moving52x44 ink puck over track | Responder stays on original box, only inner puck moves |
| Menu | Ink24% scrim,148x48 upward control at y0+76 | Themed scrim and surface/border control |
| Radial |288-square, annulus r78..143 over126..414degrees, rounded caps32.5, hub132 | Clipped native Views, with fills first and perimeter-only strokes |
| Radial position | y0=41 above dock base; radial center152 above y0 | Row baseline and dial center share those coordinates |
| Radial labels |05..23; anchors6/12/18/23; transparent idle nodes | Existing press targets retain their identity and callbacks |

## Complete-page presentation (BAL-067)

Each native PagerView page now owns its date/week header, summary and feed. All
three consume that page's native vertical offset and travel together horizontally.
The destination is prepared expanded; the source retains its own collapse. This
explicitly replaces the proposed globally blended collapse, rather than claiming
the two horizontal presentations are equivalent. The approved product requires
sticky compaction and the editorial endpoints, not a header outside PagerView.
The earlier reference itself contained the blank fade interval; its endpoints and
visual language are preserved while that interval is corrected.

Expanded/compact header and summary heights are measured in natural layout.
The normal reference is324→108dp with a12dp feed separation. One summary action
contains its visual faces, with complementary opacity and clipping/translation;
static callers retain their existing rendering. Active local headers are limited
to the canonical day plus immediate neighbors. A page uses at most three weekly
title previews, not the old15-label global title window multiplied across pages.
The existing15 feed mounts/subscriptions remain; BAL-056 owns their optimization.

Native viewport, native offset and Legend's virtualized window remain aligned.
There is no vertical content transform, per-frame scroll projection, synthetic
capacity reserve, command-suppression proxy or extra pinned render window. Only
genuine intrinsic overflow enables manual scroll; a short overflowing day gets
enough runway to reach the compact snap, with16dp base clearance. Legend sizes
are provisional until measured; tests cover corrections in both directions.

After a validated native idle, cleanup may reset only a fully offscreen source.
Reentry requires current native zero, JS/core convergence, committed recycled
identity and measured native range, plus a prepared header. A native zero event
alone cannot unlock a list whose core or cells still describe its prior offset.
Fresh known zero and observed zero are distinct; no-op readiness does not invent
another scroll event. Source begin/cancel never freezes or rewinds momentum.
Ordinary JS selected/idle handlers retain canonical date authority and all existing
revision/surface/generation guards. UI observers and week-touch locks control only
presentation readiness. Actions reject an incoming preview or obsolete date.

## Verification and limits

The actual Horseshoe component's native View style tree was rendered at288px and240px and mapped to CSS for geometric comparison against the actual reference SVG. At each size, the diagnostic found zero dark seams inside the reference fill and zero white spurs in the reference's exterior (excluding a2px perimeter band for rasterization differences). The clipped diameters are never stroked. Fill layers overlap their clipping joins by1px to remove rotated antialias hairlines; perimeter strokes retain the exact clipped boundary. This establishes the composition's geometry in Chromium; it is **not** an Android screenshot or proof of Android border antialiasing.

Local diagnostic artifacts: `/tmp/BAL-059-actual-ring-trees.json`, `/tmp/BAL-059-native-view-vs-reference.png`, `/tmp/BAL-059-ring-comparison.json`. Reference screenshots cover the live light/dark diary, menu and radial, with compact-date and WeightSheet captures recorded by the discovery.

Regression coverage exercises continuous gestures, hold, TalkBack choices, stale callbacks and haptic ticks; macro density and food press; shared UI collapse/paging without frame-driven React commits; one accessible calendar; compact date identity and week geometry. Theme and native-interface suites and TypeScript remain required.

The BAL-067 regression suite executes the installed Legend core, Reanimated
adapter and scheduler, stubbing only native boundaries. It separates UI zero,
delayed JS, recycled row commit and deferred native measure; the actual feed
must remain gated until all required evidence converges. The installed Reanimated
event registration/PropsFilter path is exercised to retain ordinary JS callbacks.
Composed tests cover three-header bounds, calendar/consecutive paging, continuous
visual frames without React commits, accessible summary ownership, food editing,
Simple/macros, last-row reachability and cancellation without momentum rewind.
These tests are registered through the existing compiled-diary CI entry.

No physical visual acceptance, measured lag improvement or new OTA publication is
claimed by this document. EAS Simulator is unavailable for this account. Android
phone acceptance remains outstanding. BAL-056/053/057 retain re-entry, historical
projection and hydration/loading scope. BAL-073 owns the editorial weight sheet.

In a development build, enable the bounded, local-only trace with
`globalThis.__BALANCE_DIARY_PRESENTATION__.start()`. Reproduce expansion, full and
canceled swipes, immediate reversal and successive swipes, then call `.stop()`
and `.read()` on the same object. UI intervals are buffered and read back as a
batch; proof samples and React commits are bounded to240 entries. Values are
relative slots, generations, offsets and geometry, never dates or food records.
The trace is unavailable in release builds and does not produce device FPS proof
by itself. Compare the same device/scenario with actual native bounds, record
runtime/updateID, and distinguish resting-source continuity (within1dp) from
native momentum (anchor displacement compensated by offset delta). Also verify
large text, themes, reduced motion, week gesture priority and TalkBack. Keep the
task active until this physical reproduction and publication evidence are recorded.

Delivery continues only through the existing verified-main DAG and the real
Daily APK baseline lifecycle. Integration alone does not complete the task.
Model/review provenance and exact-head checks are recorded in its governed run;
an unavailable reviewer or missing device result is never reported as approval.
