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

| Variante | Paquete Android | Callback OAuth | Fondo del icono |
|---|---|---|---|
| Development | `com.balance.app.dev` | `balance-dev://auth-callback` | `#2B1A3D` |
| Daily (`preview`) | `com.balance.app.daily` | `balance-daily://auth-callback` | `#0E2A2A` |
| Production | `com.balance.app` | `balance://auth-callback` | `#010517` |

Las tres comparten el logo; el color de fondo del icono adaptativo es lo que las
distingue en el launcher.

Keycloak debe permitir los tres callbacks anteriores. **Es un prerequisito:** sin
los tres redirect URIs registrados, el login falla en la variante que falte —
incluida la de desarrollo, que cambió de `balance://` a `balance-dev://`.

Cambiar el paquete Android también implica que la app de desarrollo instalada
hoy pasa a ser una instalación distinta: los registros locales del modo invitado
no se migran.

## Primera instalación

Desde una rama integrada y validada:

```bash
cd apps/mobile
npx eas-cli@21.7.0 build --platform android --profile preview
```

La versión del CLI va fijada a propósito. `@latest` cambió el valor por defecto
de `cli.appVersionSource` entre versiones mayores, y si la build y la OTA
resuelven `runtimeVersion` distinto, la actualización nunca llega al teléfono y
no hay error visible. Por eso `eas.json` declara `appVersionSource: "local"`:
el `runtimeVersion` sale siempre del `version` de `app.json`.

EAS entrega un enlace para descargar e instalar la APK en Android. La build usa la API pública `https://balance.shocker.cl/api` y el WebSocket `wss://balance.shocker.cl/api/ws/sync`.

Con una red externa y sin Metro, comprobar:

1. Inicio de sesión OAuth y retorno por `balance-daily://auth-callback`.
2. Lectura y escritura contra la API HTTPS.
3. Sincronización WSS y cierre de sesión.

## Actualizaciones OTA

Una vez instalada la APK, los cambios compatibles se publican mediante el pipeline descrito abajo. El siguiente comando explica la operación ejecutada por CI; no sustituye sus gates:

```bash
cd apps/mobile
APP_VARIANT=daily npx eas-cli@21.7.0 update \
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
Antes de construirla, se debe incrementar `expo.version` —y `android.versionCode`—
para que la política `runtimeVersion: appVersion` impida que una OTA destinada
al binario nuevo llegue a instalaciones antiguas incompatibles.

### Publicación desde CI

La exportación OTA normal debe ejecutarse en un runner con un compilador Hermes compatible; se recomienda x86_64. El host ARM actual no puede ejecutar el binario Hermes x86_64 incluido por la dependencia. La exportación sin bytecode (`expo export --no-bytecode`) se usó solamente para una OTA de prueba y Expo la considera una alternativa de depuración: no debe convertirse en el procedimiento habitual.

Cada push integrado a `main` ejecuta **Deliver Balance Clients**: pruebas del
dominio, móvil/Hermes, dashboard y navegador antes de publicar Android en Daily.
La publicación usa ese mismo commit y se detiene si otro commit lo reemplazó.
Para reintentar una entrega, ejecutar ese workflow manualmente desde `main`;
no ejecutar el workflow reutilizable de OTA directamente.

`delivery/daily-runtime.json` identifica la APK de referencia. El gate compara
configuración, assets, dependencias y lockfile con su commit. Excluye scripts
npm y el paquete TS puro `@balance/domain`, que debe conservar cero dependencias
externas, hooks de instalación y configuración nativa. También permite la adición
verificada de `react-test-renderer@19.2.3` solo para pruebas, con manifiestos y
entrada de lock exactos; las condiciones acotadas están en `delivery.md`.
Un cambio incompatible
produce `NEW_APK_REQUIRED`; crear y verificar una APK nueva antes de actualizar
la referencia mediante PR. Esta comprobación conservadora puede exigir revisión
para cambios inocuos; no equivale a inferir compatibilidad solo por versión.

Los workflows conservan los IDs de actualización y grupo, runtime, SHA y resultado.
Un reintento del mismo SHA recupera la actualización existente. **Roll back
Balance Daily** restaura un grupo Android previamente publicado, verificando el
grupo actual esperado. Deshabilitar primero Deliver Balance Clients si se necesita
mantener un rollback mientras se prepara la corrección. Una publicación EAS
confirmada no implica que todos los teléfonos ya hayan descargado la OTA.

Las Development Builds no se compilan en GitHub Actions. Se crean y
distribuyen mediante el perfil `development` de Expo EAS.

Antes del primer uso, crear el entorno protegido `preview` en GitHub y añadir allí el secreto `EXPO_TOKEN`, con un token de Expo que pueda publicar actualizaciones para `@shocker/balance`. No guardar ese token en el repositorio ni en variables `EXPO_PUBLIC_*`.

## Flujo de ramas

- `main` se mantiene estable y no recibe commits directos.
- Cada hito usa una rama corta (`feature/...`, `fix/...` o `hotfix/...`), preferentemente en un Git Worktree.
- El cambio se integra mediante Pull Request contra `main` tras validación.
- Un merge a `main` publica a `daily` después de superar los checks y el gate de compatibilidad.
- La promoción a Google Play se hará desde una versión aprobada, nunca desde cada push.

## Seguridad

Las variables `EXPO_PUBLIC_*` se incrustan en la aplicación. No guardar allí secretos, claves Gemini, client secrets OAuth ni credenciales. Esos valores viven únicamente en backend o en el gestor de secretos correspondiente.
