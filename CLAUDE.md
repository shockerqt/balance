# CLAUDE.md

Guía para que Claude Code trabaje en este repositorio. Mantenla actualizada cuando la estructura o las convenciones cambien.

## Resumen del proyecto

`balance` es un monorepo que combina una API en Rust y un dashboard web en React.
El dominio gira en torno a usuarios, alimentos (`foods`) y comidas (`meals`), con autenticación vía Google OAuth y un conector a Gemini.

## Layout del repositorio

```
.
├── apps/
│   ├── dashboard/   # SPA React 19 + Vite + TanStack Router/Query + Tailwind v4
│   └── server/      # API Axum (Rust 2024) con sqlx/Postgres, OAuth Google, JWT, Gemini
├── packages/
│   ├── eslint-config/      # Config ESLint compartida (@workspace/eslint-config)
│   └── typescript-config/  # tsconfig base/nextjs/react-library (@workspace/typescript-config)
├── package.json            # Workspaces pnpm + scripts dev
├── pnpm-workspace.yaml     # apps/* y packages/*
├── Cargo.toml              # Workspace Cargo, miembro: apps/server
└── tsconfig.json           # Hereda de @workspace/typescript-config/base.json
```

## Toolchain

- **Node**: pnpm `10.12.1` (ver `packageManager` en `package.json`). Usa `pnpm`, no `npm`/`yarn`.
- **Rust**: edition `2024`, resolver `3`. Para hot reload del server se usa `cargo watch`.
- **TypeScript**: 5.x con `strict` y `noUncheckedIndexedAccess` activados (ver `packages/typescript-config/base.json`).
- **Tailwind**: v4 vía `@tailwindcss/vite`.

## Comandos comunes

Desde la raíz:

```bash
pnpm install                 # instalar deps del workspace JS
pnpm dev                     # dashboard + server en paralelo (concurrently)
pnpm dev:dashboard           # solo el dashboard (Vite en :3000)
pnpm dev:server              # solo la API (cargo watch -x run -p server, :8080)
```

Dashboard (`apps/dashboard`):

```bash
pnpm --filter dashboard dev     # vite --port 3000
pnpm --filter dashboard build   # vite build && tsc
pnpm --filter dashboard test    # vitest run
pnpm --filter dashboard serve   # preview del build
```

Server (`apps/server`):

```bash
cargo run -p server          # ejecutar la API
cargo build -p server        # compilar
cargo check -p server        # verificación rápida sin compilar binario
cargo clippy -p server       # lints
cargo fmt                    # formato
```

UI package (`packages/ui`):

```bash
pnpm --filter @workspace/ui lint
```

Agregar componentes shadcn al dashboard (desde la raíz):

```bash
pnpm dlx shadcn@latest add <componente> -c apps/dashboard
```

## API server (`apps/server`)

- Entry: `src/main.rs`. Monta `axum::Router` y sirve en `0.0.0.0:8080`.
- Docs OpenAPI generadas con `utoipa` + Swagger UI en `http://localhost:8080/docs` (`/api-docs/openapi.json`).
- Rutas montadas:
  - `/me` (requiere middleware `auth`) — `modules::user`
  - `/auth` — `modules::auth` (flujo Google OAuth)
  - `/meals` — `modules::meal`
  - `/foods` (requiere `auth`) — `modules::food`
- CORS abierto a `http://localhost:3000` con credenciales.
- Estructura interna:
  - `config/` — composición y OpenAPI (`ApiDoc`).
  - `connectors/` — acceso a Postgres (`db.rs`), Gemini, y queries por dominio (`food.rs`, `meal.rs`, `user.rs`).
  - `modules/<dominio>/` — patrón `routes.rs` + `handlers.rs` + `dto.rs` + `mod.rs`. Auth añade `google.rs`, `jwt.rs`, `middleware.rs`.
  - `shared/` — `error.rs`, `response.rs`, `validate.rs` reutilizables.
