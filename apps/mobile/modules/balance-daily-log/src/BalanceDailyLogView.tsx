import { requireNativeView } from 'expo';
import * as React from 'react';

import { BalanceDailyLogViewProps } from './BalanceDailyLog.types';

const NativeView: React.ComponentType<BalanceDailyLogViewProps> = requireNativeView('BalanceDailyLog');

export default function BalanceDailyLogView(props: BalanceDailyLogViewProps) {
  return <NativeView {...props} />;
}
