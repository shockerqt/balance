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


## Shared Chilean date/time offset cache (BAL-052)

Applicability was rechecked on 2026-11-14 against fetched integrated source
`092ac089d71d487cbae89e643f5f5a028867acfb`. The date, adapter, projector, store
and history harness owners were unchanged from the old plan base `2721894`;
the recent pager/UI changes had not removed the two per-document Intl calls.
This optimization reuses the existing date owner and does not change storage,
canonical documents, lazy projection or the pager.

`dates.ts` now shares a FIFO cache of at most 16,384 UTC-hour offsets between
calendar dates and displayed meal times. Offsets come from the runtime's
America/Santiago Intl data. The cached interval is `[1970-01-01, 2100-01-01)`;
its Santiago transitions are UTC-hour aligned. Earlier/other out-of-range
instants retain direct Intl formatting, including the adapter's original en-GB
time output. Invalid timestamps and Intl failures retain the adapter's UTC
fallback. No DST dates or offsets are hardcoded. Eviction can cause another
Intl call for a previously visited hour; there is no lifetime one-call guarantee
for arbitrary histories larger than capacity. The bound is an entry count, not
a measured memory footprint.

The new production-module tests compare both original date/time Intl references
around all 258 transitions detected by this host's provider over that interval,
calendar/range boundaries, fractional milliseconds, skipped/repeated local times,
shuffled/reversed/repeated access, invalid input, failure fallback and eviction.
They exercise the actual adapter and verify 12,000 records use exactly 9,882
Intl conversions, one per distinct data hour, from each fresh runtime/order.
The suite is required by the existing history test entry, so `test:sync` and the
existing mobile CI execute it without changing manifests or workflows. The
`bench:history` name filter selects its four existing 12k scenarios plus the
durable conversion-boundary control below.

### Same-base host comparison

Three separate Node processes per side used Node `v24.16.0`, ICU `78.3`, ARM64
and the existing representative 12,000-record fixture (707 calendar days,
9,882 distinct UTC hours, 20,520,348-byte cache). Each process recreated the real
application modules/providers against simulated native file storage. Before
changing production, the existing harness was instrumented to count formatter
construction, `format`, `formatToParts`, document conversion and housekeeping
separately. The candidate uses the same timed regions and counting wrappers;
its only harness differences are wiring the new properties and updating the
obsolete two-formatter assertion to one shared contemporary formatter.

Repeat three fresh processes for each production source from `apps/mobile`:

```sh
npx tsx --test --test-name-pattern='cold start from a 12k' tests/sync-large-history-performance.test.cjs
```

The cold-data projection uses a separate fresh application module runtime, before
its first history projection. Launch-time calendar housekeeping may already have
primed the current hour, outside the fixture's data hours. Hydration uses another
fresh runtime. The separately timed second projection creates a fresh projector
but deliberately reuses hydration-warmed timezone modules; it is labelled warm.
Module transpilation/import time is outside the projection timing. A mutation
and its full-file write are measured after these phases, separately.

| Side / fresh process | Hydration (ms) | Cold-data projection (ms) | Warm-module projection (ms) |
| :--- | ---: | ---: | ---: |
| Baseline 1 | 1966.333 | 467.072 | 357.513 |
| Baseline 2 | 1946.444 | 470.819 | 359.892 |
| Baseline 3 | 1978.362 | 456.801 | 333.864 |
| Candidate 1 | 1953.641 | 482.645 | 199.451 |
| Candidate 2 | 1960.079 | 433.929 | 210.939 |
| Candidate 3 | 1936.447 | 448.944 | 210.666 |
| Baseline median | 1966.333 | 467.072 | 357.513 |
| Candidate median | 1953.641 | 448.944 | 210.666 |

| Intl calls per measured phase (identical in all three runs) | Baseline format / parts | Candidate format / parts | Document calls, baseline → candidate | Housekeeping calls, baseline → candidate |
| :--- | ---: | ---: | ---: | ---: |
| Hydration | 12000 / 12001 | 0 / 9882 | 24000 → 9882 | 1 → 0 |
| Cold-data projection | 12000 / 12000 | 0 / 9882 | 24000 → 9882 | 0 → 0 |
| Warm-module projection | 12000 / 12000 | 0 / 0 | 24000 → 0 | 0 → 0 |

The warm fresh-projector reduction is repeatable in these runs (median about
41%), but it is not an ordinary render measurement: the retained production
projector memoizes unchanged document identities and only reconverts changed
rows. Recreating a projector over warm timezone modules intentionally exercises
that boundary again; it does not describe every diary render or day swipe.
Cold-projection ranges overlap; the median difference is not evidence of a
reliable cold-start improvement. Hydration differences are small and noisy.
Storage bytes are unchanged: each measured local add still writes 22,248,894
bytes. These results establish reduced Intl work and a warm-projection benefit
in this Node renderer model; they do not measure Hermes, physical input-to-pixel
latency, phone frame rate or a fix for the observed diary re-entry lag.

