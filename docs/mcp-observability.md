# MCP observation

Balance emits bounded informational events on the static tracing target
`balance_mcp_observation`. They describe the request reaching the MCP route and
the result prepared by Balance. They do not prove that Spark received, parsed or
displayed that result. BAL-049's Spark-display acceptance remains separate.

## Visibility and scope

After the existing dotenv load, an absent `RUST_LOG` enables only this target at
info, retaining the previous global error default. Every present value is
respected, including empty, malformed and non-Unicode values, with the previous
lossy filter behavior. No service environment or Infrastructure configuration is
modified. Operators can explicitly disable the target with
`RUST_LOG=error,balance_mcp_observation=off` or enable it alongside errors with
`RUST_LOG=error,balance_mcp_observation=info` under their existing configuration
workflow. This task does not authorize changing production service configuration.

Only requests reaching the MCP route are observed. The wrapper runs outside its
existing authentication and JSON extractors, preserving their rejection bodies,
status codes and OAuth challenges. CORS/proxy/network rejection before this route
is not observed. No request/response body buffering or second authentication
layer is added.

The new events and the two former raw MCP database/internal-error logs are safe
by construction. Existing unrelated auth/shared/WSS logs are not certified or
changed by this task. Do not export a raw service journal as a diagnostic report.

## Events and fields

- `arrived`: a fresh random server correlation UUID and compiled source/build.
  The correlation is not a JSON-RPC ID, user identity or caller-supplied header.
  Arrival suppression does not remove the safe request context.
- `tool_result_prepared`: allowlisted tool/method, outcome/error class and bounded
  shape of the actual final Value envelope. This synchronous helper-stage event
  occurs before Json conversion and has **no `http_status` field**. Its duration
  ends at Value preparation, excluding diagnostic inspection and subsequent HTTP
  serialization/completion. The unchanged helpers' HTTP200 behavior is a wire
  contract, not a status measured by this event. A terminal can exist without an
  `arrived` event, using its own server correlation and compiled source/build.
- `response_prepared`: actual returned HTTP status and duration for protocol or
  rejection paths that did not attempt a final tool-result hook. HTTP200 can
  contain a JSON-RPC error; inspect the outcome. It does not duplicate a tool
  terminal, including when that terminal was suppressed.
- `abandoned`: an unfinished request future was dropped without a final tool
  result attempt. Status0 and outcome `abandoned` do not describe an HTTP response.
  A completed tool hook is not reclassified as abandonment after cancellation,
  even if its event was suppressed. Process termination, failed logging and
  forced termination cannot guarantee a final event.
- `suppressed`: safe saturating count of suppressed events carried into the next
  window. It is emitted only when new traffic or a late completion next checks
  the limiter; there is no timer or background logging queue.

Methods/tools are mapped to fixed labels. Unknown names become `unknown`, and a
rejection before JSON extraction remains `not_observed`. No caller IDs, user IDs,
credentials, headers, URI/query strings, arguments, names, arbitrary payload
keys, record dates/values, raw errors or raw bodies are logged. Events explicitly
exclude contextual parent spans, so inherited span fields cannot leak into the
new events. Counts and type checks are metadata, not record contents.

Shape fields on `tool_result_prepared` describe the exact final tool result
immediately before conversion to the JSON response. `content_blocks` counts
content, `text_blocks` counts text
blocks only when there are at most16 blocks, and `structured` records whether
structuredContent exists. `collection_count` uses only the known foods, items or
entries collection for search, daily log or weight history respectively.

For weight history, at most64 entries are checked. `entry_inspection` is
`complete`, `partial` or `not_applicable`; `checked_entries` identifies the number
actually inspected. `checked_date_strings` and `checked_weight_numbers` describe
only that checked prefix (`all` or `not_all`). Empty/absent entries are
`not_applicable`, never proof that dates or numeric weights were present.

`first_text_json` is `matches`, `differs`, `invalid_json`, `not_checked` or
`not_applicable`. Parsing accepts at most16KiB of first-text bytes. The structured
value is checked before parsing, and traversal/comparison are limited to512
nodes, depth32 and a conservative16KiB string/key budget. Parsed text must also
fit that traversal budget before equality is checked;16KiB is the parser's
allocation/work input bound, not a promise of at most512 allocated parser nodes.
Larger values are not cloned or scanned without limits for diagnostics. The
existing response serialization still performs its original full response work.
Inspection begins only after the final-result hook obtains its class permit.
A denied terminal performs no shape inspection, parse or comparison. The permit,
borrowed inspection and event emission happen synchronously, with no await,
retained payload or permit carried to a later completion.

