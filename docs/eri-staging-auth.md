# Eri staging authentication source contract

BAL-033's first server slice is an isolated staging adaptation. The default
`OIDC_IDENTITY_MODE=legacy_email` retains existing production email lookup and
first-user creation. Explicit `issuer_subject` mode has no email fallback and
requires separate configured REST/WSS and MCP resource audiences:

```text
OIDC_IDENTITY_MODE=issuer_subject
OIDC_ISSUER=https://auth-staging.shocker.cl
OIDC_AUDIENCE=https://balance-staging.shocker.cl/api
OIDC_MCP_RESOURCE=https://balance-staging.shocker.cl/api/mcp
WS_ALLOWED_ORIGINS=https://balance-staging.shocker.cl
SERVER_BIND_ADDR=127.0.0.1:8093
DATABASE_URL=<dedicated empty Balance staging database; root-only secret injection>
```

Do not put a real database URL in evidence. Infrastructure owns staging accounts,
database provisioning and exact reviewed artifact installation/activation.
`OIDC_JWKS_URL` remains a legacy-mode override; issuer_subject mode obtains JWKS
and UserInfo endpoints through standard discovery instead. Discovery's issuer
must match exactly, endpoints must use HTTPS on the configured issuer origin,
redirects are disabled and provider requests have a five-second timeout and
64 KiB response limit. Successful discovery is cached once for the process;
JWKS retains the existing five-minute cache and unknown-kid refresh behavior.
JWTs require RS256, `at+jwt`, issuer, configured audience, expiry and subject.
ID tokens are not accepted as API credentials.

The additive `oidc_user_identities` table maps `(issuer, subject)` to existing
Balance `users.id`. JWT verification stays local. An associated identity reads
its persisted Balance profile without contacting UserInfo. Only an unknown
identity calls the discovered UserInfo endpoint with its already verified access
token. Eri OpenID access tokens include the UserInfo audience; access and ID tokens
need not carry email or profile. UserInfo must return the exact subject and a
nonempty verified email. Failed/malformed/oversized provider responses create no
rows. A transaction with an identity advisory lock rechecks the mapping and
atomically inserts user plus association. Existing email collisions deny access;
there is no implicit linking, overwrite or production backfill. Provisioning
remains in Balance's existing user datasource and preserves domain ownership IDs.

This permits first-user creation in an empty staging database. Existing Keycloak
identity mapping and eventual production cutover require an explicit future
administrative migration policy. They are not performed by this slice.

The migration is forward-only and additive. Old binaries can continue to run
with the new empty table; application rollback leaves it in place. Apply schema
from the exact reviewed release before starting a binary that requires it, using
[the migration runbook](database-migrations.md). The generated schema snapshot is
regenerated from a fresh PostgreSQL 17 cluster and contains no user data.

`/health` is public readiness: a fresh `SELECT 1` bounded to one second returns
204, or 503 on failure/timeout, without database details. The existing default
bind and port-8080 overrides remain; the only additional bind is exactly
`127.0.0.1:8093`. Public or IPv6 port-8093 binds are rejected.

## Mobile opt-in configuration

The existing AuthSession/PKCE, SecureStore and serialized session writer remain
the mobile credential implementation. Production defaults continue to request
`openid profile email`, with no `resource` parameter. Staging explicitly selects:

```text
APP_VARIANT=development
EXPO_PUBLIC_OIDC_ISSUER=https://auth-staging.shocker.cl
EXPO_PUBLIC_OIDC_MOBILE_CLIENT_ID=balance-mobile-staging
EXPO_PUBLIC_OIDC_RESOURCE=https://balance-staging.shocker.cl/api
EXPO_PUBLIC_OIDC_SCOPES=openid profile email offline_access
EXPO_PUBLIC_API_URL=https://balance-staging.shocker.cl/api
EXPO_PUBLIC_WS_URL=wss://balance-staging.shocker.cl/api/ws/sync/application
EXPO_PUBLIC_WS_AUTH_MODE=application
```

These are public bundle configuration values, not runtime secrets. Resource
extras accompany authorize, code exchange and refresh. Scopes are whitespace
separated; `offline_access` permits the existing native refresh lifecycle.
Staging defaults to the legacy development redirect `balance-dev://auth-callback`
with interactive Eri consent. The new Android Dev build 1.2.1 (4), profile
`eri-staging`, opts into `EXPO_PUBLIC_OIDC_REDIRECT_URI=https://balance-staging.shocker.cl/auth-callback`.
Only the exact Android/development/staging binding permits this value; authorization
and exchange use the same URI. The native manifest includes its exact auto-verified
App Link. INF-015 must verify the actual APK signer and public assetlinks association
before enabling Eri preauthorization for that redirect. A new APK is required;
Metro/OTA cannot add the association to an installed binary. There is no custom-scheme
fallback from the HTTPS callback. Daily, production and web cannot select it.
Strict staging callback routes never adopt credentials from URL query parameters. Before exchanging a callback code, the mobile requires exact
`iss` when discovery advertises `authorization_response_iss_parameter_supported`.
Any returned issuer mismatch is rejected even if the provider did not advertise
support. PKCE and AuthSession's own callback/state validation remain in use.

