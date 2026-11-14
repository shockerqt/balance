# Daily Log navigation performance

BAL-021, measured 2026-09-05 on a physical Samsung SM-S906E, Android 16,
React Native 0.86.2 / Hermes development client connected to Metro.

## Method and limits

Opt-in `globalThis.__BALANCE_LOG_PERF__` diagnostics start a timer immediately
before the date store notifies subscribers. React Profiler records the first
screen commit, component render durations and food component render count.
Nested profiler durations overlap; do not add them together. Subsequent list
batches can increase render counts after the first commit.

The replay alternates days with 0, 1, 5, 21, 40 and 100 food entries, forward
and backward. It waits for two animation frame callbacks and a 200 ms settling
interval per command. The baseline has 77 saved samples (12–13 per size), the
optimized short run has 24 (four per size). Both use the same device and
instrumentation. The baseline was interrupted after the user reported screen
sleep/apparent app closure; no native crash trace was captured. Later short
runs completed. This is exploratory evidence, not a controlled release benchmark.

Times below are medians from programmatic command to first React commit.
They exclude physical touch delivery and do not measure native pixel presentation.
Animation frame callbacks are scheduling proxies only. Development and profiler
overhead also prevent interpreting these as production latency.

| Foods | Baseline first commit (ms) | Optimized first commit (ms) | Baseline food renders | Optimized food renders |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 191.7 | 127.8 | 0 | 0 |
| 1 | 203.4 | 80.4 | 1 | 1 |
| 5 | 231.1 | 137.0 | 5 | 5 |
| 21 | 358.2 | 173.9 | 21 | 14 |
| 40 | 565.2 | 162.3 | 40 | 12 |
| 100 | 1013.9 | 167.2 | 100 | 14 |

## Change

Keep the daily view mounted and virtualize individual food rows, including foods
sharing an hour. Reuse empty hour cells and stable event callbacks. Grouping no
longer copies a growing array for every food. Reset selection and scroll explicitly
when the selected date changes, and reject delayed food events from another day.
The date store remains the single authority; rendering never commands navigation.

The 100-food feed render median fell from 928.5 to 119.9 ms. Empty-day latency
still warrants investigation; instantaneous navigation is not established.
Animations remain deferred.

## Repeating a measurement

Diagnostics are disabled by default, available only in development, and store at
most 1000 local samples containing timings, revisions and counts. They perform no
food mutations, network transmission or persistence and omit dates and identity
from results. Keep a diagnostic label free of personal information.

In a connected React Native debugger, use `__BALANCE_LOG_PERF__.start()` for
manual arrow/swipe trials, then `stop()` and `results()`. For automatic replay,
call `benchmark(dateIds, 2, 'comparison')` with 2–14 valid date IDs. Await the
promise in a debugger that supports it, or poll `status().running`. Avoid touching
the date controls during replay. `stop()` cancels future commands. Missing frame
callbacks abort the replay; interrupted trials do not restore a date over the
user's choice. Successful trials restore the original date.

Before delivery, manually verify scrolling to the bottom of a dense day and
switching to an empty day, individual/group selection, editing, hour entry,
rapid arrows, and competing horizontal/vertical gestures. A release-mode native
trace or input-to-pixel recording is still needed to establish perceived latency.

## Large-history baseline (BAL-051)

Measured 2026-11-12 on main `9d6dc6b`, before any of the BAL-052..056 changes.
Run both cases with:

```bash
npm --prefix apps/mobile run bench:history
```

The harness runs the real storage adapter, sync client and providers under Node
with a simulated file system and socket, on the oci2 ARM host (Node v24.16.0).
These are relative measurements for comparing changes. They are not Hermes or
device latency and do not include native paint.

| Measurement (12,000 synthetic documents, ~707 days) | Value |
| :--- | ---: |
| Full pull lifecycle, 242 pages | 26,430 ms |
| Cache file size after the pull | 20,520,352 bytes |
| Cache writes during the pull | whole file rewritten after every page |
| Local save receipt | 4.1 ms |
| Cold hydration from an existing cache (`hydrateMs`) | 1,931 ms |
| Full first projection of all days (`projectionMs`) | 354 ms |
| One local food add until its cache write (`mutationMs`) | 305 ms |
| Bytes written for that single add (`mutationWriteBytes`) | 22,248,894 |

