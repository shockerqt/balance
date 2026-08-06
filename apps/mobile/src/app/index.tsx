import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '@/theme';

export default function IndexScreen() {
  const { isAuthenticated, isGuest, isLoading } = useAuth();
  const theme = useTheme();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  // Antes solo se miraba isAuthenticated: un invitado que reiniciaba la
  // app volvia al login y tenia que elegir "invitado" otra vez.
  if (!isAuthenticated && !isGuest) {
    return <Redirect href="/login" />;
  }

  return <Redirect href="/(tabs)/logs" />;
}
