import Constants from 'expo-constants';

// __DEV__ is false in the required --no-dev --minify comparison. Gate by the
// installed Dev binary and an explicit public switch instead, never by Daily.
export const reactNativeSpikeEnabled = Constants.expoConfig?.extra?.appVariant === 'development'
  && process.env.EXPO_PUBLIC_BALANCE_RN_SPIKE === '1';
