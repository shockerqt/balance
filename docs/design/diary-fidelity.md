# Diary fidelity corrective phases (BAL-059 / BAL-067)

Reference: [Balance Diary Gestures v1.5.0](https://sandbox.shocker.cl/m/balance-diary-gestures), building on [Clean Redesign v1.0.0](https://sandbox.shocker.cl/m/balance-clean-redesign). Later approved compaction, optional monochrome macros and dock gestures take precedence over the original static diary.

The operator rejected the visual appearance of Daily1.11.0/code14 and subsequently rejected the pager delivered by PR #155. These corrections change JavaScript presentation only; native assets, font registration, theme tokens, dependencies and domain stores retain their existing owners.

| Area | Reference mapping | Implementation |
| --- | --- | --- |
| Food details | Name plus one ellipsized portion/macros detail; kcal at right | One combined detail line; Simple remains the default preference |
| Group spacing |12px between groups, no extra top gap on first group | First group omits header padding; later groups retain12px |
| Group macros | Passive monochrome12px beside13px kcal | Separate label and caption roles |
| Day summary |16px padding,12px gap | Existing card uses16px padding |
| Compact date | Bricolage17px, lowercase month, -0.17 letter spacing | Existing registered SemiBold16 family; no synthetic font weight |
| Title transition | Restore the familiar historical timing and typography | Expanded fades0..0.42, translates-28p; compact fades0.58..1; one accessible date/calendar surface |
| Week strip | Pills60..36px, numbers17..15px, mark4..3px | UI-thread geometry follows the same collapse progress; day hit area includes4px vertical slop |
| Calendar | Expanded44px surface; compact44x28 transparent/icon18 | Existing date-picker route and date commands retained |
| Dock | Stable60x52 hit box, moving52x44 ink puck over track | Responder stays on original box, only inner puck moves |
| Menu | Ink24% scrim,148x48 upward control at y0+76 | Themed scrim and surface/border control |
| Radial |288-square, annulus r78..143 over126..414degrees, rounded caps32.5, hub132 | Clipped native Views, with fills first and perimeter-only strokes |
| Radial position | y0=41 above dock base; radial center152 above y0 | Row baseline and dial center share those coordinates |
| Radial labels |05..23; anchors6/12/18/23; transparent idle nodes | Existing press targets retain their identity and callbacks |

## Pager recovery (BAL-067)

The recovery restores the native pager and global header composition from
`a9ea5bf`, preserving the later PR #154 WeightSheet changes. One absolute, clipped
date/week header sits outside PagerView and follows the selected day's vertical
offset. Native horizontal progress drives its existing title/week preview.
The existing day feeds, canonical date-change scroll resets, fixed336dp prefix,
216dp collapse travel,108dp midpoint snap and16dp base clearance are restored.
Only genuine intrinsic overflow enables vertical scrolling.

PR #155's page-local headers, native/Legend/committed-row readiness contract,
measurement-dependent geometry and imperative week-touch pager locks are
withdrawn. An ordinary day swipe no longer waits for the current day or either
neighbor to measure. Selection remains an explicit pager lock. Ordinary JS
selected/idle handlers retain canonical authority and the earlier revision,
generation, idle-sequence, surface and focus guards; no navigation or data owner
is added.

The user also rejected the prolonged scroll morph and preferred the earlier
summary that disappears promptly. The complete title/summary behavior is restored
verbatim from `a9ea5bf`: the expanded summary fades out over72dp, its compact face
fades in over54..216dp, and its semantic/action face switches as soon as offset
is positive. There is no summary translation. The global header retains its
separate108dp semantic handoff,136→78dp geometry and original title28p lift; the
summary keeps its188→30dp clip. All seven affected source files, including pager
diagnostics, match that baseline. No measurement helper, new curve or morph owner
remains. The historical blank title interval at collapse progress0.42..0.58,
commit-time pop, general lag and large-text limitations are not fixed or claimed
fixed by this restoration.

## Verification and limits

The actual Horseshoe component's native View style tree was rendered at288px and240px and mapped to CSS for geometric comparison against the actual reference SVG. At each size, the diagnostic found zero dark seams inside the reference fill and zero white spurs in the reference's exterior (excluding a2px perimeter band for rasterization differences). The clipped diameters are never stroked. Fill layers overlap their clipping joins by1px to remove rotated antialias hairlines; perimeter strokes retain the exact clipped boundary. This establishes the composition's geometry in Chromium; it is **not** an Android screenshot or proof of Android border antialiasing.

Local diagnostic artifacts: `/tmp/BAL-059-actual-ring-trees.json`, `/tmp/BAL-059-native-view-vs-reference.png`, `/tmp/BAL-059-ring-comparison.json`. Reference screenshots cover the live light/dark diary, menu and radial, with compact-date and WeightSheet captures recorded by the discovery.

Regression coverage exercises continuous gestures, hold, TalkBack choices, stale callbacks and haptic ticks; macro density and food press; shared UI collapse/paging without frame-driven React commits; one accessible calendar; compact date identity and week geometry. The compiled diary tests assert one global clipped header outside all15 pages, selected-day scroll ownership and the exact historical summary/title timing and face handoffs. Native pager tests permit initial, consecutive and reverse swipes without neighbor layout while preserving existing rejection guards; three rapid gestures remain enabled before JS acknowledgement. The existing compact-feed regressions run through the compiled diary CI entry and cover fitting/overflow, runway, snap, reduced motion, clearance, macros and callbacks. Theme and native-interface suites and TypeScript remain required; the untouched native-interface entry also executes the WeightSheet editorial regressions.

The user confirmed two qualitative symptoms: the header travels as part of a complete page, and the lock prevents successive page movements. PR #155's page-local header ownership and readiness gate are confirmed source changes consistent with that report; no device trace establishes the exact blocking event or delay. The recovery removes the inter-page readiness lock and restores header progress separately from paged content. It makes no new promise about the number of days one native fling traverses. No physical visual acceptance, measured lag/FPS improvement or corrective OTA publication is claimed. EAS Simulator is unavailable for this account. Android phone acceptance remains outstanding, including full/canceled/consecutive/reverse swipes, scroll expansion, clipping/date alignment, week/calendar priority, empty/short/long-day clearance, selection/macros, themes, large text, reduced motion, TalkBack and unchanged WeightSheet behavior. Record the actual installed runtime/update ID with that evidence. BAL-056/053/057 retain re-entry, projection and loading-state performance scope. BAL-073 owns the editorial weight sheet.

Delivery continues only through the existing verified-main DAG and the real Daily APK baseline lifecycle, recording the corrective SHA and update/group/runtime separately from phone acceptance. Integration alone does not complete this task. The recovery plan was independently reviewed by authorized Codex Terra xhigh; a separate independent PR review and exact-head CI remain required. An unavailable device does not prevent preparing the corrective source and PR, and it does not count as acceptance.
