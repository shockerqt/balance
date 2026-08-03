import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';
import { ActivityIndicator, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

export default function IndexScreen() {
  const { isAuthenticated, isLoading } = useAuth();
  const theme = useTheme();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return <Redirect href="/(tabs)/logs" />;
}
