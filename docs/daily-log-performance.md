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

## Scroll-linked week strip (BAL-074, candidate awaiting device validation)

The 2026-11-14 diagnostic used a physical Samsung SM-S906E, Android 16,
Balance Dev 1.6.0/build 9 and Hermes. Source `67f472e` had the same diary as
integrated `5acd138`. Freezing only the week strip at expanded geometry reduced
moving-transition UI callback intervals from median 100.31 ms/p95 200.61 ms
(n=74) to median 8.36 ms/p95 16.72 ms (n=390). Original compact median was
8.36 ms (n=152), and the operator reported greater fluidity with the frozen week.
Both captures stopped on day-change guards; days and gestures were not matched.
These exploratory development scheduling measurements identify a likely cost;
they are not production FPS or measurements of this candidate. The frozen
diagnostic is not the implementation. Probe/data/report remain at
`/home/ubuntu/.local/state/balance-diagnostics/20261114-scroll/`.

The candidate retains three weeks, the existing pager/swipe hook and date owner.
All 42 selected/rest day faces keep fixed text slots (number fontSize 17 and
lineHeight 20), heights and padding. Shared UI-thread styles translate layers,
scale the number uniformly and change opacity. Pills use fixed 14 dp top/bottom
caps and a vertically scaled straight middle, preserving circular corners and
1 dp horizontal stroke thickness. No rounded pill or text ancestor is squashed.
Only the outer week viewport retains continuous height layout; three nested
week rows translate vertically, leaving the outer horizontal paging transform
intact. This bounds layout work rather than claiming all native work disappears.

| Collapse progress | Viewport | Top / bottom inset | Pill | Apparent number | Letter contribution / opacity | Mark |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 72 dp | 4 / 8 dp | 60 dp | 17 | 16 dp / 1 | 4 dp |
| 0.5 | 57 dp | 3 / 6 dp | 48 dp | 16 | 8 dp / 0 | 3.5 dp |
| 1 | 42 dp | 2 / 4 dp | 36 dp | 15 | 0 dp / 0 | 3 dp |

A separate fixed-layout touch overlay transforms to the pill frame, with the
existing 4 dp vertical hitSlop. Painted faces are pointer-inert, hidden from
accessibility and siblings of the touch target. Each date retains one button
and its selected state; a per-press shared opacity preserves painted touch
feedback without React updates. Adjacent weeks stay hidden from accessibility. Native
transformed hit rectangles, hitSlop, TalkBack, cap seams and actual pixels still
require physical validation.

The compiled real-component renderer tests use the real swipe hook and check
reconstructed bounds at endpoints, midpoint, out-of-range clamps and reversal;
fixed repeated layout; uniform text scale; cap seams/corners/strokes; selected
and resting layers; horizontal/vertical transform composition; no React/date
updates during UI frames; drag cancellation/completion/invalidation; commands,
accessibility and non-pager/compact-only fallbacks. Historical title timing tests
remain intact. These establish JS presentation contracts, not performance or
native hit testing.

AC-4 remains pending: run at least three same-day matched baseline/candidate
trials with at least 200 moving-transition samples, identical probe, chosen
day, source/config and foreground/display/thermal conditions. Report median,
p95, counts, stop reasons and compact results; target at least 50% transition
p95 reduction without material compact regression, explaining a miss. Obtain
operator visual/fluidity confirmation and touch/TalkBack acceptance. The
candidate has not been measured on the phone.

AC-5 remains pending: independent review, exact-head CI, native compatibility,
verified-main delivery, published SHA/Actions/update/runtime records and Daily
acceptance. The current handoff prepares a draft PR; phone validation is deferred.
No merge, delivery, build, local OTA or server operation is part of this handoff.
