import React, { useEffect } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

export default function AuthCallbackScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { checkSession, setAuthToken } = useAuth();
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    async function handleCallback() {
      if (token) {
        const tokenStr = Array.isArray(token) ? token[0] : token;
        if (tokenStr) {
          setAuthToken(tokenStr);
          await checkSession(tokenStr);
        }
      }
      router.replace('/(tabs)/logs');
    }
    handleCallback();
  }, [token]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={[styles.text, { color: theme.textSecondary }]}>Autenticando...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
  },
});
