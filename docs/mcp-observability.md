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
- `response_prepared`: the same correlation, duration in milliseconds, HTTP
  status, allowlisted method/tool labels, outcome, error class and result shape.
  HTTP200 can contain a `tool_error` or `json_rpc_error`; inspect the outcome.
- `abandoned`: an admitted request future was dropped before completion. Status0
  and outcome `abandoned` do not describe an HTTP response. Process termination,
  failed logging and forced termination cannot guarantee a final event.
- `suppressed`: safe saturating count of suppressed events carried into the next
  window. It is emitted only when new traffic or a late completion next checks
  the limiter; there is no timer or background logging queue.

Methods/tools are mapped to fixed labels. Unknown names become `unknown`, and a
rejection before JSON extraction remains `not_observed`. No caller IDs, user IDs,
credentials, headers, URI/query strings, arguments, names, arbitrary payload
keys, record dates/values, raw errors or raw bodies are logged. Events explicitly
exclude contextual parent spans, so inherited span fields cannot leak into the
new events. Counts and type checks are metadata, not record contents.

Shape fields describe the exact final tool result immediately before conversion
to the JSON response. `content_blocks` counts content, `text_blocks` counts text
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
Requests suppressed at arrival perform no shape inspection.

## Volume and retention

One fixed-size process-wide limiter permits at most20 events in each60-second
monotonic window, including arrival, late completion, safe-error classifications
and suppression summaries. It limits logging, never request execution. There
are no per-user maps or unbounded reservations. A terminal can be suppressed even
after its arrival was recorded; paired events are not guaranteed under pressure.
Unauthenticated traffic can consume this shared diagnostic budget. Restarting
the process resets the volatile budget and counters.

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
filtering; do not paste or persist their raw output. A report should copy only
the reviewed safe fields from actual new observation events. Confirm the
effective filter's presence/absence without printing the complete environment.
Confirm the exact compiled source/run against the immutable delivery receipt.
Ask for one fresh MCP call through the existing authenticated client, then inspect
the matching arrival/result in that short window. If suppression is reported,
repeat in a quiet window. Never log the authenticated request or returned values.

Absence of an event is inconclusive: filters, shared budget, cancellation,
rotation, process restarts and upstream rejection can all remove evidence. A
positive `response_prepared` plus matching typed JSON narrows the server/client
boundary; it still does not prove what Spark consumed.

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
