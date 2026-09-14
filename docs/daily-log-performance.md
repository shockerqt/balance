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
