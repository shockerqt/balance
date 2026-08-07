# Autenticación y MCP remoto

## Componentes

- **Keycloak** es el único servidor de autorización: `https://auth.shocker.cl/realms/balance`.
- **Google** es un proveedor de identidad configurado dentro de Keycloak; sus credenciales no pertenecen a la API de Balance.
- **Balance API** valida access tokens RS256 contra el JWKS del issuer. Al primer acceso crea o asocia el usuario local por e-mail.
- **Móvil** usa Authorization Code con PKCE para el cliente público `balance-mobile`. El token se guarda con `expo-secure-store` en nativo; en web usa el almacenamiento local existente.

## Configuración del móvil

Valores de producción, configurables por variables `EXPO_PUBLIC_*`:

```env
EXPO_PUBLIC_API_URL=https://balance.shocker.cl/api
EXPO_PUBLIC_WS_URL=wss://balance.shocker.cl/api/ws/sync
EXPO_PUBLIC_OIDC_ISSUER=https://auth.shocker.cl/realms/balance
EXPO_PUBLIC_OIDC_MOBILE_CLIENT_ID=balance-mobile
```

El redirect URI registrado en Keycloak es `balance://auth-callback`. Toda nueva
build nativa debe incluir `expo-auth-session`, `expo-crypto` y
`expo-secure-store` (ya declarados en `apps/mobile/package.json`).

La sincronización WebSocket envía el access token en el subprotocolo
`balance.bearer.<JWT>` y negocia `balance`; no se agrega el token a la URL.

## MCP por HTTP

El único endpoint soportado es:

```text
https://balance.shocker.cl/api/mcp
```

Es un endpoint Streamable HTTP JSON-RPC, protegido con Bearer OAuth. No se
soportan `/mcp/sse`, `/mcp/messages`, ni el antiguo servidor stdio. La metadata
del recurso protegido está en:

```text
https://balance.shocker.cl/api/.well-known/oauth-protected-resource/mcp
```

Las herramientas actuales se ejecutan en el contexto del usuario del token:
`get_foods`, `search_foods`, `parse_food_text` y `get_official_templates`.

`get_foods`, `search_foods` y `get_official_templates` se anuncian como operaciones de solo lectura e idempotentes mediante anotaciones MCP. `parse_food_text` no recibe esa marca porque delega el análisis a Gemini. Gemini/Spark conserva la decisión final sobre confirmaciones; no se suprimen confirmaciones para operaciones mutables.


## Clientes ChatGPT y Gemini

El authorization server publica OIDC discovery y el endpoint de Dynamic Client
Registration de Keycloak. Antes de habilitar una integración externa se debe
configurar una política de registro limitada a los redirects oficiales del
cliente correspondiente; no se habilita registro anónimo sin restricciones.
ChatGPT admite OAuth con Client ID Metadata Documents y también DCR cuando está
configurado. Registrar y probar cada cliente en un entorno no productivo antes
de habilitar herramientas con mutación.

## Operación

Variables de la API:

```env
OIDC_ISSUER=https://auth.shocker.cl/realms/balance
OIDC_JWKS_URL=https://auth.shocker.cl/realms/balance/protocol/openid-connect/certs
OIDC_AUDIENCE=balance-api
```

`OIDC_JWKS_URL` es opcional. El servidor deriva esa URL desde el issuer y conserva el JWKS en memoria durante cinco minutos; si llega un `kid` nuevo, lo refresca inmediatamente. `OIDC_AUDIENCE` permanece vacío durante la transición. Antes de definirlo como `balance-api`, agregar esa audiencia a los access tokens de **todos** los clientes de Keycloak que consumen la API (móvil y MCP); desde ese momento la API la exigirá. Nunca
guardar contraseñas de Keycloak, secretos Google, tokens Cloudflare ni JWT en el
repositorio.
