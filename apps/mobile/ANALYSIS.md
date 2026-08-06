> **Estado: ejecutado.** Las cuatro fases se aplicaron en los commits
> `ba19810` y siguientes. Este documento se conserva como registro del
> punto de partida y del razonamiento; las cifras de "antes" son las
> del commit `17a2d3a`. Ver §9 para el resultado.

# Análisis del app mobile — estado actual y propuesta de reestructuración

Objetivo del análisis: dejar el código en condiciones de **cambiar el estilo con
facilidad sin tocar el flujo**. Todo lo que sigue está medido sobre el commit
`17a2d3a`.

---

## 1. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Líneas en `src/` | 7.489 |
| Código muerto o de plantilla | **2.357 (31%)** |
| Colores hardcodeados | 299 ocurrencias, **38 valores únicos** |
| …de esos, en código vivo | 188 |
| Tokens que define la paleta | ~15 |
| Archivo más grande | `app/food-search.tsx` — 698 líneas, **un solo componente** |
| Bloques `StyleSheet.create` | 12, con ~280 reglas |

**El diagnóstico corto**: no existe un sistema de tema. Existe un objeto de
colores que la mitad del código ignora. Reestilizar hoy significa editar 17
archivos a mano y esperar no olvidar ninguno.

---

## 2. Qué hay

### Stack

Expo 57 · React Native 0.86 · React 19 · expo-router 57 · TypeScript 6.
Sin librería de estilos: todo es `StyleSheet.create` + estilos en línea.

### Flujo real de navegación

```
app/index.tsx   ── isLoading ──> spinner
                ── !isAuthenticated ──> /login
                ── ok ──> /(tabs)/logs        ← la app abre en Registros, no en Resumen

/login          ── Google OAuth (WebBrowser) ──> /auth-callback
                ── modo invitado ──> /(tabs)/logs

(tabs)
  index  "Resumen"     ← primera pestaña, pero no es el destino inicial
  logs   "Registros"   ← el destino inicial

Sheets del stack raíz (presentation: 'formSheet'):
  /food-search    ← desde Resumen y desde Registros
  /food-portion   ← desde food-search
  /create-food    ← desde food-search
  /date-picker    ← desde Registros
```

### Estado

Tres contextos anidados en `app/_layout.tsx`, sin memoización:
`AuthProvider` → `MealStoreProvider` → `FoodLibraryProvider`.

`use-meal-store` concentra todo el dominio (11 métodos) en un solo contexto:
cualquier edición de un alimento re-renderiza a todos los consumidores.

### Datos

- **Local**: `AsyncStorage` vía un adaptador `safeStorage` con fallback a
  `localStorage` y a un objeto en memoria.
- **Remoto**: `services/rxdb/sync-client.ts` abre un WebSocket al backend.
- **`services/api-client.ts` no lo usa nadie** (ver §4).

---

## 3. Lo que bloquea el restyle

Esta es la sección que importa para el objetivo.

### 3.1 El tema no es un tema

```ts
// constants/theme.ts
export const ACTIVE_PALETTE_KEY: keyof typeof Palettes = 'midnightEmerald';
export const ActiveTheme = Palettes[ACTIVE_PALETTE_KEY];

// hooks/use-theme.ts
export function useTheme(): ThemePalette {
  return ActiveTheme;   // constante de módulo
}
```

`ActiveTheme` se resuelve **una vez al importar el módulo**. `useTheme()` no es
un hook reactivo: no hay contexto, no hay estado, no hay suscripción. Cambiar de
paleta exige editar el código fuente y recargar la app.

Consecuencias:

- No se puede ofrecer selector de tema al usuario.
- No se puede comparar dos estilos sin recompilar.
- `Colors.light = obsidianCobalt` y `Colors.dark = midnightEmerald` **mienten**:
  las dos paletas son oscuras. Cualquier componente Expo que respete
  `useColorScheme()` recibirá un tema oscuro en modo claro.
- `use-color-scheme.ts` y su variante `.web.ts` existen pero **no los importa
  nadie**.

### 3.2 188 colores hardcodeados en código vivo

38 valores únicos para una paleta de ~15 tokens. Distribución en lo que sí se
ejecuta:

