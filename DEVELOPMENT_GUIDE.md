# 📘 Balance - Guía Técnica y Arquitectura del Proyecto

Esta guía contiene la documentación técnica completa del monorepo **Balance**, los comandos para encender el entorno de desarrollo, el funcionamiento de la aplicación móvil con Expo SDK 57, los puertos de red y la automatización CI/CD en GitHub Actions.

---

## 🏗️ 1. Arquitectura del Monorepo

El proyecto está estructurado como un monorepo modular:

- **`apps/mobile`**: Aplicación móvil nativa en **React Native + Expo SDK 57** (con React 19, React Native 0.86, Expo Router v6 y `expo-dev-client@57.0.10`).
- **`apps/dashboard`**: Panel Web administrativo en **React 19 + Vite 8 + Tailwind CSS v4 + Base UI** preset Shadcn `b6YqzcHxSM`. Compilado y sirviéndose en vivo en:
  👉 `http://144.22.47.0:8080/mockups/`
- **`apps/server`**: API REST backend en **Rust (Axum) + PostgreSQL (SQLx)**. Ejecutándose como servicio del sistema en `/opt/balance-server` (`balance-server.service`).

---

## 📱 2. Desarrollo Móvil (`apps/mobile`)

### 🚀 Cómo Encender el Servidor Móvil
Desde la raíz del repositorio (`/home/ubuntu/workspace/balance`), ejecuta:

```bash
make mobile
```

Esto ejecuta automáticamente el comando configurado:
`REACT_NATIVE_PACKAGER_HOSTNAME=144.22.47.0 expo start --dev-client --host lan --port 8081`

### 📝 Captura de Logs en Tiempo Real
- El comando `make mobile` utiliza `script` para mantener los gráficos ASCII del código QR en tu terminal mientras canaliza todo el registro a:
  👉 `/tmp/metro.log`
- Si ocurre algún aviso o error en el teléfono, los registros quedan guardados en `/tmp/metro.log`.

---

## 🌐 3. Conexión del Teléfono al VPS (Red y Puertos)

1. **IP Pública del VPS**: `144.22.47.0`
2. **Puerto Estático Dedicado para Metro**: `8081` (rango permitido en firewall: `8081-8085`).
3. **Firewall del VPS (Linux `iptables`)**:
   - `sudo iptables -I INPUT 6 -p tcp --dport 8081:8085 -j ACCEPT` (persistente en `/etc/iptables/rules.v4`).
4. **Firewall de Oracle Cloud (OCI Security List)**:
   - Configurada la *Ingress Rule* para la VCN `DefaultVCN` permitiendo tráfico `TCP` en el rango `8081-8085` para `0.0.0.0/0`.
5. **Conexión Directa**:
   - No requiere estar en la misma red Wi-Fi ni usar Ngrok.
   - El APK escanea el código QR de la terminal o conecta directamente a:
     `exp+balance-mobile://expo-development-client/?url=http%3A%2F%2F144.22.47.0%3A8081`

---

## ⚙️ 4. Automatización CI/CD (GitHub Actions)

### 📲 A. Compilación del APK Móvil (`.github/workflows/build-mobile.yml`)
- **Evento**: Se activa automáticamente al hacer `git push` en `apps/mobile/**` o manualmente mediante `workflow_dispatch`.
- **Optimizaciones**:
  - Utiliza **Node 24**, **Java 17 (JDK)** y **Gradle Cache (`gradle/actions/setup-gradle@v4`)**.
  - Compilación acelerada de arquitectura única para teléfonos físicos modernos: `-PreactNativeArchitectures=arm64-v8a`.
  - Tiempo de compilación en GitHub Actions: **~3 a 5 minutos**.
- **Artefactos**: El binario `.apk` compilado (`balance-mobile-sdk57-dev`) queda disponible en la solapa *Actions* de GitHub para instalar en el teléfono.

### 🦀 B. Compilación y Despliegue del Backend Rust (`.github/workflows/build-arm.yml`)
- **Evento**: Se activa al modificar `apps/server/**` o mediante `workflow_dispatch`.
- **Despliegue**: Compila el binario ARM64 con `cross` y lo sube mediante SSH a `/opt/balance-server`, ejecutando `sudo systemctl restart balance-server`.

---

## 🎨 5. Diseño e Interfaces Construidas

- **Estilo Visual inspirada en Cal AI**:
  - Fondo oscuro (`#090C15` / `#111726`).
  - Anillo indicador circular de calorías ingeridas / meta (`360 / 2,200 kcal`).
  - 4 barras de macronutrientes (Proteína, Carbohidratos, Grasas y Fibra).
  - Botón destacado de **Escanear Comida con IA**.
  - Octágonos de advertencia chilenos del MINSAL (**`ALTO EN AZÚCARES`**).
  - Navegación deslizable horizontal por gestos de swipe entre días en la pantalla de registros (`apps/mobile/src/app/logs.tsx`).

---

## 📋 6. Reglas de Trabajo del Proyecto

1. **Aprobación Previa de Cambios**: Ante cualquier consulta, investigación o diagnóstico, presentar la propuesta explicada y esperar la confirmación del usuario antes de modificar archivos o ejecutar comandos de edición.
2. **Importación de SafeAreaView**: Utilizar siempre `import { SafeAreaView } from 'react-native-safe-area-context';` para evitar warnings de obsolescencia en React Native.
3. **Nombres de Propiedades de Estilos**: Usar estrictamente **camelCase** para estilos de React Native (ej: `justifyContent: 'space-between'`), nunca guiones de CSS web (`justify-content`).
4. **Revisiones Mínimas Obligatorias tras Cada Cambio**: Tras realizar cualquier modificación de código, ejecutar inmediatamente una verificación mínima (`npx tsc --noEmit` y revisión silenciosa de logs de Metro) para asegurar cero errores antes de notificar la finalización de la tarea.
