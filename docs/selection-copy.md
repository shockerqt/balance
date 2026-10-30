# Copy selected consumption records

BAL-045 extends the existing meal-log mutation and durable outbox. It does not
introduce another endpoint, persistence queue, identity model or snapshot owner.
The application remains subject to the existing server-authoritative snapshot
contract in Governance ADR-001.

## Creation intention

`MealLogDoc` accepts an optional creation intention:

```ts
copySource?: {
  id: string;
  updatedAt: number;
};
```

The source identity and revision describe the historical consumption the user
selected. The copy has its own document UUID and destination `consumedAt`; the
source remains unchanged. Existing documents without `copySource` retain their
current protocol. The intention travels through the existing meal-log outbox.
It is not a PostgreSQL column and is not required in canonical pull documents.

The server resolves the source for the authenticated Balance user. It must not
accept arbitrary client-supplied nutrition as the copy's authority or rebuild a
historical copy from the source's current library template. A source may have no
template or may refer to a deleted template. Its validated historical food
identity and nutrition JSON are the authority.

Copies do not inherit MacroFactor import provenance: `source_provider` and
`external_id` identify the original imported row and are uniquely constrained.
Snapshot evidence and portion/unit data are distinct from import-row identity.

Source revision, active state and ownership are checked for a new document.
An already-created copy UUID is resolved through the existing idempotency/LWW
owner before a creation-only source check, preserving lost-ACK retries. WSS
creation currently retains the submitted `updatedAt`, so a pending source and
its dependent copy can refer to the same revision when processed in order.

Client presentation and selection projections are not a snapshot comparison
format. Creation validation must compare canonical wire/domain fields against
the authorized source without introducing display rounding or silently replacing
the historical payload. Copy-specific terminal rejections must retain their
original push-row index; transient database or transport errors retain the
existing retry behavior.

## Authoritative creation and retries

An existing destination UUID follows the current user-scoped LWW/idempotency
path before its creation intention is considered. A lost acknowledgement remains
retryable even if the source later changes or is deleted.

A new live copy requires an active source belonging to the authenticated user
at exactly `copySource.updatedAt`. Its historical template reference, name and
validated canonical nutrition must agree with the incoming document's food
identity. Optional null and absence are normalized consistently by the validated
domain representation. The inserted record retains the source's original raw
nutrition JSON; validation does not regenerate its persisted snapshot.

Quantity, entry/portion and destination time come from the mutation and use
their existing validation. They initially equal the selected source's values,
but remain editable while the copy is waiting for its first acknowledgement.
Those edits must not be overwritten by copying the source quantity again.

A new copy tombstone may resolve its own user's stale or logically deleted
source without matching the cancelled payload's food identity or source
revision. It still persists the incoming tombstone revision. Merely acknowledging
an absent destination would allow a late earlier create to resurrect the copy.
Missing and foreign sources are rejected without distinguishing their existence.

Expected copy failures are per-row rejections and leave independent rows in the
same request eligible for processing. Database and transport failures retain the
current transient error path. Sources pending in the same outbox are sent before
their copies, with rejection indices referring to the actual submitted order;
retries retain the original destination UUIDs.

## Implementation state

The coordinator approved this contract after independent review and recorded
the code gate in BAL-045's execution run before backend edits. Implementation,
roundtrip tests and independent code review still determine readiness. This
document does not claim the new behavior is deployed or available in APK1.8.

## Delivery

Do not enable the new client action against an API that has not acquired the
reviewed server contract. API promotion uses the declared exact-artifact approval
flow. Native UI changes require a later compatible APK. Neither operation is
authorized by this contract note, and successful tests do not establish physical
phone acceptance.