New and manually adopted sessions persist issuer, client ID, optional resource
and API base URL alongside their existing lineage. Refresh preserves that binding.
Hydration discards mismatched or unbound sessions before provider/API requests or
cached-profile display. One-time unbound legacy migration is permitted only for
exact issuer `https://auth.shocker.cl/realms/balance`, client `balance-mobile`, no
resource and API `https://balance.shocker.cl/api`; the session is bound before
validation. Changing any of those endpoints cannot send a Keycloak refresh token
to Eri or present a profile from another backend. Web storage never persists or
returns a refresh token.

Starting login advances the existing session generation; every discovery,
browser and exchange completion checks it. Logout, a manual token, guest mode or
a newer login invalidates the older attempt. Credential adoption advances it again
to prevent an old-account refresh from overwriting the new login. A stale flow
cannot clear the current loading state or adopt its tokens.

SDK references used for this adaptation:
[Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and
[AuthSession extraParams/raw discovery metadata](https://docs.expo.dev/versions/v57.0.0/sdk/auth-session/).
This change has no new authentication framework or dependencies and does not
start Metro, build an APK, publish an OTA or prove device-level OAuth behavior.

## Remaining gates

This slice implements application WSS authentication and separate REST/MCP
resource metadata/challenges, without activating staging routes. Dashboard adaptation, provider browser logout,
real Google login, refresh/reuse, WSS/MCP runtime acceptance, source-bound artifact
publication and all original closure criteria remain outstanding. No production
API promotion or Keycloak retirement is authorized.

A main push currently triggers production client delivery. Do not merge this
slice until the coordinator resolves a reviewed staging-safe delivery route.
Passing tests or a reviewable PR is not publication or live authentication evidence.

Authenticated mobile data uses the API URL and user ID as its namespace outside
production. Production retains exactly `user:<id>`; staging uses
`user:<encoded API URL>:<id>`. All four stores and the sync connection share this
namespace, isolating cached collections, checkpoints and pending outbox writes.
Guest keys stay unchanged; existing production entries are neither moved nor
backfilled. Staging login rejects an API other than the staging API, and any
explicit resource must match that API before discovery.


## Application WebSocket contract

With `OIDC_IDENTITY_MODE=issuer_subject`, only `/ws/sync/application` is exposed
for sync; the upgrade bypasses HTTP bearer middleware and accepts only the
`balance` subprotocol. HTTP still requires `Authorization: Bearer`. URLs with a
query, Authorization on the upgrade, or credential-bearing subprotocols are
rejected. Configure `WS_ALLOWED_ORIGINS=https://balance-staging.shocker.cl` for
that browser origin. Values are exact HTTPS origins separated by whitespace.
The default empty allowlist denies browser Origins; absent native Origin is
accepted. Null, malformed, multiple and unlisted Origins are denied.

The first text frame is `{"event":"authenticate","accessToken":"..."}` without extra
fields, at most 16 KiB. A fixed 10-second deadline includes waiting, JWT
verification, UserInfo and database identity resolution; pings do not extend it.
The existing authoritative verifier/resolver supplies CurrentUser, then the
server sends `{"event":"authenticated"}`. No sync command or subscription runs
before that ACK. Strict transport frame/message limits are 2 MiB, preserving
existing document/import limits. Authentication failure/repeated authentication
closes with 4003; expired JWT closes with 4001, even while idle or continuously
receiving traffic. A mutation valid at dispatch may finish; later commands and
invalidations cannot run after expiry.

Mobile application mode sends the token only in that first frame and waits for
the ACK before pull/push/resync/outbox work. A 12-second ACK timeout closes and
uses existing reconnect backoff. Every socket callback is scoped to its socket,
namespace generation and captured credential; logout/replacement clears readiness,
timers and pending requests. Token rotation reconnects with the new token. A
4001 close blocks retrying the expired token until connect supplies a new token.
Missing WS mode retains the production legacy subprotocol flow. Staging public
configuration requires the exact staging application URL and application mode
before any login/network use; no credentials are placed in a URL or protocol.

Socket tests use only the permanently public synthetic Eri RSA fixture documented
under `apps/server/src/modules/auth/fixtures/PUBLIC-TEST-ONLY-README.md` and fresh
isolated PostgreSQL 17 schemas. Test signing fixtures must never enter runtime
configuration or sign staging/production tokens.


## REST and MCP protected resources

Strict startup requires exactly one canonical HTTPS `OIDC_AUDIENCE` with the
`/api` path and a distinct `OIDC_MCP_RESOURCE` equal to that URL plus `/mcp`.
Credentials, query, fragment, whitespace/control characters, CSV values and
values needing URL normalization are rejected. Configuration is validated before
opening the database connection. Legacy production CSV/empty-audience semantics,
metadata and challenge remain unchanged.

REST and WSS use only the REST audience. MCP uses a cloned verifier with only
the MCP audience; discovery, JWKS cache and HTTP client stay shared. Unknown-key
refresh therefore benefits both routes. Token `aud` may be an array containing
Eri UserInfo and the requested resource; UserInfo does not replace the route's
required resource. Identity provisioning remains the same authoritative resolver.

| Resource | Public metadata URL | Backend metadata route |
| --- | --- | --- |
| `https://balance-staging.shocker.cl/api` | `https://balance-staging.shocker.cl/.well-known/oauth-protected-resource/api` | `/.well-known/oauth-protected-resource` |
| `https://balance-staging.shocker.cl/api/mcp` | `https://balance-staging.shocker.cl/.well-known/oauth-protected-resource/api/mcp` | `/.well-known/oauth-protected-resource/mcp` |

Infrastructure owns forwarding these two exact public metadata URLs to their
respective backend routes. Backend routes are public and return JSON with
`Cache-Control: no-store`, the exact resource and configured issuer,
`bearer_methods_supported: ["header"]`, and scopes `openid profile email offline_access`.
Every HTTP 401 (including missing/invalid token or failed identity resolution)
carries `WWW-Authenticate: Bearer resource_metadata="<the matching public metadata URL>"`.
The validated header is derived at startup; Host, forwarded headers and request
URIs cannot influence it or metadata. Internal WebSocket failures stay challenge-free.

These path locations follow [RFC 9728 sections 3 and 5](https://www.rfc-editor.org/rfc/rfc9728.html)
and the [MCP authorization contract](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
Synthetic signed-token tests exercise the actual REST and MCP HTTP routes,
including cross-resource rejection, verified-UserInfo failure, exact challenges,
public metadata and Host independence. This is source evidence; it does not
claim Spark acceptance, live MCP/REST/WSS activation or provider retirement.


## Optional native staging browser logout

The default logout still clears Balance credentials/profile, disconnects sync and
best-effort revokes a captured native refresh token using discovered revocation.
Production configuration has no browser-logout opt-in. Native staging can enable:

```text
EXPO_PUBLIC_OIDC_BROWSER_LOGOUT_URL=https://auth-staging.shocker.cl/logout
```

This is Eri's reviewed provider-local confirmation endpoint, **not** an advertised
OIDC `end_session_endpoint`; no endpoint discovery or `id_token_hint` is invented.
The only permitted context is the exact staging issuer/client/API with native
Balance Dev scheme, returning exactly `balance-dev://logout-callback`. Infrastructure
must separately register that URI in `balance-mobile-staging.post_logout_redirects`
(the login redirects declaration alone does not register it), validate/review the
Eri config artifact and apply it before real browser acceptance. This source change
does not apply that provider configuration or claim browser runtime compatibility.

Login and opt-in browser logout acquire one synchronous browser-operation owner
before any await. Default production revocation-only logout does not acquire a
browser owner or block a new login while the captured revocation is pending.
A new login or duplicate logout cannot begin while logout owns the browser; owner
release cannot release another operation. Logout during an already pending login
invalidates its generation, clears local state and revokes the captured refresh
family, but never queues a browser logout after that login. This matters because
an epoch guard alone cannot prevent stale remote logout from revoking new SSO.
Settings shows progress and ignores duplicate taps; the existing login progress
state also reflects the browser owner.

Local clearing happens before storage/network/browser awaits. Staging revocation
runs independently with captured credentials and handled failures, so offline
revocation cannot delay the browser flow; a revocation request completing later
never updates local state. Browser logout also runs when no refresh token exists.
The existing WebBrowser auth-session transport uses `preferEphemeralSession:false`
to access the provider cookie context. A 32-byte cryptographic state comes from
`Crypto.getRandomBytesAsync`, without its synchronous API's development random
fallback. The exact return URI and singleton state must match; credentials, extra
parameters, fragments, controls, missing/duplicate state and altered paths are
rejected. The logout callback route reads/adopts/exchanges no credentials.

A matching current return confirms the Eri logout callback; cancellation/error or
superseded generation leaves SSO unconfirmed while keeping local logout. Settings
states this plainly for an unconfirmed outcome. No outcome claims successful
refresh revocation merely because the request was attempted. Nor does Eri logout
sign out the user's Google account or invalidate already-issued access JWTs before
expiry. Independent real tests must prove refresh `invalid_grant` and loss of the
Eri SSO session in the same browser context; a separately live family avoids a
false-positive cookie test caused solely by the explicit refresh revocation.

Actual AuthProvider tests with mocked browser, storage and provider adapters cover
pending login/logout overlap, duplicate logout, immediate clearing, logout without
refresh, pending/offline revocation, generation changes during storage/browser
completion, invalid returns, cancel/error and unchanged production behavior.
[Expo57 WebBrowser](https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/) documents
the authentication browser context; [Expo57 Crypto](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/)
documents cryptographic state generation. These tests do not replace device/SSO
acceptance or provider runtime review.
