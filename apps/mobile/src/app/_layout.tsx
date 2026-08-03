import { Stack } from 'expo-router/stack';
import { ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { useColorScheme } from 'react-native';
import { MealStoreProvider } from '@/hooks/use-meal-store';
import { FoodLibraryProvider } from '@/hooks/use-food-library-store';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <MealStoreProvider>
      <FoodLibraryProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="food-search"
              options={{
                presentation: 'formSheet',
                sheetGrabberVisible: true,
                sheetAllowedDetents: [0.9, 1.0],
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
          </Stack>
        </ThemeProvider>
      </FoodLibraryProvider>
    </MealStoreProvider>
  );
}
