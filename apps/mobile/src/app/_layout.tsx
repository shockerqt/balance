import React from 'react';
import { Stack } from 'expo-router/stack';
import { ThemeProvider as NavigationThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MealStoreProvider } from '@/hooks/use-meal-store';
import { FoodLibraryProvider } from '@/hooks/use-food-library-store';
import { AuthProvider } from '@/hooks/use-auth';
import { PreferencesProvider } from '@/hooks/use-preferences-store';
import { WeightProvider } from '@/hooks/use-weight-store';
import { ThemeProvider, useTheme } from '@/theme';

/** Los sheets comparten configuracion salvo la altura. */
const sheet = (detents: number[]) =>
  ({
    presentation: 'formSheet',
    sheetGrabberVisible: true,
    sheetAllowedDetents: detents,
    contentStyle: { backgroundColor: 'transparent' },
  }) as const;

function Navigation() {
  const theme = useTheme();

  return (
    <NavigationThemeProvider value={theme.scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="auth-callback" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="food-search" options={sheet([0.9, 1.0])} />
        <Stack.Screen name="food-portion" options={sheet([0.65, 0.9])} />
        <Stack.Screen name="create-food" options={sheet([0.85, 1.0])} />
        <Stack.Screen name="food-library-food" options={sheet([0.9, 1.0])} />
        <Stack.Screen name="date-picker" options={sheet([0.6])} />
        <Stack.Screen name="food-edit" options={sheet([0.6, 0.95])} />
        <Stack.Screen name="batch-move" options={sheet([0.55])} />
        <Stack.Screen name="weight-entry" options={sheet([0.5])} />
        <Stack.Screen
          name="settings"
          options={{
            headerShown: true,
            title: 'Configuración',
            headerBackTitle: 'Atrás',
            headerStyle: { backgroundColor: theme.colors.surface },
            headerTintColor: theme.colors.text,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        />
      </Stack>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PreferencesProvider>
          <WeightProvider>
            <MealStoreProvider>
              <FoodLibraryProvider>
                <Navigation />
              </FoodLibraryProvider>
            </MealStoreProvider>
          </WeightProvider>
        </PreferencesProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
