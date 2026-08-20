# Dashboard terminal food log

The dashboard implementation treats the terminal interaction as a domain command language rather than a React keyboard-handler trick.

## Layers

- `domain/`: canonical meal-log state, Chile-local date/time helpers, register snapshots.
- `commands/`: parser and pure command executor. Counts, motions, operators, text objects, register semantics, undo/redo and paste live here.
- `hooks/`: React adapter, local persistence and overlay/editor orchestration.
- `components/`: presentation only. NORMAL is position-only (`>`); VISUAL owns the blue selection surface.

## Register rules

- `x`, `dd`, `D`, `d{motion}`, `diw`, and VISUAL `d` write deleted rows to the unnamed register.
- `yy`, `y{motion}`, `yiw`, and VISUAL `y` write snapshots without mutating rows.
- normal `p/P` creates fresh `MealLogDoc` IDs and does not consume the register.
- VISUAL `p/P` replaces the selection; displaced rows become the new register.
- register items are snapshots, never references to existing document IDs.

Paste uses millisecond-level timestamp anchoring around the cursor so positional `p/P` remains coherent with the production model, where `consumedAt` is also the ordering field. Relative offsets inside a pasted block are preserved.

`>/<` likewise does not create a second visual-order field. It moves rows by assigning the existing chronological timestamp slots to the requested order, so presentation and persisted order cannot silently disagree.

## Persistence and sync

This branch persists the canonical `MealLogDoc[]` shape in browser `localStorage` immediately. It deliberately reports `local` rather than pretending remote sync exists.

Mobile already has the production WebSocket/outbox protocol for `mealLogs`. The dashboard should get a browser storage adapter and auth/session integration against that same protocol before the status line changes to `syncing/synced/offline`.

The dashboard copy of the meal-log contract mirrors `apps/mobile/src/services/sync/types.ts`. A follow-up should extract the contract into a shared package instead of letting the two copies drift.

## Quantity units

The production sync contract only supports `g | ml | unit | portion | cup`. The mockup-only labels such as `scoop`, `serving`, and `tbsp` are therefore not invented here. When `gramsPerUnit` exists, Tab can cycle `g ↔ unit` while preserving nutrition semantics; richer aliases need real template conversion metadata first.

## Verification

The command parser and executor have Node tests for count composition, inclusive motions, hour-block targets, register behavior, Visual paste, and undo/redo. Dashboard CI runs those tests before the normal TypeScript/Vite build.