## Volume and retention

One fixed-size process-wide limiter permits at most20 events in each60-second
monotonic window. Within that same budget, background events have a separate
ceiling of8: every arrival, handshake/protocol completion, HTTP rejection, unknown
method/tool, abandonment and suppression summary. Only a final result from
`tools/call` with a statically known tool label receives priority; known-tool
success and error results can use the remaining global capacity. This protects12
slots from startup/rejection noise, not from other valid tool results. It is not
an unconditional observation guarantee under saturation.

Every event checks the current window, including late completions. A carried
suppression summary consumes one global and one background slot before other
admissions. No old permit/reservation bypasses either limit. One fixed-size safe
context lives with each request while the target is enabled, even when arrival
logging is denied; explicit filter-off retains the no-context fast path. The
global limiter stores no per-user maps, payloads, queues or request reservations.
It limits logging, never request execution. Either a terminal or an arrival can
be absent under pressure; do not require pairs to interpret a tool result.
Restarting the process resets the volatile budget and counters.

The formatter test forces ANSI on and includes maximum source/run lengths,
integer/count widths and label lengths, requiring each emitted line plus newline
to fit1KiB. At20 events/minute this is28.125MiB per1440 full windows; an arbitrary
24-hour interval can straddle one additional window (at most28.145MiB before
journal metadata/rotation overhead). This bound assumes one process without
restarts. The shared journal's retention/disk policy belongs to Infrastructure.
The reported global2.7GiB journal usage is not specific to Balance and authorizes
neither a global vacuum nor a retention change.

## Operator checks

Use bounded, local-only reads. For example:

```sh
sudo journalctl -u balance-server --since '5 minutes ago' --lines 200 --no-pager --output=cat | rg 'balance_mcp_observation'
sudo journalctl --disk-usage
systemd-analyze cat-config systemd/journald.conf | rg 'SystemMaxUse|RuntimeMaxUse|MaxRetentionSec'
```

These journal commands can read inherited service messages before local
filtering; do not paste or persist their raw output. A bounded reader should use
at most200 entries and a window no longer than10 minutes, decode JSON `MESSAGE`
byte arrays locally when ANSI causes the journal to represent text as bytes,
strip ANSI, and select the exact static target plus expected compiled source/run.
Output only allowlisted static labels, server UUIDs, counts and type/equality
flags. Never export arbitrary fields, headers, arguments or message bodies.
Its event allowlist must include `tool_result_prepared`; do not reject it because
it lacks HTTP status or a matching arrival. A report should copy only
the reviewed safe fields from actual new observation events. Confirm the
effective filter's presence/absence without printing the complete environment.
Confirm the exact compiled source/run against the immutable delivery receipt.
For an operator-reported call, inspect its existing short window. Missing or
suppressed evidence does not justify automatically asking the operator to repeat
the same validation. Never log the authenticated request or returned values.

Absence of an event is inconclusive: filters, shared budget, cancellation,
rotation, process restarts and upstream rejection can all remove evidence. A
positive `tool_result_prepared` plus matching typed JSON proves server-side Value
preparation and narrows the server/client boundary. It proves neither emitted
HTTP bytes nor what Spark received, parsed or displayed.

## Build identity and delivery

`build.rs` validates complete source/run inputs and embeds one marked identity.
The runtime uses that same retained marker, not runtime environment, package
version or working-directory Git state. Builds without either input explicitly
report `unknown`; partial/malformed inputs fail compilation. The existing ARM
job supplies exact checked-out source and Actions run, using explicit
[cross environment passthrough](https://github.com/cross-rs/cross/wiki/Configuration#buildenv).
The packager inspects the actual binary for exactly one complete matching marker
before writing an archive, comparing it to the verified source and manifest run.
No ARM binary is executed by inspection. Missing, stale, ambiguous or unknown
compiled identity rejects production packaging.

Delivery uses the existing immutable API build, read-only promotion plan and
explicit approval of that exact artifact and expected-current source. Preserve
the previous binary and existing health-failure rollback. After promotion, verify
local/public health, source/run and new safe events. Record observation acceptance
separately from Spark's actual display acceptance. No migration, key rotation,
OAuth/Eri change, new logging backend, APK or OTA is part of this work.
