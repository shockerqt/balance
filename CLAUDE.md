# CLAUDE.md

Convenciones para trabajar en este repositorio. Mantenla al día cuando la
estructura o las reglas cambien.

Para levantar el proyecto, ver `README.md`. Para la operación del VPS y el
CI/CD, `DEVELOPMENT_GUIDE.md`.

---

## Reglas de trabajo

1. **Aprobación previa.** Ante una consulta, investigación o diagnóstico,
   presentar la propuesta y esperar confirmación antes de editar archivos.
2. **Verificar tras cada cambio.** Ejecutar `npx tsc --noEmit` en la aplicación
   tocada y revisar `/tmp/metro.log` si es el móvil. Cero errores antes de
   reportar la tarea como terminada.
3. **Idioma.** Chat y commits en español. Los textos de interfaz también.
4. **Commits.** Conventional Commits, describiendo el porqué del cambio.

> `tsc` en el móvil tarda varios minutos. Volcar la salida a un archivo
> (`npx tsc --noEmit > /tmp/tsc.txt 2>&1`) y buscar ahí, en vez de encadenarlo
> con tuberías.

---

## Estructura

Tres aplicaciones **independientes**: no comparten dependencias, cada una se
instala por separado con npm y tiene su propio `package-lock.json`. No hay
workspace ni paquetes compartidos — ver el porqué en `README.md`.

```
apps/mobile/      Expo 57 · React Native 0.86 · React 19 · expo-router
apps/dashboard/   React 19 · Vite 8 · TanStack Router/Query · Tailwind v4
apps/server/      Rust 2024 · Axum · SQLx/Postgres
```

---

## Móvil (`apps/mobile`)

### Sistema de tema

Todo el estilo sale de `src/theme/`. La regla que lo sostiene:

> **Una pantalla nunca declara un color, un tamaño de fuente ni un espaciado
> literal.** Su `StyleSheet` contiene solo layout: flex, gap, dimensiones.

Es lo que hace que reestilizar cueste editar un archivo en vez de diecisiete.

- **`tokens.ts`** — el contrato: `PaletteColors`, la escala tipográfica (`type`),
  `space`, `radius`, `border`.
- **`palettes.ts`** — las paletas, todas llenando el mismo contrato. Agregar una
  es escribir un bloque de colores; nada más cambia.
- **`ThemeProvider.tsx`** — contexto reactivo. `useTheme()` devuelve el tema
  activo; `useThemeControls()` permite cambiarlo. La preferencia se persiste y,
  sin preferencia, sigue al sistema.
- **`makeStyles.ts`** — hojas de estilo que dependen del tema:

```tsx
const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.colors.surface, padding: t.space.lg },
}));

function Pantalla() {
  const styles = useStyles();
  // ...
}
```

Tokens disponibles:

| Grupo | Tokens |
|---|---|
| Superficies | `background` `surface` `surfaceRaised` `border` |
| Acción | `primary` `primaryPressed` `onPrimary` |
| Texto | `text` `textSecondary` `textMuted` |
| Estado | `danger` `success` — siempre con texto o icono, nunca color solo |
| Macros | `macroProtein` `macroCarbs` `macroFat` `macroFiber` |

La escala tipográfica: `display` `title` `heading` `body` `bodyStrong` `label`
`caption` `number` `numberLarge`. El espaciado va en múltiplos de 4.

### Primitivas

`src/components/ui/` — `Screen`, `Card`, `Text`, `Button`, `ProgressBar`,
`Sheet`. Preferirlas antes de escribir una `View` con estilos propios.

`Text` toma `variant` (escala tipográfica) y `tone` (color), nunca `fontSize`.

### Dominio

- **Fechas en hora local.** Usar `toDateId()` y `todayId()` de `use-meal-store`.
  Nunca `toISOString()`: adelanta el día en Chile.
- **Totales con `sumDay()`**, no recalculados por pantalla.
- **Valores por defecto en un solo lugar**: `DEFAULT_TARGETS` y `emptyDayLog()`.
- **Almacenamiento por `services/storage.ts`**, que degrada AsyncStorage →
  localStorage → memoria.
- **Configuración en `services/config.ts`.** No repetir URLs ni IPs.
- **`services/sync/` es un protocolo WebSocket propio**, no RxDB pese a lo que
  sugería el nombre anterior de la carpeta.
- **Nada de datos inventados presentados como reales.** Si un widget no tiene
  datos, muestra su estado vacío; no rellena con cifras de ejemplo.

### Convenciones de React Native

- `import { SafeAreaView } from 'react-native-safe-area-context'` — nunca la de
  `react-native`, que está obsoleta.
- Estilos en **camelCase** (`justifyContent`), nunca guiones de CSS web.
- Archivos en kebab-case, componentes en PascalCase, hooks `useX`.
- Las rutas viven en `src/app/` y las resuelve **expo-router** por convención de
  archivos. Un archivo de ruta necesita `export default`.

### Expo 57

La API cambió respecto de versiones anteriores. Consultar
`https://docs.expo.dev/versions/v57.0.0/` antes de escribir código que use APIs
de Expo.

---

## Dashboard (`apps/dashboard`)

- Vite + React 19 + TypeScript estricto. Entrada en `src/main.tsx`.
- **TanStack Router** en modo *file-based*: las rutas viven en `src/routes/` y
  `src/routeTree.gen.ts` se genera solo. **No editarlo a mano.**
- **TanStack Query** para datos. Cada feature expone `queries.ts` y
  `mutations.ts` (ver `src/features/foods`).
- Componentes shadcn en `src/components/ui`. Agregar con
  `npx shadcn@latest add <componente>`.
- Aliases: `@/*` → `src/*`, `@features/*` → `src/features/*`.
- Estructura por feature: `src/features/<feature>/{components,queries.ts,...}`.
  La UI específica de una feature se queda dentro de su carpeta.
- ESLint propio en `eslint.config.js`.

---

## Server (`apps/server`)

- Entrada en `src/main.rs`. Monta un `axum::Router` en `127.0.0.1:8080` por
  defecto; `SERVER_BIND_ADDR` permite un override explícito y validado.
- OpenAPI con `utoipa` y Swagger UI en `/docs`.
- Rutas: `/me` y `/foods` (requieren middleware `auth`), `/auth` (OAuth Google),
  `/meals`.
- Estructura:
  - `config/` — composición y OpenAPI.
  - `connectors/` — Postgres (`db.rs`), Gemini, y queries por dominio.
  - `modules/<dominio>/` — `routes.rs` + `handlers.rs` + `dto.rs` + `mod.rs`.
    Auth añade `google.rs`, `jwt.rs`, `middleware.rs`.
  - `shared/` — `error.rs`, `response.rs`, `validate.rs`.
- Respetar `cargo fmt` y `cargo clippy`. Errores vía `shared::error` / `anyhow`.
- Ruta nueva: handler en `modules/<dominio>/handlers.rs`, exponerlo en
  `routes.rs`, montarlo en `main.rs` decidiendo si necesita `auth`.
- Pruebas manuales en `apps/server/api.http`.

### Túnel a la base de datos remota

```bash
ssh -L 5433:localhost:5432 ubuntu@144.22.47.0
```

Luego apuntar `DATABASE_URL` a `localhost:5433`.

---

## Qué no tocar sin razón

- `apps/dashboard/src/routeTree.gen.ts` — autogenerado.
- `apps/server/.env` — no se commitea.
- El flujo de navegación del móvil: las rutas y los sheets funcionan y
  reestructurar no debería moverlos.