| Archivo | Ocurrencias |
|---|---|
| `app/food-search.tsx` | 45 |
| `app/create-food.tsx` | 25 |
| `app/food-portion.tsx` | 24 |
| `components/meal/time-food-modal.tsx` | 24 |
| `components/meal/batch-move-modal.tsx` | 21 |
| `app/date-picker.tsx` | 11 |
| resto | 38 |

Casos que ilustran el problema:

- `app/(tabs)/_layout.tsx` **no usa el tema en absoluto**: hardcodea `#090C15`,
  `#1F293B` y `#FFFFFF`. La barra de pestañas quedaría fuera de cualquier
  restyle.
- `app/(tabs)/index.tsx` es el archivo mejor tematizado (solo 2 literales), pero
  uno de ellos es `'#10B981'` — que **es exactamente `theme.primary`** en la
  paleta activa. Es el mismo color escrito dos veces: al cambiar la paleta, la
  barra de carbohidratos se queda con el verde viejo.
- Los colores por macro (proteína / carbos / grasas / fibra) no son tokens.
  Están repartidos entre `theme.primary`, `theme.kcalCoral`, `'#10B981'` y
  `'#06B6D4'`.

### 3.3 El color vive en el JSX, el layout en el StyleSheet

El patrón dominante:

```tsx
<View style={[styles.macroBox, { backgroundColor: theme.cardBackground,
                                 borderColor: theme.surfaceBorder }]}>
  <Text style={[styles.macroLabel, { color: theme.textMuted }]}>PROTEÍNA</Text>
```

Solo en `(tabs)/index.tsx` hay ~40 merges así. Cada propiedad tematizable es una
decisión manual repetida en cada punto de uso. Nada garantiza consistencia, y
agregar un token nuevo obliga a recorrer todos los sitios.

### 3.4 No hay escala tipográfica

`fontSize` y `fontWeight` son literales sueltos por todo el código: 10, 11, 13,
14, 16, 20, 32… y pesos `'500'`, `'600'`, `'700'`, `'800'`. `constants/theme.ts`
define `Fonts` (familias) y `Spacing`, pero **`Spacing` no lo usa nadie** — los
paddings y márgenes también son literales.

Un cambio de escala tipográfica hoy es buscar y reemplazar a ojo.

### 3.5 No hay primitivas compartidas

Cada pantalla redibuja desde cero los mismos objetos: tarjeta, fila de alimento,
botón primario, barra de progreso, cabecera de sheet. 12 bloques
`StyleSheet.create` con ~280 reglas, con nombres que se repiten
(`card`, `row`, `title`, `btn`) pero valores levemente distintos.

No existe `components/ui/` con `Card`, `Button`, `Text`, `ProgressBar`. Lo único
en `components/ui/` es `collapsible.tsx`, que es de la plantilla de Expo y no lo
usa nadie.

---

## 4. Código muerto: 2.357 líneas (31%)

### 4.1 Cadena de modales reemplazados — 1.356 líneas

Las pantallas de `app/` (sheets del router) reemplazaron a los modales, pero los
modales nunca se borraron:

```
components/meal/food-search-modal.tsx    389   ← nadie lo importa
  ├─ create-custom-food-modal.tsx        328   ← solo alcanzable desde el muerto
  └─ food-portion-modal.tsx              332   ← ídem
components/meal/date-picker-modal.tsx    307   ← nadie lo importa
```

Cargan **111 de los 299 colores hardcodeados**. Borrarlos elimina un tercio del
problema de estilo sin tocar una sola línea viva.

> Sí están vivos: `time-food-modal`, `batch-move-modal`, `date-strip-header`,
> `fluid-timeline-feed`, `food-row`, `sticky-macro-header`.

### 4.2 Isla de la plantilla de Expo — ~700 líneas

`explore.tsx` (ruta inalcanzable: no está en las pestañas, solo la referencia el
huérfano `app-tabs.web.tsx`), `themed-text`, `themed-view`, `collapsible`,
`web-badge`, `hint-row`, `animated-icon` + `.web`, `app-tabs` + `.web`.

Forman un grupo que se importa solo entre sí y que nada del producto alcanza.

### 4.3 Servicios huérfanos o mal nombrados

