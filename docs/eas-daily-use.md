# Uso diario Android con EAS

Esta guía describe cómo usar Balance diariamente sin Metro ni el servidor de desarrollo.

## Perfiles y canales

| Perfil de build | Uso | Canal de actualizaciones |
|---|---|---|
| `development` | Dev Client + Metro | `development` |
| `preview` | APK interna para uso diario personal | `daily` |
| `production` | Futura distribución mediante Google Play | `production` |

La APK `preview` queda vinculada al canal `daily`. Metro sólo se usa durante el desarrollo local.

Las tres variantes se instalan en paralelo y tienen callbacks OAuth distintos:

| Variante | Paquete Android | Callback OAuth |
|---|---|---|
| Development | `com.balance.app.dev` | `balance-dev://auth-callback` |
| Daily (`preview`) | `com.balance.app.daily` | `balance-daily://auth-callback` |
| Production | `com.balance.app` | `balance://auth-callback` |

Keycloak debe permitir los tres callbacks anteriores.

## Primera instalación

Desde una rama integrada y validada:

```bash
cd apps/mobile
npx eas-cli@latest build --platform android --profile preview
```

EAS entrega un enlace para descargar e instalar la APK en Android. La build usa la API pública `https://balance.shocker.cl/api` y el WebSocket `wss://balance.shocker.cl/api/ws/sync`.

Con una red externa y sin Metro, comprobar:

1. Inicio de sesión OAuth y retorno por `balance-daily://auth-callback`.
2. Lectura y escritura contra la API HTTPS.
3. Sincronización WSS y cierre de sesión.

## Actualizaciones OTA

Una vez instalada la APK, los cambios compatibles de JavaScript, estilos y lógica se publican explícitamente al canal diario:

```bash
cd apps/mobile
APP_VARIANT=daily npx eas-cli@latest update \
  --channel daily \
  --environment preview \
  --platform android \
  --message "describe el cambio"
```

`APP_VARIANT=daily` conserva la configuración y el callback de la APK Daily. `--environment preview` es obligatorio para actualizaciones no interactivas en Expo SDK 57. La publicación no crea una APK.

Para verificar una OTA en el teléfono:

1. Abrir Balance Daily con conexión a internet y esperar a que descargue la actualización.
2. Cerrar por completo la app desde recientes.
3. Abrirla nuevamente y probar el cambio publicado. Si aún no aparece, repetir una vez el cierre y apertura.

No hace falta reinstalar la APK para un cambio OTA compatible.

Los cambios nativos requieren una nueva APK: dependencias nativas, permisos, iconos, configuración Expo o `runtimeVersion`.

### Publicación desde CI

La exportación OTA normal debe ejecutarse en un runner con un compilador Hermes compatible; se recomienda x86_64. El host ARM actual no puede ejecutar el binario Hermes x86_64 incluido por la dependencia. La exportación sin bytecode (`expo export --no-bytecode`) se usó solamente para una OTA de prueba y Expo la considera una alternativa de depuración: no debe convertirse en el procedimiento habitual.

## Flujo de ramas

- `main` se mantiene estable y no recibe commits directos.
- Cada hito usa una rama corta (`feature/...`, `fix/...` o `hotfix/...`), preferentemente en un Git Worktree.
- El cambio se integra mediante Pull Request contra `main` tras validación.
- Un push de código no publica OTA automáticamente; la publicación a `daily` es una acción explícita.
- La promoción a Google Play se hará desde una versión aprobada, nunca desde cada push.

## Seguridad

Las variables `EXPO_PUBLIC_*` se incrustan en la aplicación. No guardar allí secretos, claves Gemini, client secrets OAuth ni credenciales. Esos valores viven únicamente en backend o en el gestor de secretos correspondiente.
