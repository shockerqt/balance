import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui';
import { useTheme } from '@/theme';
import { gradientBackground } from '@/theme/gradient';

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const theme = useTheme();
  return <View style={[{ paddingHorizontal: 20, paddingVertical: 16, gap: 4 }, gradientBackground(theme.gradients.header)]}>
    <Text variant="title">{title}</Text>{subtitle ? <Text variant="caption" tone="secondary">{subtitle}</Text> : null}
  </View>;
}
