# Uso diario Android con EAS

Esta guía describe cómo usar Balance diariamente sin Metro ni el servidor de desarrollo.

## Perfiles y canales

| Perfil de build | Uso | Canal de actualizaciones |
|---|---|---|
| `development` | Dev Client + Metro | `development` |
| `preview` | APK interna para uso diario personal | `daily` |
| `production` | Futura distribución mediante Google Play | `production` |

La APK `preview` queda vinculada al canal `daily`. Metro sólo se usa durante el desarrollo local.

## Primera instalación

Desde una rama integrada y validada:

```bash
cd apps/mobile
npx eas-cli@latest build --platform android --profile preview
```

EAS entrega un enlace para descargar e instalar la APK en Android. La build usa la API pública `https://balance.shocker.cl/api` y el WebSocket `wss://balance.shocker.cl/api/ws/sync`.

Con Wi-Fi apagado, comprobar:

1. Inicio de sesión OAuth y retorno por `balance://`.
2. Lectura y escritura contra la API HTTPS.
3. Sincronización WSS y cierre de sesión.

## Actualizaciones OTA

Una vez instalada la APK, los cambios compatibles de JavaScript, estilos y lógica se publican explícitamente al canal diario:

```bash
cd apps/mobile
npx eas-cli@latest update --channel daily --message "describe el cambio"
```

Al abrir o reiniciar la app, esta descarga la actualización y la aplica según la política de Expo Updates. No hace falta reinstalar la APK.

Los cambios nativos requieren una nueva APK: dependencias nativas, permisos, iconos, configuración Expo o `runtimeVersion`.

## Flujo de ramas

- `main` se mantiene estable y no recibe commits directos.
- Cada hito usa una rama corta (`feature/...`, `fix/...` o `hotfix/...`), preferentemente en un Git Worktree.
- El cambio se integra mediante Pull Request contra `main` tras validación.
- Un push de código no publica OTA automáticamente; la publicación a `daily` es una acción explícita.
- La promoción a Google Play se hará desde una versión aprobada, nunca desde cada push.

## Seguridad

Las variables `EXPO_PUBLIC_*` se incrustan en la aplicación. No guardar allí secretos, claves Gemini, client secrets OAuth ni credenciales. Esos valores viven únicamente en backend o en el gestor de secretos correspondiente.
