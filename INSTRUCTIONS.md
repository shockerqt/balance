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

## 📋 Reglas Obligatorias de Trabajo

1. **Aprobación Previa de Cambios**: Explicar propuestas y obtener confirmación antes de editar archivos.
2. **SafeAreaView**: Utilizar `import { SafeAreaView } from 'react-native-safe-area-context';`.
3. **Estilos React Native**: Usar estrictamente **camelCase** (ej: `justifyContent: 'space-between'`).
4. **Revisiones Mínimas Obligatorias tras Cada Cambio**: Tras cada edición, ejecutar verificación mínima (`npx tsc --noEmit` y lectura silenciosa de `/tmp/metro.log`) para asegurar cero errores antes de reportar la tarea como completada.

## 🗄️ Base de datos (PostgreSQL)

Base de datos local: `meal_logger` (usuario: `meal_admin`).
Variables en `apps/server/.env`:
```env
DATABASE_URL=postgres://meal_admin:password@localhost:5432/meal_logger
```