- Variables de entorno (cargadas con `dotenv` desde `apps/server/.env`):
  - `DATABASE_URL` (Postgres, requerido).
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth Google).
  - Callback configurado a `http://localhost:8080/auth/google/callback`.
- Pruebas manuales: ver `apps/server/api.http`.

### Túnel SSH a la DB remota

```bash
ssh -L 5433:localhost:5432 ubuntu@146.235.245.221
```

Luego apunta `DATABASE_URL` a `postgres://...@localhost:5433/...`.

## Dashboard (`apps/dashboard`)

- Vite + React 19 + TypeScript estricto. Entry en `src/main.tsx`, monta `GlobalContext` y `RouterConfig`.
- Routing: TanStack Router en modo **file-based**, con el plugin `@tanstack/router-plugin/vite` y `autoCodeSplitting`. Las rutas viven en `src/routes/` y se genera `src/routeTree.gen.ts` automáticamente — **no editarlo a mano**.
- Data: TanStack Query (`src/config/query.tsx`). Convención: cada feature expone `queries.ts` y `mutations.ts` (ver `src/features/foods`).
- Aliases (definidos en `vite.config.ts` y `tsconfig.json`):
  - `@/*` → `src/*`
  - `@features/*` → `src/features/*`
  - `@workspace/ui/*` → `packages/ui/src/*`
- Estilos: Tailwind v4 vía plugin Vite; estilos globales importados con `import "@workspace/ui/globals.css"`.
- Estructura por feature: `src/features/<feature>/{components,queries.ts,mutations.ts,types.ts,...}`. Mantén la UI específica de feature dentro de su carpeta y promueve a `packages/ui` solo lo genuinamente reutilizable.
- Testing: Vitest + Testing Library + jsdom (config inline comentada en `vite.config.ts`; activar al añadir tests).

## Paquete UI compartido (`packages/ui`)

- Basado en shadcn + Radix + `class-variance-authority` + `tailwind-merge`.
- Exports (`package.json`):
  - `@workspace/ui/globals.css`
  - `@workspace/ui/components/<componente>`
  - `@workspace/ui/lib/<util>`
  - `@workspace/ui/hooks/<hook>`
- Para añadir un componente: usar el comando `shadcn add` apuntando a `apps/dashboard` (configurado en `apps/dashboard/components.json`) y, si es reutilizable, moverlo/promoverlo a `packages/ui/src/components`.

## Convenciones

- **Idioma**: chat y commits en español (los strings de UI suelen estar en español; revisar contexto).
- **Commits**: mensajes concisos en infinitivo o presente, describiendo el "por qué". No incluir IDs de modelo ni URLs internas del entorno Claude en mensajes/PRs.
- **Estilo Rust**: respetar `cargo fmt` y `cargo clippy`. Errores se manejan vía `shared::error` / `anyhow`.
- **Estilo TS/React**: ESLint del workspace (`@workspace/eslint-config`), `--max-warnings 0`. Componentes en PascalCase, hooks `useX`, archivos kebab-case.
- **Rutas nuevas en el dashboard**: crear archivo en `src/routes/` y dejar que el plugin regenere `routeTree.gen.ts` al correr `pnpm --filter dashboard dev`.
- **Rutas nuevas en el server**: añadir handler en `modules/<dominio>/handlers.rs`, exponerlo en `routes.rs`, y montar el router en `main.rs` decidiendo si requiere `middleware::from_fn(auth)`.

## Cosas a no tocar sin razón

- `apps/dashboard/src/routeTree.gen.ts` (autogenerado).
- `Cargo.lock` está en `.gitignore`; no lo añadas al repo.
- `apps/server/.env` (no commitear; `.env*` está en `.gitignore`).

## Notas operativas

- El server espera el `.env` en `apps/server/.env` (ruta hardcodeada en `main.rs`), no en la raíz.
- El dashboard asume el server en `http://localhost:8080` y el server asume el dashboard en `http://localhost:3000` (CORS). Mantener esos puertos al levantar ambos.
