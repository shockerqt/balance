# Reglas locales y guía de desarrollo (balance)

Monorepo Full-Stack para gestión y registro nutricional (*Balance*).

## 📁 Estructura del Monorepo

- `apps/dashboard`: SPA Frontend en **React 19 + Vite + TanStack Router/Query + Tailwind v4 + shadcn/ui**.
- `apps/server`: API Backend en **Rust (Axum 2024 + SQLx + PostgreSQL)** con soporte OAuth Google y JWT.
- `packages/ui`: Componentes UI reutilizables basados en **shadcn/ui** y Radix UI.

## 🛠️ Comandos principales

```bash
pnpm install          # Instalar todas las dependencias del monorepo
pnpm dev              # Iniciar dashboard (:3000) y servidor (:8080) en paralelo
pnpm dev:dashboard    # Iniciar solo el frontend React
pnpm dev:server       # Iniciar solo la API Rust (cargo watch)
cargo check -p server # Verificación de tipos del servidor
```

## 🗄️ Base de datos (PostgreSQL)

Base de datos local: `meal_logger` (usuario: `meal_admin`).
Variables en `apps/server/.env`:
```env
DATABASE_URL=postgres://meal_admin:password@localhost:5432/meal_logger
```
