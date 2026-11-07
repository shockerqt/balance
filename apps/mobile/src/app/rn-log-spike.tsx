import React from 'react';
import { Redirect } from 'expo-router';
import { reactNativeSpikeEnabled } from '@/dev/react-native-spike-gate';

export default function ReactNativeLogSpikeRoute() {
  if (!reactNativeSpikeEnabled) return <Redirect href="/(tabs)/logs" />;
  const Spike = require('@/components/meal/react-native-log-spike').default;
  return <Spike />;
}
