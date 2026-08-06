# balance

Registro nutricional: anotas lo que comes y lo contrastas con tus objetivos diarios.

Monorepo con tres aplicaciones independientes —no comparten dependencias entre
sí, cada una se instala y se ejecuta por su cuenta.

```
apps/
  mobile/      App Expo 57 / React Native 0.86 con expo-router
  dashboard/   SPA React 19 + Vite 8 + TanStack Router/Query + Tailwind v4
  server/      API Axum (Rust 2024) con SQLx/Postgres, OAuth Google, JWT y Gemini
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
npm --prefix apps/dashboard install
npm --prefix apps/mobile install
```

El server necesita `apps/server/.env` con:

```env
DATABASE_URL=postgres://meal_admin:...@localhost:5432/meal_logger
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

> El server lee el `.env` desde `apps/server/.env`, no desde la raíz: la ruta está
> fija en `main.rs`.

## Desarrollo

```bash
make dev        # dashboard (:3000) + server (:8080) en paralelo
make mobile     # Metro para el móvil (:8081), con los logs en /tmp/metro.log
make build      # compila dashboard y server
make check      # verificación rápida del server
make test       # typecheck del dashboard y tests del server
```

O directamente:

```bash
npm run dev:dashboard
npm run dev:server
npm --prefix apps/mobile run start
```

| Servicio | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8080 |
| Swagger | http://localhost:8080/docs |

El dashboard asume el server en `:8080` y el server permite CORS desde `:3000`.
Si cambias un puerto, cambia el otro.

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

| Documento | Para qué |
|---|---|
| `README.md` | Qué es y cómo levantarlo |
| `CLAUDE.md` | Convenciones y reglas para trabajar en el código |
| `DEVELOPMENT_GUIDE.md` | Operación: VPS, puertos, red y CI/CD |
| `apps/mobile/ANALYSIS.md` | Análisis del estado del móvil y su reestructuración |
