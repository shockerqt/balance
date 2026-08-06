# Balance - Guía Técnica y Arquitectura del Proyecto

Esta guía contiene la documentación técnica completa del monorepo **Balance**, los comandos para encender el entorno de desarrollo, el funcionamiento de la aplicación móvil con Expo SDK 57, los puertos de red y la automatización CI/CD en GitHub Actions.

---

## 1. Arquitectura del Monorepo

El proyecto está estructurado como un monorepo modular:

- **`apps/mobile`**: Aplicación móvil nativa en **React Native + Expo SDK 57** (con React 19, React Native 0.86, Expo Router v6 y `expo-dev-client@57.0.10`).
- **`apps/dashboard`**: Panel Web administrativo en **React 19 + Vite 8 + Tailwind CSS v4 + Base UI** preset Shadcn `b6YqzcHxSM`. Compilado y sirviéndose en vivo en:
  `http://144.22.47.0:8080/mockups/`
- **`apps/server`**: API REST backend en **Rust (Axum) + PostgreSQL (SQLx)**. Ejecutándose como servicio del sistema en `/opt/balance-server` (`balance-server.service`).

---

## 2. Desarrollo Móvil (`apps/mobile`)

### Cómo Encender el Servidor Móvil
Desde la raíz del repositorio (`/home/ubuntu/workspace/balance`), ejecuta:

```bash
make mobile
```

Esto ejecuta automáticamente el comando configurado:
`REACT_NATIVE_PACKAGER_HOSTNAME=144.22.47.0 expo start --dev-client --host lan --port 8081`

### Captura de Logs en Tiempo Real
- El comando `make mobile` utiliza `script` para mantener los gráficos ASCII del código QR en tu terminal mientras canaliza todo el registro a:
  `/tmp/metro.log`
- Si ocurre algún aviso o error en el teléfono, los registros quedan guardados en `/tmp/metro.log`.

---

## 3. Conexión del Teléfono al VPS (Red y Puertos)

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

## 4. Automatización CI/CD (GitHub Actions)

### A. Compilación del APK Móvil (`.github/workflows/build-mobile.yml`)
- **Evento**: Se activa automáticamente al hacer `git push` en `apps/mobile/**` o manualmente mediante `workflow_dispatch`.
- **Optimizaciones**:
  - Utiliza **Node 24**, **Java 17 (JDK)** y **Gradle Cache (`gradle/actions/setup-gradle@v4`)**.
  - Compilación acelerada de arquitectura única para teléfonos físicos modernos: `-PreactNativeArchitectures=arm64-v8a`.
  - Tiempo de compilación en GitHub Actions: **~3 a 5 minutos**.
- **Artefactos**: El binario `.apk` compilado (`balance-mobile-sdk57-dev`) queda disponible en la solapa *Actions* de GitHub para instalar en el teléfono.

### B. Compilación y Despliegue del Backend Rust (`.github/workflows/build-arm.yml`)
- **Evento**: Se activa al modificar `apps/server/**` o mediante `workflow_dispatch`.
- **Despliegue**: Compila el binario ARM64 con `cross` y lo sube mediante SSH a `/opt/balance-server`, ejecutando `sudo systemctl restart balance-server`.

---

## 5. Interfaces construidas

Lo que existe hoy en el móvil:

- **Resumen** (`(tabs)/index.tsx`): calorías restantes sobre el objetivo, barra
  de avance y cuatro macros (proteína, carbohidratos, grasas y fibra), más el
  promedio de los últimos 7 días leído del registro real.
- **Registros** (`(tabs)/logs.tsx`): navegación entre días deslizando en
  horizontal, cabecera de macros fija y el detalle agrupado por hora, con
  selección múltiple para mover o eliminar en lote.
- **Hojas del stack raíz**: buscar alimento, ajustar porción, crear alimento
  propio y elegir fecha.
- Los **sellos del MINSAL** existen como dato (`chileanSeals`) y se muestran como
  etiquetas junto al alimento.

Las decisiones de estilo —tokens, primitivas y la regla de que una pantalla no
declara colores ni tamaños— están en `CLAUDE.md`.

> **Pendiente, no construido**: representar los sellos con la forma octogonal
> real del reglamento chileno. Hoy son etiquetas rectangulares.

## 6. Reglas de trabajo

Están en `CLAUDE.md`, junto con las convenciones de código.
