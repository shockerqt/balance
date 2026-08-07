const baseConfig = require("./app.json").expo;

// Cada variante se instala en paralelo, asi que necesita paquete y scheme
// propios. El color de fondo del icono adaptativo tambien cambia: es lo unico
// que distingue las tres apps de un vistazo en el launcher.
const variants = {
  development: {
    name: "Balance Dev",
    package: "com.balance.app.dev",
    scheme: "balance-dev",
    iconBackground: "#2B1A3D",
  },
  daily: {
    name: "Balance Daily",
    package: "com.balance.app.daily",
    scheme: "balance-daily",
    iconBackground: "#0E2A2A",
  },
  production: {
    name: "Balance",
    package: "com.balance.app",
    scheme: "balance",
    iconBackground: baseConfig.android.adaptiveIcon.backgroundColor,
  },
};

module.exports = () => {
  const variantName = process.env.APP_VARIANT || "production";
  const variant = variants[variantName] || variants.production;
  const icon = baseConfig.icon;

  return {
    ...baseConfig,
    name: variant.name,
    scheme: variant.scheme,
    icon,
    ios: {
      ...baseConfig.ios,
      icon,
    },
    android: {
      ...baseConfig.android,
      package: variant.package,
      // Icono heredado para Android 7 y anterior; de 8 en adelante manda el
      // adaptativo, que se conserva para no perder la mascara ni el icono
      // tematico de Android 13+.
      icon,
      adaptiveIcon: {
        ...baseConfig.android.adaptiveIcon,
        backgroundColor: variant.iconBackground,
      },
    },
    extra: {
      ...baseConfig.extra,
      appVariant: variantName,
    },
  };
};
