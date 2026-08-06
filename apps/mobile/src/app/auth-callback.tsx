import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/theme';
import { Text } from '@/components/ui';

export default function AuthCallbackScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const { checkSession, setAuthToken } = useAuth();
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    (async () => {
      const value = Array.isArray(token) ? token[0] : token;
      if (value) {
        setAuthToken(value);
        await checkSession(value);
      }
      router.replace('/(tabs)/logs');
    })();
    // Solo depende del token que trae la URL de retorno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, gap: theme.space.lg }]}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text variant="heading" tone="secondary">
        Autenticando…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
