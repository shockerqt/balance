import { Stack } from 'expo-router/stack';
import { ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { useColorScheme } from 'react-native';
import { MealStoreProvider } from '@/hooks/use-meal-store';
import { FoodLibraryProvider } from '@/hooks/use-food-library-store';
import { AuthProvider } from '@/hooks/use-auth';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <MealStoreProvider>
        <FoodLibraryProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
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
              <Stack.Screen
                name="food-portion"
                options={{
                  presentation: 'formSheet',
                  sheetGrabberVisible: true,
                  sheetAllowedDetents: [0.65, 0.9],
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              <Stack.Screen
                name="create-food"
                options={{
                  presentation: 'formSheet',
                  sheetGrabberVisible: true,
                  sheetAllowedDetents: [0.85, 1.0],
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              <Stack.Screen
                name="date-picker"
                options={{
                  presentation: 'formSheet',
                  sheetGrabberVisible: true,
                  sheetAllowedDetents: [0.6],
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
            </Stack>
          </ThemeProvider>
        </FoodLibraryProvider>
      </MealStoreProvider>
    </AuthProvider>
  );
}
