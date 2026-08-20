# Dashboard (`apps/dashboard`) — Guía para Agentes LLM

Este directorio contiene el frontend web administrativo de **Balance**.

## Stack Tecnológico

- **Vite 8** con `@vitejs/plugin-react` (puerto `:3000`, alias `@/` -> `src/`).
- **React 19.2** (componentes funcionales con tipado explícito, sin `React.FC`).
- **TypeScript 7.0** (resolución relativa sin `baseUrl`, `verbatimModuleSyntax: true`).
- **Base UI** (`@base-ui/react`): Primitivas accesibles y desestilizadas (headless).
- **CSS Modules** (`*.module.css` con `localsConvention: 'camelCaseOnly'`).

## Convenciones Obligatorias (LLM-First)

1. **Nombres en `kebab-case` estricto:**
   - Todos los directorios y archivos deben nombrarse en `kebab-case` (ej. `button/button.tsx`, `button.module.css`, `use-theme.ts`, `api-client.ts`, `app.tsx`, `main.tsx`).
   - Los componentes en código se exportan en `PascalCase` (`export function Button(...) {}`).

2. **CSS Modules:**
   - Cada componente tiene su hoja de estilo en la misma carpeta (`[componente]/[componente].module.css`).
   - Clases CSS en **`camelCase`** (`.buttonRoot`, `.activeState`) para acceso directo con dot notation en TypeScript (`styles.buttonRoot`).
   - Tokens globales en `src/styles/tokens.css` usando variables CSS nativas (`var(--color-surface)`).

3. **Estructura de `src/`:**
   - `components/ui/[componente]/`: Primitivas que envuelven Base UI (`button/`, `dialog/`, `input/`, `card/`).
   - `features/[feature]/`: Vistas y lógica de negocio (`overview/`, `foods/`, `weight/`).
   - `hooks/`: Custom hooks globales reutilizables.
   - `services/`: Clientes HTTP y llamadas al backend Axum (`:8080`).
   - `types/`: Definiciones de interfaces TypeScript.
   - `styles/`: Variables y reset CSS.

4. **Verificación tras cambios:**
   - Todo cambio debe verificarse con `npm run build` en esta carpeta (ejecuta `tsc -b && vite build`) asegurando **0 errores**.
