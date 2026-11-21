# MCP observation

Balance emits bounded informational events on the static tracing target
`balance_mcp_observation`. They describe requests reaching the MCP route and
responses prepared on the server. Spark receipt, parsing and display require
separate evidence, including BAL-049's display acceptance.

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

Request events carry a server-generated correlation UUID, compiled
`source_sha` and `build_run`, and `http_method` mapped to `GET`, `POST`, `DELETE`,
`OPTIONS` or `other`. The separate `method` field uses the JSON-RPC allowlist.
Unknown JSON-RPC methods and tools become `unknown`. Before JSON extraction,
`method` is `not_observed` and `tool` is `not_applicable`.

- `arrived` records the route entry. The request retains its context even when
  its arrival event is suppressed.
- `tool_result_prepared` records the prepared response's HTTP status, available
  size, allowlisted outcome and error class, and bounded tool result shape.
  Its duration ends after JSON conversion, before diagnostic inspection. Tool
  errors use the existing `invalid_arguments`, `not_found`, `conflict`,
  `database_error` and `internal_error` labels.
- `response_prepared` records actual returned status, available size, duration
  and handler outcome for protocol and HTTP rejection paths. HTTP 200 can
  carry `json_rpc_error`. Returned HTTP errors use `http_rejected` with
  `auth_unauthorized` for 401, `http_forbidden` for 403, `method_not_allowed`
  for 405, `json_rejected` for marked JSON extractor errors, and
  `http_client_error` or `http_server_error` for remaining 4xx or 5xx responses.
  A normal tool preparation attempt deduplicates normal response logging even
  when its admission was denied. A returned HTTP error is observed separately.
- `abandoned` records a polled route future dropping before it returns a
  response, including after tool preparation. The outcome and error class
  are both `abandoned`. HTTP status and size are absent. Process termination
  and logging failures can leave no event.
- `suppressed` carries per-class denial counts from the previous window along
  with compiled source and run. The summary is process-wide and has no
  request correlation.

`response_bytes` is the exact prepared body size hint, including the full
JSON-RPC envelope where applicable. Exactly empty bodies report zero and
unknown-size bodies omit the field. This server-side payload measurement
excludes HTTP headers and framing and precedes transport and client handling.

Events exclude contextual parent spans. Caller IDs, user IDs, credentials,
headers, URI/query strings, arguments, names, arbitrary payload keys, record
dates and values, raw errors and raw bodies are excluded.

Shape fields on `tool_result_prepared` describe the borrowed result used to
prepare the JSON response. `content_blocks` counts
content, `text_blocks` counts text
blocks only when there are at most 16 blocks, and `structured` records whether
structuredContent exists. `collection_count` uses only the known foods, items or
entries collection for search, daily log or weight history respectively.

For weight history, at most 64 entries are checked. When entries are checked,
`entry_inspection` is `complete` or `partial` and `checked_entries` records the
number inspected. `checked_date_strings` and `checked_weight_numbers` describe
only that prefix (`all` or `not_all`). These four fields are omitted when
there are no entries to check.

Successful tool results carry one text block: the human summary, a blank line
and the compact JSON payload on the final line (BAL-049: Spark forwards only the
last text block to its model). `first_text_json` compares the JSON on the final
line of the first text block (the whole text when it has no newline) with
`structuredContent`. It is `matches`, `differs`, `invalid_json`, `not_checked` or
`not_applicable`. Parsing accepts at most 16 KiB of first-text bytes. The structured
value is checked before parsing, and traversal/comparison are limited to 512
nodes, depth 32 and a conservative 16 KiB string/key budget. Parsed text must also
fit that traversal budget before equality is checked. 16 KiB is the parser's
allocation/work input bound, not a promise of at most 512 allocated parser nodes.
Larger values are not cloned or scanned without limits for diagnostics. The
existing response serialization still performs its original full response work.
Inspection begins only after the final-result hook obtains its class permit.
A denied terminal performs no shape inspection, parse or comparison. The permit,
borrowed inspection and event emission happen synchronously, with no await,
retained payload or permit carried to a later completion.

## Volume and retention

The process-wide limiter uses independent quotas in a 60-second monotonic
window. Returned HTTP 4xx and 5xx responses take precedence over handler
outcomes when classifying route completion.

| Class | Limit | Summary counter |
| --- | ---: | --- |
| Arrival, successful protocol response, or tool success outside an allowlisted `tools/call` | 8 | `suppressed_background` |
| Allowlisted `tools/call` success | 12 | `suppressed_known_tool_success` |
| HTTP 405 | 8 | `suppressed_method_not_allowed` |
| Other HTTP 4xx, including 401, 403 and extractor 422 | 8 | `suppressed_other_client_error` |
| HTTP 5xx | 8 | `suppressed_server_error` |
| Abandoned route future | 8 | `suppressed_abandoned` |
| Known or unknown tool error | 8 | `suppressed_tool_error` |
| JSON-RPC error | 8 | `suppressed_json_rpc_error` |
| Carried suppression summary | 1 | |

Every attempt uses the current window, including late responses and drops.
The first enabled admission check at rollover clears admissions and emits
one summary if any previous counter was nonzero. Each counter saturates at
the maximum unsigned 64-bit integer. The summary uses its own slot, and
unused slots cannot be borrowed by other classes. The limiter uses fixed
process state with no timer, queue, per-user map, or request reservation.
Restarting the process resets its budget and counters. An explicit filter-off
setting skips request context creation and the limiter.

The ANSI formatter test covers all five event types and maximum field widths,
including the newline, within 1,024 bytes per line. A 24-hour interval can
intersect up to 1,441 windows in one continuously running process. The upper
bound before journal overhead is **101,815,296 bytes** (`69 × 1,441 × 1,024`),
including up to one summary per window. Infrastructure owns shared journal
retention and disk policy.

## Operator checks

Use bounded, local-only reads. For example:

```sh
sudo journalctl -u balance-server --since '5 minutes ago' --lines 200 --no-pager --output=cat | grep -F 'balance_mcp_observation'
sudo journalctl --disk-usage
systemd-analyze cat-config systemd/journald.conf | grep -E 'SystemMaxUse|RuntimeMaxUse|MaxRetentionSec'
```

These journal commands can read inherited service messages before local
filtering; do not paste or persist their raw output. A bounded reader should use
at most 200 entries and a window no longer than 10 minutes, decode JSON `MESSAGE`
byte arrays locally when ANSI causes the journal to represent text as bytes,
strip ANSI, and select the exact static target plus expected compiled source/run.
Report only allowlisted event, method, tool, outcome and error labels, server
UUIDs, HTTP status, exact byte counts, duration, suppression counters, shape
counts and flags, and compiled identity. Accept `tool_result_prepared` without a matching
arrival. Confirm the effective filter setting without printing the service
environment, and match the exact compiled source and run to the immutable
delivery receipt. For an operator-reported call, inspect its existing short
window and keep authenticated requests and returned values out of the report.

Missing evidence is inconclusive. Filters, quota exhaustion, journal rotation,
and process restarts can remove evidence. CORS, proxy and network rejections
can happen upstream of the observer. A prepared response and matching typed
JSON establish server-side preparation. Client receipt, parsing and display
each require their own evidence.

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
