import React from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTheme } from '@/theme';

export default function TabLayout() {
  const theme = useTheme();

  return (
    <NativeTabs
      backgroundColor={theme.colors.surface}
      indicatorColor={theme.colors.border}
      labelStyle={{ selected: { color: theme.colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Resumen</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="logs">
        <NativeTabs.Trigger.Label>Registros</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/explore.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Biblioteca</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
          md={{ default: 'menu_book', selected: 'menu_book' }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