- **`services/api-client.ts` (78 líneas) no lo usa nadie.** Define `getMeals`,
  `createMeal`, `addFoodToMeal`, `getDailySummary` — y ninguna manda token de
  autorización, pese a que el server exige `auth` en varias rutas. Es una capa
  muerta que además está mal.
- **`services/rxdb/` no usa RxDB.** No está en `package.json`. Son un WebSocket
  a mano (`sync-client.ts`) y objetos de esquema sueltos (`schemas.ts`, que
  tampoco importa nadie). El nombre hace pensar en una base de datos offline que
  no existe.
- **`src/global.css` (9 líneas) nunca se importa** y no hay nativewind ni
  tailwind instalados.

---

## 5. Correcciones de fondo (independientes del estilo)

Ordenadas por impacto.

### 5.1 La sesión se pierde en cada arranque

`use-auth.tsx` guarda el token en `useState`. **No se persiste en ningún lado**
(cero usos de `AsyncStorage` o `SecureStore` en el archivo). Al reiniciar la app,
`checkSession()` corre sin token, `/me` falla y el usuario queda deslogueado.

`app/index.tsx` tampoco consulta `isGuest`, así que un invitado que reinicia
vuelve al login y tiene que elegir "invitado" de nuevo.

### 5.2 La app siempre abre el 2 de agosto de 2026

```ts
const [selectedDateId, setSelectedDateId] = useState<string>('2026-08-02');
```

La fecha inicial está fija, igual que el día semilla en `INITIAL_DAY_LOGS`. No se
deriva de `new Date()`.

### 5.3 El día por defecto está escrito cuatro veces

El literal `{ targetCalories: 2200, targetProtein: 150, targetCarbs: 220,
targetFat: 65, targetFiber: 30, foods: [] }` aparece 4 veces en
`use-meal-store.tsx`. Cambiar un objetivo obliga a editar los cuatro.

### 5.4 `saveLogs` puede perder escrituras

```ts
const saveLogs = (newLogs) => { setDayLogs(newLogs); ... }
// y los llamadores construyen newLogs desde el `dayLogs` capturado en el closure
```

Dos operaciones seguidas en el mismo tick pueden pisarse. Debería usar la forma
funcional de `setState`.

### 5.5 Datos falsos presentados como reales en Resumen

- Avatar `"FJ"` y saludo `"Hola, Francisco 👋"` — hardcodeados, no salen de
  `useAuth()`, que sí tiene `user.name` y `user.picture`.
- Racha `"🔥 5 Días"` — literal.
- `"2,010 kcal/día"` — literal.
- Las barras del gráfico semanal son `60 + (idx % 3) * 15`. **El widget de
  estadísticas semanales es decorativo**: no lee datos.

### 5.6 Menores

- `email: String` en `UserProfile` usa el wrapper `String` en vez de `string`.
- IP `144.22.47.0` hardcodeada como fallback en `api-client.ts`, `use-auth.tsx`,
  `sync-client.ts` y el script `start` de `package.json`.
- `(tabs)/_layout.tsx` declara `const scheme = useColorScheme()` y no lo usa.
- El `CLAUDE.md` de la raíz **no menciona el app mobile**: describe el repo como
  "una API en Rust y un dashboard web". Cualquier agente que lo lea trabajará con
  un mapa incompleto.

---

## 6. Reestructuración propuesta

Cuatro fases. Las tres primeras son las que habilitan el restyle; la cuarta es
independiente y puede esperar.

### Fase 0 — Podar (bajo riesgo, alto rendimiento)

Borrar las 2.357 líneas de §4. No toca nada vivo y elimina 111 colores
hardcodeados de entrada.

Verificación: la app compila y las cuatro rutas de sheet siguen funcionando.

### Fase 1 — Un tema de verdad

```
src/theme/
  tokens.ts        escalas nombradas: color, espaciado, radio, tipografía
  palettes.ts      las paletas, cada una llenando el mismo contrato
  ThemeProvider.tsx  contexto + estado + persistencia de la elección
  useTheme.ts      hook reactivo
```

Puntos clave:

- `useTheme()` pasa a leer del contexto, no de una constante de módulo.
- La tipografía entra al contrato: `type.display`, `type.title`, `type.body`,
  `type.label`, `type.number` — con tamaño, peso y tracking por variante, en
  lugar de literales sueltos.