Baseline source is the integrated SHA above. At measurement time the candidate
was the uncommitted BAL-052 worktree on that exact base, identified by production
Git blobs: `dates.ts` = `e2fb3d18b70f705f44b5b50c11f6bce46646e0c2`,
`services/sync/adapters.ts` = `b8d2f5c8292f334eaf47882694916ac81619fe20`.
Its eventual committed/reviewed source and CI/delivery identities are recorded
in the task's implementation and delivery evidence; no future commit is claimed
as measured here. Instrumented baseline harness SHA-256 is
`4fa361586da2bd5a8b8b70eec66234faae4b4a1b1b2333d209d0c1d5a1f563e7`;
candidate harness SHA-256 is
`dd977496b4c42cc699a6463eb40ecc9b4d406a08119fd46ea7e153724a4c7040`.
Raw JSON/logs and the reconstructed instrumented baseline harness are local
execution artifacts under `/tmp/BAL-052-*-current*`; the tables above preserve
the comparable results after those temporary artifacts expire.

### Production conversion boundary control

The durable `12k production conversion boundary` scenario in the existing
history harness measures actual `toDateId` and `logToLoggedFood` modules on
that same representative fixture. Its opt-in `BALANCE_CONVERSION_BENCH_REF`
accepts an exact 40-character Git SHA and reads only the two conversion owners
with `git show`; it does not change a checkout. All other modules, TypeScript VM
loader, receiver-correct counters and timed/checksum loops are identical.
Without the variable, the same scenario reads the current worktree owners.
Compilation/import is excluded; launch-time current-hour housekeeping is outside
the fixture. Three fresh processes per side each run a cold-data pass and then
a warm pass.

Reproduce each command three times from `apps/mobile`, in separate processes:

```sh
BALANCE_CONVERSION_BENCH_REF=092ac089d71d487cbae89e643f5f5a028867acfb npx tsx --test --test-name-pattern='12k production conversion boundary' tests/sync-large-history-performance.test.cjs
npx tsx --test --test-name-pattern='12k production conversion boundary' tests/sync-large-history-performance.test.cjs
```

| Side / fresh process | Cold-data date + adapter loop (ms) | Warm date + adapter loop (ms) |
| :--- | ---: | ---: |
| Baseline 1 | 362.984 | 275.256 |
| Baseline 2 | 364.982 | 276.164 |
| Baseline 3 | 384.801 | 281.312 |
| Candidate 1 | 348.307 | 157.044 |
| Candidate 2 | 350.238 | 158.173 |
| Candidate 3 | 362.825 | 159.124 |
| Baseline median | 364.982 | 276.164 |
| Candidate median | 350.238 | 158.173 |

All six output checksums match (`2925897.9999993537`). Every baseline pass
uses 12,000 `format` and 12,000 `formatToParts` calls; the candidate cold pass
uses 9,882 `formatToParts` calls and its warm pass uses none. Total formatter
construction per fresh runtime is two versus one (the date formatter is already
constructed during launch, outside the timed phase). Instrumented medians are
about 4.0% lower cold and 42.7% lower warm. Intl probes have their own cost, so
the small cold difference is not treated as a production benefit; the separate
unprobed control below checks that concern.

This establishes the conversion-boundary benefit independently of the warm
fresh-projector scenario. It intentionally passes all rows through conversion;
in the real retained projector it applies only to rows that need conversion,
not unchanged rows already memoized by document identity. It remains a host
microbenchmark, not a demonstrated cold-start, interaction or phone-lag change.
The phase-comparison harness hashes above identify the measured snapshots
before adding this durable control; the timed hydration/projection code remains
unchanged. The final harness SHA-256, including the durable scenario, is
`70be1e5625e9ffeac405dbf014b9a636f6675c37581ae8c7f540e4ca61aaf9bb`.
Raw per-process JSON is preserved locally in
`/tmp/BAL-052-durable-conversion-{baseline,candidate}-current.json`; these commands
and tables preserve the reproduction path and results after temporary files expire.

### Observer-overhead control

A final auxiliary comparison removed the Intl method Proxy/wrappers entirely:
`DateTimeFormat` returned the real native formatter. The actual owner sources,
fixture, VM loader, timed conversion loop and output checksum were unchanged.
Three fresh processes per side therefore measured production method calls
without per-method instrumentation overhead.

| Side / fresh process | Unprobed cold conversion (ms) | Unprobed warm conversion (ms) |
| :--- | ---: | ---: |
| Baseline 1 | 335.971 | 266.046 |
| Baseline 2 | 337.184 | 262.948 |
| Baseline 3 | 335.918 | 263.210 |
| Candidate 1 | 347.787 | 151.807 |
| Candidate 2 | 326.449 | 153.021 |
| Candidate 3 | 310.542 | 153.383 |
| Baseline median | 335.971 | 263.210 |
| Candidate median | 326.449 | 153.021 |

Cold ranges overlap, so neither this control nor the instrumented 4% difference
establishes a reliable cold-conversion improvement. The warm conversion benefit
persists without probes (median about 41.9% lower), with identical checksums in all
six passes. Reduced Intl work and this warm-conversion benefit are the supported
performance conclusions; no startup, retained-projector render or phone-lag
improvement follows from them.

The complete unprobed harness source and fresh-process commands are archived in
[the task evidence](https://github.com/shockerqt/balance/issues/112#issuecomment-6885707665),
so the control can be reproduced after temporary files expire. The measured
local harness is `/tmp/BAL-052-conversion-unprobed-bench-current.cjs` (SHA-256
`d8c056465504b583b203c53ee9222ffc25c5b3a55775bcf29c6c304c738497f4`);
raw rows are in `/tmp/BAL-052-conversion-unprobed-{baseline,candidate}-current.json`.
It differs from the conversion harness only by returning real Intl formatters
and omitting per-method counters. The durable instrumented scenario above remains
the repository's reproduction path for conversion outputs/call counts.
