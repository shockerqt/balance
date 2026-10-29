import type { ViewStyle } from 'react-native';
/** RN 0.86 solid fallback and native background image use the same role stops. */
export function gradientBackground(stops: string[], angle = 115): ViewStyle {
  return { backgroundColor: stops[0], experimental_backgroundImage: `linear-gradient(${angle}deg, ${stops.join(', ')})` };
}
