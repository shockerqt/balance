# balance · mobile

App de registro nutricional en Expo 57 / React Native 0.86, con expo-router.

```bash
npm install
npm run start          # Metro; con `make mobile` desde la raíz queda el log en /tmp/metro.log
npm run android        # o ios / web
npx tsc --noEmit       # verificación de tipos (lenta: volcar a archivo antes de filtrar)
```

## Estructura

```
src/
  app/            rutas (expo-router, por convención de archivos)
    (tabs)/       Resumen y Registros
  components/
    ui/           primitivas: Screen, Card, Text, Button, ProgressBar, Sheet
    meal/         UI del dominio
    summary/      piezas del Resumen
  theme/          tokens, paletas, provider y makeStyles
  hooks/          stores de dominio y sesión
  services/       almacenamiento, configuración y sincronización
  lib/            utilidades puras (fechas, porciones)
```

## Antes de escribir código

Las convenciones están en el `CLAUDE.md` de la raíz. La que más pesa:

> Una pantalla nunca declara un color, un tamaño de fuente ni un espaciado
> literal. Todo sale de `src/theme/`.

Y la API de Expo cambió en la 57: consultar
[los docs de esa versión](https://docs.expo.dev/versions/v57.0.0/) antes de usar
APIs de Expo.

`ANALYSIS.md` documenta el estado del que se partió y la reestructuración que se
aplicó, por si hace falta el contexto de por qué las cosas están donde están.
