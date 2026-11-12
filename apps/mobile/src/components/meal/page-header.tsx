import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const theme = useTheme();
  return <View style={{ paddingHorizontal: theme.space.xl, paddingTop: theme.space.lg, paddingBottom: theme.space.md, gap: 2 }}>
    <Text variant="display" accessibilityRole="header">{title}</Text>{subtitle ? <Text tone="secondary" style={{ fontSize: 14 }}>{subtitle}</Text> : null}
  </View>;
}
