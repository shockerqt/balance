# balance · dashboard

Panel web del registro nutricional. React 19 + Vite 8 + TanStack Router/Query +
Tailwind v4, con componentes shadcn/ui.

```bash
npm install
npm run dev          # :3000
npm run build        # tsc -b && vite build
npm run typecheck
npm run lint
```

Espera la API en `http://localhost:8080`. El server permite CORS desde `:3000`,
así que si cambias un puerto hay que cambiar el otro.

## Estructura

- `src/routes/` — rutas de TanStack Router en modo *file-based*.
  `src/routeTree.gen.ts` se genera solo; **no editarlo a mano**.
- `src/features/<feature>/` — `components/`, `queries.ts`, `mutations.ts`. La UI
  específica de una feature se queda dentro de su carpeta.
- `src/components/ui/` — componentes shadcn. Agregar con
  `npx shadcn@latest add <componente>`.

Aliases: `@/*` → `src/*`, `@features/*` → `src/features/*`.

Las convenciones del repositorio están en el `CLAUDE.md` de la raíz.
