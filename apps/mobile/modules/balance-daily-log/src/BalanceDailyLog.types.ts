import type { StyleProp, ViewStyle } from 'react-native';

export type DailyLogEvent = {
  session: string;
  sequence: number;
  action: 'date' | 'add' | 'edit' | 'weight' | 'delete' | 'move';
  date: string;
  ids?: string[];
  time?: string;
};
export type BalanceDailyLogViewProps = {
  style?: StyleProp<ViewStyle>;
  data: string;
  dateCommand: string;
  active: boolean;
  onAction: (event: { nativeEvent: DailyLogEvent }) => void;
};
