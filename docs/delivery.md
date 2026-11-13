# Balance delivery

After the initial Infrastructure cutover, repository variable
`BALANCE_DELIVERY_ENABLED=true` enables automatic client publication. Setting it
to false suspends publication while preserving checks. A skipped publication is
not delivery evidence.

Merge to main starts **Deliver Balance Clients**. It verifies dashboard,
mobile/Hermes, shared contracts and browser E2E for the same source commit.
Dashboard CI uploads the exact compiled archive with a digest and release.json.
Privileged jobs run only from main, after these checks. Deployments are serialized;
current-main checks reject superseded jobs. Every main push runs the client gate,
including documentation pushes, so a newer commit cannot strand an earlier
superseded release. This initially favors simple correctness over build savings.

## Daily

The reusable Publish Balance Daily OTA workflow requires the native compatibility
baseline in delivery/daily-runtime.json. It publishes only Android/preview/daily,
verifies channel mapping, reconciles reruns and records source/update/group/runtime.
The contract includes local module Android/iOS sources and registration config.
A native mismatch blocks Daily with NEW_APK_REQUIRED; dashboard remains independently
deliverable after the common tests. See eas-daily-use.md for installation and rollback.
The native gate excludes the reviewed test-only `react-test-renderer@19.2.3`
addition from PR #59 only when both manifests declare `^19.2.3` exclusively in
devDependencies and its complete lock entry matches the reviewed version,
registry URL, integrity and metadata. Shared/transitive lock entries remain
checked. Other dev dependencies and future renderer versions require review;
this is not a general exemption for development dependencies.
BAL-048 adds an equally bounded exception for JavaScript-only Legend List 3.7.1,
FlashList 2.3.3 and use-sync-external-store 1.7.0. Both manifests must pin the two
lists exactly and exclusively as runtime dependencies, and all three complete
lock entries (registry, integrity, dependencies, peers and metadata) must match
`scripts/delivery/fixtures/bal-048-pure-lists.json`. The audited installed archives
contain no native sources, autolinking/config plugins or installation hooks.
Other dependencies, transitive entries, native modules/config and assets remain
in the fingerprint. Changing any audited version or metadata requires review;
removing Compose still requires a new APK/runtime.
The version available in EAS and the version running on each phone are distinct.

## Dashboard

The compiled artifact uses /releases/<sha>/ asset URLs. A restricted host command
checks the digest and metadata, stages immutable releases, compares expected-current,
activates atomically and checks public HTTPS source identity. Failure restores
previous pointers. Prior assets remain available to already-open clients.
The receipt is in Actions artifacts and https://balance.shocker.cl/release.json.
Infrastructure owns installation, root permissions, Nginx and recovery; see its
runbooks/balance-artifact-delivery.md. CI never rebuilds on the production host.

## API

Build & Deploy Balance API now only builds and validates. **Promote Balance API**
selects a successful main run's exact artifact; no rebuild happens on promotion.
Run with approve_production=false to inspect a read-only host plan. Set true only
with explicit approval of the run/source and expected-current SHA (none initially).
This dispatch flag is the approval boundary; the current production environment
has no required reviewers, and must not be described as a second-person approval.
Host-side migration checksum equality is mandatory; the workflow never applies SQL.
Follow database-migrations.md separately if the ledger differs. The helper verifies
local/public OpenAPI, retains the old binary and restores it on health failure.
An interrupted operation requires explicit recovery, not an automatic retry.

## Evidence and closure

For each intended component, record source SHA, workflow run and artifact/digest
or EAS group/update/runtime, destination and verification outcome in the task run.
Close delivery-scoped tasks only when all intended publications are verified.
Integration-only tasks must declare that exception before closure. A failed,
superseded or incompatible publication remains outstanding work, even with green
code checks. CI does not mutate Governance or manufacture device smoke evidence.

## Recovery

Disable Deliver Balance Clients to suspend automatic delivery. Retry it from main
after correcting the cause; Daily reconciles an already-published SHA and dashboard
reuses an identical immutable artifact. If a rebuild for the same SHA differs,
the host rejects it rather than silently replacing release contents.
Use Roll back Balance Daily with the previous group and expected current group;
keep automation disabled until a corrective merge is ready. Dashboard rollback
uses the host's expected-current command; pending journals require explicit recover.
API rollback promotes a previously validated retained artifact with explicit approval,
or the administrator restores the retained previous binary under the runbook.
Artifacts are retained for 30 days and delivery receipts for 90 days in Actions;
record durable identities in Governance before expiry. No automated old-release
or task-branch deletion is included.

## Zach contract and API producer evidence

`.github/zach-delivery.yaml` uses schema version 1. Its client rule observes the
main-push parent `deliver-clients.yml` and both `daily-delivery.json` and
`dashboard-delivery.json` receipts. Daily's `publish-daily-ota.yml` is a reusable
child, not a second push workflow. `NEW_APK_REQUIRED` waits for a new APK with
Retry/Reject choices. Dashboard public identity comes from `release.json`.

The API rule's paths match the existing `build-arm.yml` push paths exactly.
Contract, promotion-helper and delivery-documentation changes alone therefore do
not select an API build or promotion. They still select the client parent.
The API OpenAPI health check proves availability; it does not identify the
currently deployed source. Explicit `current_source_authority: plan` makes the
validated host plan authoritative for production current.

Read-only API dispatches omit `expected_current`. The producer validates the
selected build's ID and source against the single bounded regular
`api-release.json` member of the digest-checked archive, mapping package `run_id`
to envelope `build_run_id`. It rejects duplicate JSON keys, unsafe archive members,
invalid IDs and conflicting identities. A successful host plan must match that
artifact and report `schema_compatible: true` plus an explicit current source or
`current: null` (normalized to `none`). The uploaded `api-plan.json` binds source,
build, digest and this observed current. Raw host plan and receipt plus
`build-run.json` remain in the same `api-delivery-<run_id>-<attempt>` audit artifact.

Approved dispatches require a strict lowercase 40-character source SHA or `none`.
Before deploy, a fresh validated host plan must equal that approved current; the
same token then reaches the existing host compare-and-swap gate. The normalized
`api-delivery.json` additionally requires the actual host receipt's published
status, source, run ID and digest to match. Its expected current comes from the
validated predeploy observation and approval equality. An idempotent stored
receipt's `previous` belongs to an earlier invocation and never supplies current.
A production race still fails at the host compare-and-swap gate.

BAL-070 is explicitly integration-only: its completion records contract/parser,
producer tests, independent review and exact-SHA CI evidence. It does not require
or claim a production API promotion, APK build or OTA restoration. BAL-072 owns
the new Daily APK and restoration of compatible OTA delivery. Normal client
publication triggered by integration retains the existing workflow behavior.
