# Eri production release preparation

INF-017 owns production infrastructure and activation; BAL-033 owns these
consumer changes. The source candidate now defaults reviewed Android Dev/Daily and dashboard builds
to Eri. This is not activation evidence: production publication remains paused,
and existing running services and the Daily native compatibility baseline are not
changed by these source defaults.

## Candidate Android builds

The `eri-production-dev` and `eri-production-daily` EAS profiles inherit the
existing Development and internal preview distribution mechanisms. Both use
version 1.6.0/code 9 with distinct packages and verified HTTPS paths:

| Variant | Client | HTTPS callback |
|---|---|---|
| Dev | `balance-mobile-dev` | `https://balance.shocker.cl/auth-callback/dev` |
| Daily | `balance-mobile-daily` | `https://balance.shocker.cl/auth-callback/daily` |

Dev also retains its existing staging callback. Exact paths prevent Dev and
Daily from claiming the same callback when installed together. APK signatures
must match the existing variants and the reviewed public assetlinks before use.
The profiles opt in to issuer `https://auth.shocker.cl`, resource/API
`https://balance.shocker.cl/api`, scopes `openid profile email offline_access`,
application-frame WSS at `wss://balance.shocker.cl/api/ws/sync/application`, and
account choices. Diagnostic UI has been removed. Android production account
choices require exact issuer/client/API/resource/variant/scheme/development
bindings; iOS and web are not implicitly provisioned by the Android release.

The candidate APK builds use version 1.6.0/code 9 from integrated source
`aa3221`; their configured build profiles already supply the production binding.
The later configuration-only JavaScript delta selects the same binding from
`Constants.expoConfig.extra.appVariant` for Android `development` and `daily`.
Thus an OTA exported without public environment overrides retains Eri rather
than falling back to Keycloak. Other variants, iOS and web do not automatically
inherit those Android bindings or account choices. Explicit public configuration
continues to override defaults and keeps staging isolated.

Before activation, verify the APK/build receipts, exact exported bundle and any
explicit public EAS preview environment overrides. An old explicit issuer/API
still wins over defaults and can select the old environment. Do not promote the
native baseline or publish an OTA until the new Daily APK and complete runtime
configuration are verified. Keep the existing native compatibility gate strict.
No artifact publication or live authentication acceptance is claimed here.

## Dashboard candidate

The dashboard source candidate defaults to the following production Eri binding.
Explicit build settings remain authoritative; inspect the final artifact before
coordinated activation:

```
VITE_OIDC_ISSUER=https://auth.shocker.cl
VITE_OIDC_CLIENT_ID=balance-dashboard
VITE_OIDC_REDIRECT_URI=https://balance.shocker.cl/
VITE_OIDC_RESOURCE=https://balance.shocker.cl/api
VITE_OIDC_SCOPES=openid profile email offline_access
VITE_API_URL=https://balance.shocker.cl/api
VITE_WS_URL=wss://balance.shocker.cl/api/ws/sync/application
VITE_WS_AUTH_MODE=application
```

Explicit legacy or staging issuer/API settings do not inherit the production
resource, renewable scopes or application mode. The existing loopback Keycloak
E2E build retains its declared legacy WebSocket URL and transport without a
production resource. Staging must explicitly provide its own complete binding.

Discovery supplies authorization/token/revocation endpoints; do not construct
Keycloak-specific paths for Eri. User identity comes from authenticated `/me`,
not unverified ID-token content. WSS must receive its authentication ACK before
sync/outbox traffic. Ordinary logout clears local state and revokes renewable
capability; it does not sign the user out of Google or remove provider SSO.

## Cutover prerequisites

Production Google OAuth Web credentials are separate from staging, with callback
`https://auth.shocker.cl/federation/google/callback`. Current production Balance
needs the additive identity-association migration and an explicitly reviewed
private association plan preserving existing numeric user IDs and domain data.
Never automatically link accounts solely by email. Root-owned backup, catalog/
ledger comparison, migration/rollback rehearsal, exact integrated artifacts,
production resource/issuer/callback/CORS/cache declarations and final approval
remain required. INF-008 still requires real MCP OAuth acceptance before
Keycloak retirement. Neither mock tests nor building these APKs satisfies it.

## Browser interaction

Remembered account metadata cannot restore revoked credentials. Reopening an
existing renewable session already avoids browser authorization. After actual
logout, continuing an account requests fresh authorization; valid Eri browser
SSO can complete it without additional clicks, but AuthSession may briefly show
the browser. A local lock or another native credential broker would be a
separate product/security decision, not a hidden change to logout semantics.
