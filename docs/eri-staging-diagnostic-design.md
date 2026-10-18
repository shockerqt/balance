# Proposed real-client diagnostic contract (BAL-033)

Status: refresh replay implemented locally; live execution and provider logout pending. This extends the existing
mobile AuthProvider and AuthSession transport; it does not add another credential
engine. Native Dev, exact staging issuer/client/resource/API binding and explicit
opt-in are required. Production, Daily and web cannot invoke the diagnostic.

## Local source status (refresh slice)

The terminal refresh replay source is now implemented in the BAL-033 task
worktree, with an opt-in Settings control gated by `__DEV__`, native Android/iOS,
the development app variant and `balance-dev` scheme, exact staging binding,
and `EXPO_PUBLIC_AUTH_DIAGNOSTICS=1`. This records source work only; no live Eri
request or device acceptance has been executed. The independent two-family
provider logout operation below remains unimplemented.

The provider owns all local auth entry points synchronously while replay runs.
It drains an already-started refresh before reading its latest stored session,
clears that session through the serialized writer, then makes the three SDK
refresh calls without adopting their responses. Only typed `TokenError` with
`invalid_grant` counts as rejected reuse. The Settings result contains only
sanitized categories. A 30-second diagnostic deadline stops later steps and
reports unconfirmed; the owner remains held until an outstanding SDK transport
settles because this version of AuthSession exposes no abort option. A stalled
transport can therefore keep authentication unavailable until it settles or the
app process is restarted. A successful or failed replay leaves Balance locally
signed out and requires a new login. If the storage clear fails, the replay
stops before provider requests, reports unconfirmed and asks the operator to
retry logout; the stored session may still be present after an app restart.

## Refresh replay operation

Acquire synchronous exclusive operation ownership before any async work. Block
new login/logout/refresh transitions, await any already-running refresh, and only
then capture the current bound session. The existing refresh epoch guard prevents
stale local adoption but cannot undo a remotely consumed refresh token.

Begin a terminal generation and clear local credentials/socket through the
existing serialized writer. While holding ownership, use existing discovered
AuthSession.refreshAsync parameters to rotate R0 to R1 only in local memory.
Require a distinct nonempty refresh token. Replay R0 and require a typed
invalid_grant result; replay R1 and require typed invalid_grant to prove family
revocation. Network failures, generic exceptions and callback cancellation are
UNCONFIRMED, not negative acceptance. Never adopt either diagnostic response.

Cleanup stays scoped to operation owner/generation and completes before owner
release. Do not clear or revoke a later session. Do not persist/export/log tokens,
OAuth responses or complete exception objects. Output only step/result/reason
categories PASS/FAIL/UNCONFIRMED. Bounded timeouts/cancellation and captured
credential cleanup must be reviewed before implementation.

## Independent provider logout operation

Use a separate fresh login after the replay test invalidated its family. Obtain
A and B as independently live renewable families in the same Eri provider browser
session. Verify both can refresh before logout. Reuse the existing PKCE/browser
request and exchange helpers; adopt A normally and keep B only transiently in
memory. No separate provider adapter is introduced.

Normal mobile logout explicitly revokes A and opens Eri's browser confirmation.
Then B must fail refresh with typed invalid_grant. Sanitized provider-side
association evidence must establish both families belonged to the same provider
session; repeating Google login or merely observing a browser return is
insufficient. Integrate the existing browser operation owner so there is no gap
between preparing B and opening logout. Ensure failure/cancellation leaves proof
pending and cleans up only diagnostic-owned capability.

## Review and verification requirements

Independent Sol critique identified remote-refresh race, adoption during replay,
cleanup of later sessions and false-positive single-family logout as blockers.
Coordinator accepts these constraints; exact integration into timers, AppState,
authorizedFetch, manual token adoption, guest mode and browser callbacks needs
source design and tests before coding. A native Dev Settings entry can invoke the
bounded operator diagnostic; no tokens or technical implementation details appear
in its result presentation.

Test meaningful races and typed-error discrimination with existing provider tests,
then run real device execution against reviewed staging. Mocks prove only source
behavior. GitHub exact-SHA checks and sanitized provider/runtime evidence remain
required; this design satisfies none of the real acceptance gates by itself.
Native Sol/Luna usage counters are unavailable.

## Coordinator disposition after cross-family critique

Gemini Flash3.8 High review confirmed the need for diagnostic-aware browser-owner
handoff, a synchronous exclusive gate on all auth entry points before draining
an existing refresh, typed invalid_grant checks without adoption, and synchronous
preconditions before terminal clearing. These are requirements for the proposed
feature, not claims of existing production diagnostic vulnerabilities.

Two suggestions are rejected or constrained by source evidence. Eri IdClaims and
AccessClaims have no sid, so no client-side same-sid requirement or new token claim
is introduced. Same-provider-session proof remains a separate sanitized provider
inspection; the client must not claim that fact merely from equal subjects or a
browser callback. Likewise, Promise.race timeout alone cannot justify releasing
ownership while a browser or remote credential operation is still running.
A deadline must stop further diagnostic steps and mark UNCONFIRMED; ownership and
captured cleanup remain held until the underlying operation is settled/dismissed.
Never start a second operation or adopt a late result after the diagnostic expired.
The installed AuthSession token transport exposes no request abort parameter;
do not replace it with a parallel OAuth HTTP implementation to hide that limit.

Implementation will proceed in bounded slices. First implement only terminal
refresh replay and its staging Dev Settings entry, with actual AuthProvider race
coverage and production gating. Keep independent two-family provider logout as
an explicit remaining slice. Preconditions: __DEV__, native development variant
and exact scheme/client/issuer/resource/API, explicit public opt-in, authenticated
nonguest current bound session with a refresh token and no browser owner. Reject
without local/session/network changes if unavailable. Block new auth operations
before awaiting the refresh already in flight, then capture its completed result
and terminally clear via the existing writer. Test the drain gap and timers,
AppState, manual/guest/logout/login and 401 retries. No token, token fingerprint,
ID claims, raw error or OAuth response appears in the UI or logs.
