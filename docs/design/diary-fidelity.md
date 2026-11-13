# Diary fidelity corrective phase (BAL-059)

Reference: [Balance Diary Gestures v1.5.0](https://sandbox.shocker.cl/m/balance-diary-gestures), building on [Clean Redesign v1.0.0](https://sandbox.shocker.cl/m/balance-clean-redesign). Later approved compaction, optional monochrome macros and dock gestures take precedence over the original static diary.

The operator rejected the visual appearance of Daily1.11.0/code14. This corrective phase changes JavaScript presentation only; no native assets, font registration, theme tokens, dependencies, domain stores or gesture transitions change.

| Area | Reference mapping | Implementation |
| --- | --- | --- |
| Food details | Name plus one ellipsized portion/macros detail; kcal at right | One combined detail line; Simple remains the default preference |
| Group spacing |12px between groups, no extra top gap on first group | First group omits header padding; later groups retain12px |
| Group macros | Passive monochrome12px beside13px kcal | Separate label and caption roles |
| Day summary |16px padding,12px gap | Existing card uses16px padding |
| Compact date | Bricolage17px, lowercase month, -0.17 letter spacing | Existing registered SemiBold16 family; no synthetic font weight |
| Title transition | Expanded fades0..0.42, translates-28px; compact fades0.58..1 | Both layers share existing UI scroll progress; only one date/calendar surface is accessible |
| Week strip | Pills60..36px, numbers17..15px, mark4..3px | UI-thread geometry follows the same collapse progress; day hit area includes4px vertical slop |
| Calendar | Expanded44px surface; compact44x28 transparent/icon18 | Existing date-picker route and date commands retained |
| Dock | Stable60x52 hit box, moving52x44 ink puck over track | Responder stays on original box, only inner puck moves |
| Menu | Ink24% scrim,148x48 upward control at y0+76 | Themed scrim and surface/border control |
| Radial |288-square, annulus r78..143 over126..414degrees, rounded caps32.5, hub132 | Clipped native Views, with fills first and perimeter-only strokes |
| Radial position | y0=41 above dock base; radial center152 above y0 | Row baseline and dial center share those coordinates |
| Radial labels |05..23; anchors6/12/18/23; transparent idle nodes | Existing press targets retain their identity and callbacks |

## Verification and limits

The actual Horseshoe component's native View style tree was rendered at288px and240px and mapped to CSS for geometric comparison against the actual reference SVG. At each size, the diagnostic found zero dark seams inside the reference fill and zero white spurs in the reference's exterior (excluding a2px perimeter band for rasterization differences). The clipped diameters are never stroked. Fill layers overlap their clipping joins by1px to remove rotated antialias hairlines; perimeter strokes retain the exact clipped boundary. This establishes the composition's geometry in Chromium; it is **not** an Android screenshot or proof of Android border antialiasing.

Local diagnostic artifacts: `/tmp/BAL-059-actual-ring-trees.json`, `/tmp/BAL-059-native-view-vs-reference.png`, `/tmp/BAL-059-ring-comparison.json`. Reference screenshots cover the live light/dark diary, menu and radial, with compact-date and WeightSheet captures recorded by the discovery.

Regression coverage exercises continuous gestures, hold, TalkBack choices, stale callbacks and haptic ticks; macro density and food press; shared UI collapse/paging without frame-driven React commits; one accessible calendar; compact date identity and week geometry. Theme and native-interface suites and TypeScript remain required.

No physical visual acceptance, measured lag improvement or OTA publication is claimed. EAS Simulator is unavailable for this account. Android screenshot/phone acceptance remains outstanding. BAL-067 separately owns base list clearance/fitting-day snap; BAL-056/053/057 own re-entry, projection and loading-state performance. BAL-073 owns the editorial weight sheet.

Delivery continues only through the existing verified-main DAG and the real Daily APK baseline lifecycle. Integration alone does not complete this task. The operator explicitly authorized Terra for corrective plan/PR reviews after Gemini Flash exhausted its quota; Codex implements.
