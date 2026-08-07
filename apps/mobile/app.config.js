const baseConfig = require("./app.json").expo;

const variants = {
  development: {
    name: "Balance Dev",
    package: "com.balance.app.dev",
    scheme: "balance-dev",
  },
  daily: {
    name: "Balance Daily",
    package: "com.balance.app.daily",
    scheme: "balance-daily",
  },
  production: {
    name: "Balance",
    package: "com.balance.app",
    scheme: "balance",
  },
};

module.exports = () => {
  const variantName = process.env.APP_VARIANT || "production";
  const variant = variants[variantName] || variants.production;
  const { adaptiveIcon, ...android } = baseConfig.android;
  const icon = "./assets/images/balance-icon.png";

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
      ...android,
      package: variant.package,
      icon,
    },
    extra: {
      ...baseConfig.extra,
      appVariant: variantName,
    },
  };
};
