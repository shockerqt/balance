import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import AppTabs from '@/components/app-tabs';
import { MealStoreProvider } from '@/hooks/use-meal-store';
import { FoodLibraryProvider } from '@/hooks/use-food-library-store';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <MealStoreProvider>
      <FoodLibraryProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AppTabs />
        </ThemeProvider>
      </FoodLibraryProvider>
    </MealStoreProvider>
  );
}
