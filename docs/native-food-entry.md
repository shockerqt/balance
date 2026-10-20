# Native food registration

BAL-039 extends the BAL-037 Compose host with a full-screen Android registration
route. The platform-specific `food-search.android.tsx` opens a native card in the
existing Expo stack; non-Android routes retain their existing implementation.
The former food form components were not read or used as design references.

## Backend contract as design source

`apps/server/src/connectors/sync.rs` (`NutritionValues`, `NutritionSnapshot`,
`MealLogEntry`, `PortionSnapshot`) and `modules/sync/ws.rs`'s
`parse_meal_log_document` define this screen's fields. Shared `@balance/domain`
conversion/scaling is reused in the adapter. No backend schema changes occur.

A consumption records nameSnapshot, optional templateId, schema-v2 canonical
unit g/ml, nutritionPer100, canonicalQuantity, entry.enteredQuantity and optional
portionSnapshot, plus positive epoch timestamps. Named portions retain both
entered quantity and conversion ratio. Required nutrition is energy/protein/carbs/
fat; fiber, sodium, cholesterol and each allowed extended nutrient are optional.
An empty field means unknown, while explicit zero remains zero. Snapshots retain
full precision and are independent of later library edits. Chile calendar time
is converted with the same utility as the canonical meal store, rejecting DST gaps.

## UI and ownership

Material3 Scaffold, TopAppBar, lazy library results, decimal TextFields, portion
menus, DatePicker and TimePicker form one complete screen. Selecting a template
opens its consumption editor within that destination. Manual entry exposes per100
nutrition and progressively disclosed optional nutrients. A quantity/nutrition
summary shows the food being recorded; the save bar remains above the keyboard.
Compose owns search/filtering, draft and modal picker state. No keystrokes drive
React renders. Saveable native draft state handles in-place configuration changes;
this does not promise draft recovery after process death or a new account session.

One native save request is validated by the TypeScript input boundary. Template
revision/existence and portion identity are checked against canonical documents;
all nutrition and conversion are reconstructed rather than trusting native totals.
A stable route draft ID preserves input across focus changes, while a fresh
focus nonce and reset sequence invalidate old callbacks. Completion is explicit
React state, so even a save batched into one render or completed while blurred
returns correctly once focused. Each status acknowledgement carries the focus
session and request sequence, so repeated errors and rejected old-focus requests
cannot leave native controls locked. Account/focus nonce, sequence and a save lock reject stale/replayed
callbacks. The existing meal store waits for hydration, durably enqueues through
its existing sync owner, then merges the exact document into its cache. Late
completion cannot populate another account's UI. Save errors preserve the editor;
one session document ID makes retries idempotent. No independent native storage,
transport or outbox is introduced. Back/discard controls remain native.

## Delivery and validation

This native addition requires a new APK: version/runtime 1.3.0, Android code4.
The old Daily compatibility baseline remains fail-closed. Use the existing EAS
Development profile for a rebuilt Metro client and preview profile for release
phone review; releasing a test APK does not publish an OTA or promote that baseline.

Contract tests cover named portions, historical precision, optional/zero nutrients,
manual extended nutrients, stale/deleted foods, invalid inputs, arithmetic overflow,
Chilean DST gaps and stale session events. Native model tests cover parsing,
conversion, invalid dates and missing-value display. Native compilation and APK
inspection establish build integrity, not rendered phone behavior. Physical review
must check keyboard/focus, Back/discard, rotation, search with a large library,
portions/decimal comma, save/retry/offline, account switch, accessibility and both
registration paths before integration acceptance.
