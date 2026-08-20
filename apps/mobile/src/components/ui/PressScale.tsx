import React, { useMemo } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/* Superficie pulsable cuyo acuse de recibo no pasa por el hilo de JS.

   `TouchableOpacity` resuelve el feedback en JS: si el hilo está ocupado
   —sincronizando, recalculando totales— el hundido del botón llega tarde y el
   toque se siente pesado aunque la acción salga al instante. Aquí el gesto y la
   animación viven en el hilo de UI; sólo la acción cruza a JS. */

export interface PressScaleProps {
  onPress: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** Escala del estado hundido. 1 desactiva el encogido. */
  scaleTo?: number;
  /** Opacidad del estado hundido. */
  opacityTo?: number;
  accessibilityLabel?: string;
}

export const PressScale: React.FC<PressScaleProps> = ({
  onPress,
  children,
  style,
  disabled = false,
  scaleTo = 0.94,
  opacityTo = 0.7,
  accessibilityLabel,
}) => {
  const pressed = useSharedValue(0);

  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(!disabled)
        /* Un toque sostenido sigue siendo un toque: sin esto el gesto se
           cancela al medio segundo y el botón se queda a medio hundir. */
        .maxDuration(60_000)
        /* En cambio moverse sí lo cancela, y es lo que queremos: arrastrar
           sobre la banda de semanas es paginar, no pulsar. */
        .maxDistance(24)
        .onBegin(() => {
          'worklet';
          pressed.value = withTiming(1, { duration: 60 });
        })
        .onFinalize(() => {
          'worklet';
          pressed.value = withTiming(0, { duration: 140 });
        })
        .onEnd((_event, success) => {
          'worklet';
          if (success) runOnJS(onPress)();
        }),
    [disabled, onPress, pressed]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * (1 - opacityTo),
    transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={[style, animatedStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
};