The dominant cost is the single-file collection cache: one added food rewrites
about 22 MB, and a first sync writes a growing copy of the file once per page.
Per-document `Intl` formatting costs about 84 ms for 24,000 calls in Node, which
is small next to the storage cost.

## Scroll-linked week strip (BAL-074)

The 2026-11-14 diagnostic used a physical Samsung SM-S906E, Android 16,
Balance Dev 1.6.0/build 9 and Hermes. Source `67f472e` had the same diary as
integrated `5acd138`. Freezing only the week strip at expanded geometry reduced
moving-transition UI callback intervals from median 100.31 ms/p95 200.61 ms
(n=74) to median 8.36 ms/p95 16.72 ms (n=390). Original compact median was
8.36 ms (n=152), and the operator reported greater fluidity with the frozen week.
Both captures stopped on day-change guards; days and gestures were not matched.
These exploratory development scheduling measurements identify a likely cost;
they are not production FPS or measurements of this implementation. The frozen
diagnostic is not the implementation. Probe/data/report remain at
`/home/ubuntu/.local/state/balance-diagnostics/20261114-scroll/`.

The implementation retains three weeks, the existing pager/swipe hook and date
owner. Inside `DateStripHeader`, `pVisible` (`useDerivedValue`) clamps collapse
progress to `[0, 1]` and gates all visible collapse styles (`titleHeight`,
`fullTitle`, `compactTitle`, `weekHeight`, and `collapseVisible.week`), while
`pDeferred` holds offscreen weeks (`offset = -1, +1`) constant during pure
vertical collapse `(0, 1)` and syncs immediately on endpoints (`0` / `1`) or any
horizontal gesture (`weekPhase`, `offset`, `pagerPosition`, or `pagerInteraction`).
During vertical transition frames, only 5 header/strip style mappers (`4` header +
`1` visible week row) run instead of updating all 42 day faces, and `0` style
mappers run in compact scroll `>216 dp` or overscroll `<0 dp` thanks to
`useDerivedValue` (`valueSetter`) equality suppression.

Each pill uses the single-view bottom-anchored `dayPill` (`borderRadius: 14`,
`borderWidth: 1`, `justifyContent: 'flex-end'`, `overflow: 'hidden'`) and
`dayActive` hierarchy without multi-view `PillSurface` caps or split touch
layers. All 42 selected/rest day faces keep static text and mark slots (number
`fontSize: 17` and `lineHeight: 20`, letter `height: 16`, mark `height: 4`) with
zero per-frame style updates inside `DayFace`, clipping the top weekday letter
cleanly as the week row height and padding contract (`72 -> 42 dp`, `paddingTop:
4 -> 2 dp`, `paddingBottom: 8 -> 4 dp`), avoiding Android `ParagraphShadowNode`
text re-measurement.

| Collapse progress | Viewport / week row | Top / bottom inset | Clipped pill height | Static number slot | Static letter slot | Static mark slot |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 72 dp | 4 / 8 dp | 60 dp | 17 / 20 dp | 16 dp | 4 dp |
| 0.5 | 57 dp | 3 / 6 dp | 48 dp | 17 / 20 dp | 16 dp (top-clipped) | 4 dp |
| 1 | 42 dp | 2 / 4 dp | 36 dp | 17 / 20 dp | 16 dp (clipped) | 4 dp |

Each date retains one `TouchableOpacity` button (`flex: 1`, `4 dp` vertical
`hitSlop`) and its selected state, while adjacent weeks stay hidden from
accessibility. The operator validated the visual appearance of the bottom-anchored
clipped pill on the device.

The compiled real-component renderer tests use the real swipe hook and check
week and viewport geometry at endpoints, midpoint, out-of-range clamps and
reversal; single-view bottom-anchored pill geometry without `PillSurface` caps;
static `DayFace` slots; visibility-gated `pVisible`/`pDeferred` updates (5 style
mappers mid-collapse, 0 in compact/overscroll) and same-frame horizontal
synchronization; horizontal/vertical composition; no React/date updates during
UI frames; drag cancellation/completion/invalidation; commands, accessibility
and non-pager/compact-only fallbacks. Historical title timing tests remain intact.
