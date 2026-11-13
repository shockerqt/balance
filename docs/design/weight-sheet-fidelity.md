# Editorial weight sheet corrective phase (BAL-073)

Reference: approved `balance-diary-gestures` v1.5.0, compared against the earlier
`balance-clean-redesign` original. The later reference owns this dedicated sheet.

The weight route owns its rounded 28dp surface, handle and 19dp heading, separate
cancel button, 48dp decimal readout with 20dp unit, prior-weight delta capsule,
72dp ruler, stepper row and fixed safe-area footer. The readout opens decimal
editing on tap. Invalid input stays editable with an error; valid blur normalizes
to one decimal. Existing integer-gram parsing, hydration guards, confirmation and
store save/delete behavior remain authoritative.

The ruler translates ten pixels per 0.1kg beneath a fixed center needle, with
12/20/28dp minor/half/integer marks and integer labels. Direct editing, drag,
TalkBack adjustments and steppers share the existing 1–500kg limits.

Use the already embedded Inter SemiBold face for the display. Its weight600 is
an approximation of the browser reference's700; no replacement font or native
asset is added in this OTA-compatible corrective phase.

The route increases its initial fractional detent for small screens or increased
font scale, permits expansion to95%, scrolls its body independently and keeps the
save/delete footer outside that body. iOS uses keyboard avoidance; Android uses
the existing native resize behavior. Component tests verify these configurations,
not physical keyboard visibility or native screenshots. Phone verification in
both themes, large text and with the decimal keyboard open remains outstanding.

Verification: `cd apps/mobile && npx tsx --test tests/weight-entry-editorial.test.cjs`
and `npx tsc --noEmit`; native/delivery checks are recorded on the PR. No native
configuration, dependency, store schema or shared UI primitive is changed.
