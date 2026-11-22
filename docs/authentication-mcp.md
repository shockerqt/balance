# Autenticación y MCP remoto

## Configuración por entorno

Balance expone MCP mediante Streamable HTTP en la ruta pública `/api/mcp`.
Configura la URL completa y el servidor de autorización del entorno aprobado
para tu conector.

| Configuración de referencia | URL del recurso MCP | URL pública de metadatos del recurso |
| --- | --- | --- |
| Compatibilidad histórica con Keycloak (`legacy_email`) | `https://balance.shocker.cl/api/mcp` | `https://balance.shocker.cl/api/.well-known/oauth-protected-resource/mcp` |
| Staging Eri en modo estricto (`issuer_subject`) | `https://balance-staging.shocker.cl/api/mcp` | `https://balance-staging.shocker.cl/.well-known/oauth-protected-resource/api/mcp` |

La primera fila corresponde a los valores heredados del código. La segunda
describe el contrato de staging y requiere el reenvío de la ruta pública por
Infrastructure. Confirma con el responsable de identidad el issuer activo, el
cliente OAuth aprobado, su registro y los redirects de cada entorno antes de
habilitar la conexión. [Configuración de identidad de staging](eri-staging-auth.md#rest-and-mcp-protected-resources)

La API usa `OIDC_IDENTITY_MODE`, `OIDC_ISSUER` y `OIDC_AUDIENCE`. En modo
estricto, `OIDC_AUDIENCE` es la URL exacta del recurso REST terminada en
`/api` y `OIDC_MCP_RESOURCE` es esa URL seguida de `/mcp`. La API exige la
audiencia de MCP en ese endpoint. En modo heredado, la configuración admite
`OIDC_AUDIENCE` vacía o una lista separada por comas y emplea `OIDC_JWKS_URL`
si se configura.

## OAuth y solicitudes desde el navegador

Envía el token de acceso OAuth en `Authorization: Bearer <token>`. Ante un
`401`, lee el desafío Bearer de `WWW-Authenticate`. Si incluye
`resource_metadata`, consulta esa URL pública y usa el campo
`authorization_servers` de los metadatos del recurso para descubrir el servidor
de autorización. Obtén un token para el recurso MCP de ese entorno antes de
reintentar. Mantén los tokens fuera de URLs, registros y repositorios.

Infrastructure configura `MCP_ALLOWED_ORIGINS` en cada servicio de la API con
los orígenes de navegador aprobados. Es una lista separada por comas de orígenes
HTTP(S) exactos, con esquema, host y puerto no predeterminado cuando corresponda.
Los orígenes se escriben sin ruta, barra final, consulta, fragmento ni
credenciales. El servidor valida la lista durante el arranque. Una lista vacía
o ausente permite las solicitudes sin `Origin`. Las solicitudes con `Origin`
requieren una coincidencia exacta. Un valor `null`, repetido, combinado,
malformado o ajeno a la lista devuelve `403`.

El navegador envía un preflight `OPTIONS` con el origen, el método solicitado
`POST` y los nombres `authorization, content-type, mcp-protocol-version` en
`Access-Control-Request-Headers`. Ese preflight omite el token Bearer y la
cabecera de versión propiamente dicha. Para un origen aprobado, devuelve
`200` y las cabeceras CORS con el origen, método y nombres permitidos. Un valor
explícito inválido de `MCP-Protocol-Version` devuelve `400` en cualquier método,
incluido `OPTIONS`. En las respuestas que pasan ambos controles, CORS expone
`WWW-Authenticate` a los scripts de los orígenes aprobados, incluido el desafío
Bearer de un `401`.

## Inicialización y llamadas

`MCP_URL` es la URL completa del endpoint `/mcp` para el entorno seleccionado.
`MCP_ACCESS_TOKEN` es el token de acceso OAuth. Define ambas variables en la
sesión de shell antes de ejecutar este ejemplo.

```bash
curl --request POST "$MCP_URL" \
  --header "Authorization: Bearer $MCP_ACCESS_TOKEN" \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"balance-example","version":"1.0.0"}}}'
```

Los clientes anuncian ambos tipos en `Accept` según el contrato de Streamable
HTTP. Balance devuelve las respuestas JSON-RPC como `application/json` y opera
sin SSE ni identificador de sesión. Cada POST lleva un solo objeto JSON-RPC 2.0,
con un ID de cadena o entero representable para las solicitudes y sin `id`
para las notificaciones. Evita lotes, miembros duplicados en el objeto principal
e IDs nulos o decimales.

`initialize` requiere una propuesta de versión con formato `AAAA-MM-DD`, un
objeto `capabilities` y un objeto `clientInfo` con `name` y `version` de tipo
cadena. Balance devuelve `2025-11-25` o `2025-06-18` si el cliente la propone.
Frente a otra versión bien formada ofrece `2025-11-25`. Si el cliente admite la
versión recibida en `result.protocolVersion`, envía
`notifications/initialized` y usa ese valor en `MCP-Protocol-Version` en cada
solicitud posterior. Cuando falta la cabecera después de inicializar, Balance
aplica la compatibilidad de `2025-03-26` a las operaciones comunes de mensaje
único. Un valor explícito solo puede ser una de las dos versiones negociables.

| Respuesta | Acción del cliente |
| --- | --- |
| HTTP `200` JSON-RPC | Revisa `error` y `result.isError`. Corrige el método si recibes `-32601`, o los parámetros o el nombre de la herramienta si recibes `-32602`. Para `isError: true`, usa el código y mensaje de la herramienta antes de decidir si volver a intentar. |
| HTTP `202` sin cuerpo | Balance recibió `notifications/initialized` o `notifications/cancelled`. El acuse de cancelación solo confirma la recepción. |
| HTTP `400` | Corrige la cabecera de versión, el JSON (`-32700`) o la estructura del mensaje (`-32600`). Las respuestas del cliente no solicitadas y las notificaciones incompatibles reciben un `400` vacío. |
| HTTP `401` | Sigue el desafío Bearer y reintenta con un token válido para MCP. |
| HTTP `403` | Corrige el origen o usa un origen aprobado para ese servicio. |
| HTTP `405` | Usa POST para los mensajes MCP. Un GET que pasa las validaciones de encabezados devuelve `405`. |

Consulta `tools/list` para obtener los esquemas y llama a `tools/call` con
`params.name` y un objeto `params.arguments`. Si lo omites, se usa un objeto
vacío. Las operaciones actúan con el usuario del token.

## Herramientas

Las fechas se interpretan en `America/Santiago` y se envían como
`AAAA-MM-DD`. Para consumos, usa `HH:MM` en formato de 24 horas y envía
`date` y `time` juntos cuando indiques una hora. Trata los identificadores
como valores opacos y conserva las mayúsculas y minúsculas, en particular en
los IDs de porciones.

| Herramienta | Uso |
| --- | --- |
| `search_foods` | Busca en el catálogo por nombre o marca sin distinguir mayúsculas ni acentos. `query` debe tener de 1 a 120 caracteres tras recortar espacios. `source` acepta `all` (predeterminado), `personal` u `official`. `limit` va de 1 a 20 y por defecto es 10. Pasa el `foods[].id` seleccionado como `log_food.arguments.foodId`. |
| `get_daily_log` | Lee un día de Santiago por llamada. `date` omitido equivale a hoy. Los consumos conservan una copia de los datos usados en el registro, incluida su nutrición y conversión. La respuesta incluye los totales nutricionales del día. |
| `create_food` | Crea un alimento personal. `name` admite hasta 160 caracteres, `brand` opcional hasta 120 y `category` hasta 80. Admite hasta 50 porciones con nombre e ID único (hasta 80 caracteres por ID) y hasta cuatro sellos chilenos. Declara la nutrición por 100 g o 100 ml según `canonicalUnit`. Para reintentar la misma creación, reutiliza el mismo `operationId` y los mismos datos. |
| `log_food` | Pon el `foods[].id` seleccionado en `arguments.foodId`. Envía una `quantity` positiva en g o ml según la unidad canónica. Con `portionId`, la cantidad es el número de porciones de ese tipo. Envía `date` y `time` juntos u omite ambos para usar la fecha y hora actuales. Para reintentar el mismo registro, reutiliza el mismo `operationId` y los mismos datos. |
| `update_food_log` | Envía el `logId` y una cantidad positiva, el par `date` y `time`, o ambos cambios. La cantidad aplica la conversión guardada en la entrada histórica. |
| `delete_food_log` | Confirma el `logId` seleccionado antes de borrar. MCP carece de una herramienta para restaurar la entrada. Si corresponde volver a registrar el consumo, crea una entrada nueva con sus propios identificadores y con la fecha, hora y cantidad originales disponibles. |
| `get_weight_history` | Requiere activar el seguimiento de peso en Configuración. Envía ambos límites inclusivos (`startDate` y `endDate`) u omite ambos. El rango debe estar ordenado y terminar como máximo hoy en Santiago. `limit` va de 1 a 366 y por defecto es 30. |
| `set_weight` | Requiere seguimiento de peso. Guarda un valor por fecha de Santiago, entre 1 y 500 kg, con hasta un decimal. Repetir el mismo valor en la misma fecha es idempotente. Para restaurar un peso, usa `set_weight` con el valor y la fecha originales. |
| `delete_weight_log` | Requiere seguimiento de peso y confirmar la fecha que se va a borrar. Omite `date` solo para operar sobre hoy. `deleted` indica que se borró la medición y `alreadyDeleted` que ya estaba borrada. Si la solicitud se reintenta, fija la misma fecha de Santiago. |

### Búsqueda en el catálogo

El catálogo combina nombres en español e inglés y conserva su escritura al
mostrarlos. La búsqueda literal encuentra fragmentos en el nombre y la marca.
Si toda la consulta coincide con una de estas variantes, también busca las
demás como palabras completas en el nombre del alimento.

| Alimento | Variantes |
| --- | --- |
| Pollo | `pollo`, `pollos`, `chicken`, `chickens` |
| Papa | `papa`, `papas`, `patata`, `patatas`, `potato`, `potatoes` |
| Palta | `palta`, `paltas`, `aguacate`, `aguacates`, `avocado`, `avocados` |

Con `hasMore: true`, hay coincidencias elegibles fuera de la lista mostrada.
Refina la consulta por nombre, marca o `source`. Si usaste un límite menor,
puedes aumentarlo hasta 20. Por ejemplo, en un catálogo de prueba con 21
alimentos «Avena lote», `{"query":"avena lote","limit":20}` deja fuera
«Avena lote 21». `{"query":"avena lote 21"}` recupera el ID de ese alimento.

Si la lista está vacía, vuelve a buscar en el otro idioma. Pide confirmación
antes de crear un alimento. Una lista parcial deja pendiente la identificación
del alimento y si se encuentra en el catálogo. Si hay varios candidatos,
preséntalos con sus nombres y marcas y pide al usuario elegir un `foodId`.
Usa `get_daily_log` para consultar consumos.

Si una conexión se corta o expira después de enviar una escritura, conserva la
identidad y los datos de esa operación para un reintento idempotente. Envía una
fecha y hora explícitas desde el primer intento de `log_food` cuando debas
conservar el instante previsto. Para una edición o un borrado de comidas,
consulta el día correspondiente si debes confirmar el estado antes de repetir
la acción.

Al reintentar una escritura de peso, envía explícitamente la misma fecha
prevista en Santiago y, para `set_weight`, el mismo valor. Si omites `date`, el
servidor vuelve a resolver la fecha en cada intento y puede cambiar al cruzar la
medianoche en Santiago.

## Referencia histórica del cliente móvil

La configuración histórica de Keycloak usaba el realm
`https://auth.shocker.cl/realms/balance` con el cliente público
`balance-mobile` y Authorization Code con PKCE. Los valores de referencia
de esa configuración eran los siguientes.

```env
EXPO_PUBLIC_API_URL=https://balance.shocker.cl/api
EXPO_PUBLIC_WS_URL=wss://balance.shocker.cl/api/ws/sync
EXPO_PUBLIC_OIDC_ISSUER=https://auth.shocker.cl/realms/balance
EXPO_PUBLIC_OIDC_MOBILE_CLIENT_ID=balance-mobile
```

Las variantes Production, Development y Daily usaban respectivamente
`balance://auth-callback`, `balance-dev://auth-callback` y
`balance-daily://auth-callback`. El modo heredado de sincronización WebSocket
enviaba el token mediante el subprotocolo `balance.bearer.<JWT>` y negociaba
`balance`. Confirma la configuración vigente de cada entorno con su
responsable de identidad.
