# balance

Registro nutricional y corporal: anotas lo que comes, contrastas tus objetivos
diarios y, si lo deseas, mantienes un registro diario de peso.

Monorepo con tres aplicaciones independientes —no comparten dependencias entre
sí, cada una se instala y se ejecuta por su cuenta.

```
apps/
  mobile/      App Expo 57 / React Native 0.86 con expo-router
  dashboard/   Panel web Vite / React 19 / TypeScript 7 / Base UI
  server/      API Axum (Rust 2024) con SQLx/Postgres, OIDC/Keycloak y Gemini
```

## Requisitos

- **Node 24** (ver `apps/mobile/.node-version`)
- **npm** — no pnpm ni yarn, ver [Gestor de paquetes](#gestor-de-paquetes)
- **Rust** edition 2024 y `cargo`, más [`cargo-watch`](https://crates.io/crates/cargo-watch) para el hot reload del server
- **Postgres** accesible vía `DATABASE_URL`

## Puesta en marcha

Cada aplicación instala sus dependencias por separado:

```bash
npm install                        # utilidades de la raíz (concurrently, prettier)
npm --prefix apps/mobile install
npm --prefix apps/dashboard install
```

El server necesita `apps/server/.env` con:

```env
DATABASE_URL=postgres://meal_admin:...@localhost:5432/meal_logger
OIDC_ISSUER=https://auth.shocker.cl/realms/balance
# Opcional: se deriva de OIDC_ISSUER si no se define.
OIDC_JWKS_URL=https://auth.shocker.cl/realms/balance/protocol/openid-connect/certs
```

> El server lee el `.env` desde `apps/server/.env`, no desde la raíz: la ruta está
> fija en `main.rs`.

## Desarrollo

```bash
make dev        # server (:8080)
make dashboard  # Vite dev server (:3000)
make mobile     # Metro local/loopback (:8081), con los logs en /tmp/metro.log
make build      # compila server
make check      # verificación rápida del server
make test       # tests del server
```

O directamente:

```bash
npm run dev:server
npm run dev:dashboard
npm --prefix apps/mobile run start
```

| Servicio  | URL                        |
| --------- | -------------------------- |
| Dashboard | http://localhost:3000      |
| API       | http://localhost:8080      |
| Swagger   | http://localhost:8080/docs |
| MCP HTTP  | http://localhost:8080/mcp  |

El servidor usa `127.0.0.1:8080` de forma predeterminada. Para desarrollo en
LAN se debe solicitar explícitamente `SERVER_BIND_ADDR=0.0.0.0:8080`; ver
[`apps/server/README.md`](apps/server/README.md). No se usa ese override en
producción sin la revisión de exposición de red.
Si cambias un puerto, cambia el otro.

El Metro remoto para `Balance Dev` no se inicia desde el checkout principal ni
abriendo puertos a mano. INF-006 administra una sesión temporal desde el
worktree de la feature, con `start/status/renew/stop` y vencimiento automático.

## Gestor de paquetes

**npm, y cada aplicación con su propio `package-lock.json`.**

El proyecto usó un workspace de pnpm, pero ninguna aplicación llegó a compartir
dependencias con otra: el dashboard y el móvil no declaraban ni una dependencia
`@workspace/*`, y los paquetes compartidos solo los consumía el `package.json` de
la raíz. Se pagaba el costo de la maquinaria —tres lockfiles, uno de ellos
duplicado, y una herramienta más que instalar— sin recibir el beneficio.

Si en el futuro hay código realmente compartido entre aplicaciones, ahí sí
conviene reintroducir un workspace. Con React Native y React web las primitivas
de interfaz rara vez se comparten tal cual, así que no se dio por supuesto.

## Documentación

| Documento                    | Para qué                                                      |
| ---------------------------- | ------------------------------------------------------------- |
| `README.md`                  | Qué es y cómo levantarlo                                      |
| `CLAUDE.md`                  | Convenciones y reglas para trabajar en el código              |
| `DEVELOPMENT_GUIDE.md`       | Operación: VPS, puertos, red y CI/CD                          |
| `docs/eas-daily-use.md`      | Instalación Daily, OTA y política de releases Android con EAS |
| `apps/mobile/ANALYSIS.md`    | Análisis del estado del móvil y su reestructuración           |
| `docs/authentication-mcp.md` | OIDC, Keycloak y uso del MCP HTTP remoto                      |