- Los colores por macro se vuelven tokens (`macro.protein`, `macro.carbs`,
  `macro.fat`, `macro.fiber`) en vez de repartirse entre tokens y literales.
- Arreglar `Colors.light` / `Colors.dark` o eliminarlos si no se va a soportar
  modo claro. Hoy son una mentira que puede morder.

### Fase 2 — Primitivas de UI

```
src/components/ui/
  Screen.tsx       SafeAreaView + fondo del tema
  Card.tsx         la tarjeta que hoy se redibuja en cada pantalla
  Text.tsx         variantes tipográficas del tema, sin fontSize suelto
  Button.tsx       primario / secundario / fantasma
  ProgressBar.tsx  la barra de macro, hoy repetida 5 veces
  Sheet.tsx        cabecera + grabber común de los cuatro sheets
```

El criterio: **una pantalla no debería declarar colores ni tamaños de fuente**.
Su `StyleSheet` queda solo con layout (flex, gap, dimensiones).

Con esto, un restyle completo pasa a ser editar `tokens.ts` y, como mucho, las
primitivas. De 17 archivos a 2.

### Fase 3 — Descomponer los monolitos

`app/food-search.tsx` son 698 líneas y 47 reglas de estilo en un componente.
Extraer en secciones (`SearchBar`, `ResultList`, `RecentSection`,
`SelectionFooter`) lo vuelve legible y permite reestilizar por partes.

Mismo tratamiento para `logs.tsx` (411) y `food-portion.tsx` (313).

### Fase 4 — Datos y sesión

Las correcciones de §5: persistir el token, derivar la fecha de hoy, unificar el
día por defecto, `setState` funcional, y decidir qué hacer con el widget semanal
(conectarlo o quitarlo). Además: borrar `api-client.ts` o completarlo con auth, y
renombrar `services/rxdb/` a algo que describa lo que hace.

---

## 7. Qué conviene no tocar

- **El flujo de navegación.** Las rutas y los sheets funcionan; la
  reestructuración propuesta no los mueve. Es el requisito del encargo.
- `services/rxdb/sync-client.ts` — feo de nombre, pero es la única vía de
  sincronización real. Renombrar sí; reescribir, no en este alcance.
- Los componentes vivos de `components/meal/`. Son la UI del dominio y funcionan;
  entran a la Fase 2 solo para dejar de declarar color y tipografía.

---

## 8. Orden sugerido

```
Fase 0  podar                    ← desbloquea todo lo demás, riesgo casi nulo
Fase 1  tema real                ← el habilitador del restyle
Fase 2  primitivas               ← donde el restyle se vuelve barato
────────  a partir de aquí ya se puede reestilizar cómodamente
Fase 3  descomponer monolitos
Fase 4  datos y sesión
```


---

## 9. Resultado

| Métrica | Antes (`17a2d3a`) | Ahora |
|---|---|---|
| Líneas en `src/` | 7.489 | 5.006 |
| Código muerto | 2.388 | 0 |
| Literales de color | 299 | **0** (solo en `palettes.ts`) |
| Errores de tipos | 1 | 0 |
| Archivo más grande | 698 | 434 |

### Descomposición

| Archivo | Antes | Ahora | Extraído |
|---|---|---|---|
| `(tabs)/index.tsx` | 348 | 122 | `MacroGrid`, `WeeklyChart` |
| `(tabs)/logs.tsx` | 411 | 204 | `useFoodSelection`, `BatchActionBar`, `FloatingAddButton`, `lib/dates` |
| `food-search.tsx` | 698 | 434 | `LibraryFoodRow`, `CollapsibleSection`, `StagedFoodRow` |
| `food-portion.tsx` | 313 | 153 | `lib/portion`, `MacroSummary` |

`create-food.tsx` (305) y `date-picker.tsx` (253) siguen sin descomponer.
Están tematizados y sin literales, así que un restyle los alcanza; lo que
les falta es estructura interna.

### Verificación

`tsc --noEmit` tras cada fase, siempre en verde. **No hay pruebas
automatizadas ni verificación visual**: el typecheck no detecta un
`gap` mal mapeado ni un handler que quedó en el padre. La app se revisó
a mano tras el primer lote de cambios.
