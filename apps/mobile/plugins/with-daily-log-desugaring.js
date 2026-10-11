const { withAppBuildGradle } = require('expo/config-plugins');

// java.time is available on Android 24/25 through desugaring. The library's
// AAR contract requires this on the consuming app as well as on the module.
function enableDailyLogDesugaring(contents) {
  if (!/\bandroid\s*\{/.test(contents) || !/\bdependencies\s*\{/.test(contents)) {
    throw new Error('Daily log desugaring requires the Expo Groovy Android template');
  }
  if (/coreLibraryDesugaringEnabled\s+false/.test(contents)) {
    throw new Error('Daily log requires coreLibraryDesugaringEnabled true');
  }
  if (!/coreLibraryDesugaringEnabled\s+true/.test(contents)) {
    contents = contents.replace(/\bandroid\s*\{/, '$&\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }');
  }
  if (!contents.includes('com.android.tools:desugar_jdk_libs:2.1.5')) {
    if (contents.includes('desugar_jdk_libs')) throw new Error('Review conflicting desugar_jdk_libs version');
    contents = contents.replace(/\bdependencies\s*\{/, '$&\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")');
  }
  return contents;
}
module.exports = config => withAppBuildGradle(config, config => {
  if (config.modResults.language !== 'groovy') throw new Error('Daily log expects Expo Groovy build.gradle');
  config.modResults.contents = enableDailyLogDesugaring(config.modResults.contents);
  return config;
});
module.exports.enableDailyLogDesugaring = enableDailyLogDesugaring;
