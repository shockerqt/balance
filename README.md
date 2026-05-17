# balance

Monorepo con una API en Rust (Axum + Postgres) y un dashboard web en React (Vite + TanStack), más una librería de UI compartida basada en shadcn.

## Estructura

```
apps/
  dashboard/   # SPA React 19 + Vite + TanStack Router/Query + Tailwind v4
  server/      # API Axum (Rust 2024) con sqlx, OAuth Google, JWT, Gemini
packages/
  ui/                 # Componentes shadcn/Radix compartidos (@workspace/ui)
  eslint-config/      # Config ESLint compartida
  typescript-config/  # tsconfig base/nextjs/react-library
```

## Requisitos

- [pnpm](https://pnpm.io) `10.12.x` (declarado en `packageManager`)
- [Rust](https://rustup.rs) edition 2024 y `cargo`
- [`cargo-watch`](https://crates.io/crates/cargo-watch) para hot reload del server (`cargo install cargo-watch`)
- Postgres accesible vía `DATABASE_URL`

## Setup

```bash
pnpm install
```

Crear `apps/server/.env` con las variables que necesita la API:

- `DATABASE_URL` — cadena de conexión a Postgres
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` — credenciales OAuth de Google

## Desarrollo

```bash
pnpm dev              # levanta dashboard (:3000) + server (:8080) en paralelo
pnpm dev:dashboard    # solo el dashboard
pnpm dev:server       # solo la API (cargo watch -x run -p server)
```

- Dashboard: http://localhost:3000
- API: http://localhost:8080
- Swagger UI: http://localhost:8080/docs

## Build y test

```bash
pnpm --filter dashboard build     # build de producción del dashboard
pnpm --filter dashboard test      # tests con Vitest
cargo build -p server             # build de la API
cargo clippy -p server            # lints de Rust
```

## Añadir componentes shadcn

Desde la raíz, apuntando al dashboard:

```bash
pnpm dlx shadcn@latest add button -c apps/dashboard
```

Si el componente es reutilizable, promuévelo a `packages/ui/src/components`.

## Túnel SSH a la base de datos

```bash
ssh -L 5433:localhost:5432 ubuntu@146.235.245.221
```

Luego apunta `DATABASE_URL` a `postgres://...@localhost:5433/...`.

## Más contexto

Para convenciones del repo, layout detallado por app, comandos por paquete y notas operativas, ver [`CLAUDE.md`](./CLAUDE.md).
