# Shared client domain

BAL-032 extracts a first increment from the existing mobile and dashboard.
The canonical server is `apps/server/src/connectors/sync.rs` (V2 structs,
`MealLogEntry::validate`, nutrition validation); no API or database changes.
See Governance BAL-ADR-004 for the durable ownership decision.

## Inventory and ownership

| Candidate and current consumers | Before / after | Decision and reason |
| --- | --- | --- |
| V2 meal types: mobile `src/services/sync/types.ts`, dashboard `src/types/meal-log.ts`; consumed by their adapters, stores and command layer | Two declarations / shared declarations with compatibility reexports | Share canonical document contracts; keep sync envelope, preferences and weight local. |
| Named-portion conversion: mobile `src/lib/food-portions.ts::resolveMealLogPortion`, dashboard `src/features/food-log/commands/execute-command.ts::executeQuantity` | Two edit calculations / one `canonicalQuantityForPortion` | Share arithmetic, retain each input parser and snapshot clone at its adapter. |
| Nutrition display: mobile `src/services/sync/adapters.ts::logToLoggedFood`, dashboard `src/features/food-log/domain/food-log-state.ts::nutritionForDocument` | Two core multiplication implementations / one `scaleNutrition` with local projections | Share calculation; retain mobile omission of null optional fields and dashboard's four-macro output. |
| Document guards in both type files | Two guard implementations / unchanged | Defer to a separate validation-policy increment: dashboard accepts arbitrary extended nutrient keys and unlimited provenance external ID; mobile restricts keys and ID length. Mobile accepts an empty optional portionId; dashboard and Rust reject it. Do not silently alter accepted cached documents during extraction. |
| Mobile `src/services/sync/adapters.ts::nutritionPer100` | Local normalization / unchanged | Keep clamping policy at display-food input adapter; not equivalent to pure scaling. |
| Mobile `src/lib/portion.ts::scaleMacros` | Local display model calculation / unchanged | Handles display portion parsing, fallback basis and absent fiber as zero. A different contract from canonical nutrition. |
| Mobile `src/lib/nutrition.ts` aggregation/formatting; dashboard row formatting | Local / unchanged | Presentation rounding and aggregate unknown-value policy are not canonical document math. |
| Mobile `src/hooks/use-meal-store.tsx`; dashboard `domain/time.ts` | Duplicate Chile date helpers / unchanged | Defer date extraction; preserve America/Santiago day interpretation and UTC millisecond timestamps. |
| Mobile meal store; dashboard `services/meal-log-sync.ts` | Separate merge/timestamp logic / unchanged | Adapter-owned LWW, queues, persistence and tombstones; no shared synchronization framework. |
| Dashboard command parser, registers and undo/redo | Dashboard-owned / unchanged | Application semantics, as required by BAL-ADR-003. |

All source paths in the table are relative to `apps/mobile` or `apps/dashboard`
where indicated. Remaining arithmetic inside local document guards verifies the
wire contract; it is deferred with guard policy, rather than a second editing API.

## Compatibility and portability

The ratio is evaluated as `enteredQuantity / portionQuantity * canonicalQuantity`,
matching Rust's evaluation order. With `5 cucharadas = 30 g`, one cucharada is
6 g. The log's copied portion snapshot is authoritative after a template edit or
removal. Canonical entry does not require a portion snapshot. Nutrition is fixed
per 100 g or 100 ml and uses the canonical amount, without rounding.

JavaScript numbers and Rust f64 use double precision. Contract comparison uses
`max(1e-8, abs(expected) * 1e-8)`; formatting precision remains local. Invalid,
non-positive and non-finite ratio inputs/results are rejected by the pure helper.
Optional absence, null and explicit zero remain distinct in the pure nutrition
operation; each existing display adapter preserves its projection policy.

This increment does not change identity, consumedAt/updatedAt, tombstones,
persisted payloads, cache namespaces or pending queues. No migration, production
data rewrite, cache reset or OTA is needed to review it. Parser behavior stays
local: mobile can explicitly select a canonical unit or its historical named
portion; the dashboard quantity command retains its existing snapshot semantics.

## Dependency direction and rollback

Both clients depend on the pure domain package; the package imports no client,
React, DOM, networking, storage, clock or randomness. Existing per-app installs
and lockfiles remain independent. Shared-path changes trigger both clients' CI.

Revert the extraction, consumer wiring and package metadata together. No data
rollback is needed because document formats remain unchanged. Native smoke,
consumer tests and bundler checks are distinct evidence; an export alone does
not prove native interactions or persistence after restart.

## Exports and synthetic reference

`@balance/domain` exports `CanonicalUnit`, `Nutrition`, `ExtendedNutrition`,
`ExtendedNutrientKey`, `EXTENDED_NUTRIENT_KEYS`, `ImportProvenance`,
`PortionDefinition`, `PortionSnapshot`, `PortionRatio`, `MealTemplateDetails`,
`MealTemplateDoc`, `NutritionSnapshot`, `MealLogEntry` and `MealLogDoc`.
`canonicalQuantityForPortion(enteredQuantity, ratio?)` returns a number or null;
`scaleNutrition(nutrition, factor)` returns a fresh nutrition object and rejects
non-finite factors. It assumes a validated nutrition input; it is not a wire guard.

`packages/balance-domain/fixtures/canonical-spoon.json` is data-only and reusable
outside TypeScript. Its ratio and nutrition values mirror the existing Rust
`canonical_portions_scale_and_snapshot_history` test in `connectors/sync.rs`.
Expected values are compared with the server's relative/absolute tolerance.
The fixture contains no retired V1 fields or production records.

Run shared tests with `npm --prefix packages/balance-domain test`, dashboard tests
with `npm --prefix apps/dashboard test`, and mobile consumer regressions with
`npm --prefix apps/mobile run test:domain`. Raw TypeScript ESM exports are resolved
through local file dependencies; mobile enables `allowImportingTsExtensions`
under Expo's no-emit TypeScript configuration and watches the package in Metro.
CI also builds the Android bundle with Hermes on its supported x86 runner.
