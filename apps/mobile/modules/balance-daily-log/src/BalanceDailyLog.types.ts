import type { StyleProp, ViewStyle } from 'react-native';

export type DailyLogEvent = {
  session: string;
  sequence: number;
  commandRevision: number;
  action: 'date' | 'add' | 'edit' | 'weight' | 'delete' | 'move' | 'copy' | 'weight-save' | 'weight-delete' | 'preference' | 'edit-save' | 'library' | 'settings' | 'import' | 'register';
  date: string;
  ids?: string[];
  time?: string;
  input?: { quantity?: string; mode?: string; revision?: number; enabled?: boolean;
    operationId?: string; destinationDate?: string; revisions?: Record<string, number> };
};
export type BalanceDailyLogViewProps = {
  style?: StyleProp<ViewStyle>;
  data: string;
  dateCommand: string;
  active: boolean;
  copyEnabled?: boolean;
  copyStatus?: string;
  onAction: (event: { nativeEvent: DailyLogEvent }) => void;
};
