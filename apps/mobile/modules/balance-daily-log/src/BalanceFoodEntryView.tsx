import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
export interface FoodEntryEvent { session: string; sequence: number; action: 'save' | 'cancel'; input: string }
export interface FoodEntryProps extends ViewProps {
  data: string;
  status: string;
  active: boolean;
  onAction: (event: { nativeEvent: FoodEntryEvent }) => void;
}
export const BalanceFoodEntryView: ComponentType<FoodEntryProps> = requireNativeView('BalanceFoodEntry');
