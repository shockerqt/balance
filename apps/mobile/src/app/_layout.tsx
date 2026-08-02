import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import AppTabs from '@/components/app-tabs';
import { MealStoreProvider } from '@/hooks/use-meal-store';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <MealStoreProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AppTabs />
      </ThemeProvider>
    </MealStoreProvider>
  );
}
