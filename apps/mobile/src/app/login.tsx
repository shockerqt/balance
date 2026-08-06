import React, { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/theme';
import { Button, Card, Screen, Text } from '@/components/ui';

export default function LoginScreen() {
  const theme = useTheme();
  const { loginWithGoogle, enableGuestMode, isLoading, isAuthenticated, isGuest } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated || isGuest) router.replace('/(tabs)/logs');
  }, [isAuthenticated, isGuest, router]);

  const continueAsGuest = async () => {
    await enableGuestMode();
    router.replace('/(tabs)/logs');
  };

  return (
    <Screen edges={['top', 'bottom']} style={{ paddingHorizontal: theme.space.xxl }}>
      <View style={styles.content}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: theme.border.hairline,
              borderRadius: theme.radius.pill,
              paddingHorizontal: theme.space.md,
              paddingVertical: theme.space.sm,
              gap: theme.space.sm,
              marginBottom: theme.space.xl,
            },
          ]}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.colors.primary,
            }}
          />
          <Text variant="label" tone="accent">
            FUNCIONA SIN CONEXIÓN
          </Text>
        </View>

        <Text variant="display" style={{ fontSize: 42, marginBottom: theme.space.sm }}>
          Balance
        </Text>
        <Text variant="body" tone="secondary" style={{ fontSize: 16, lineHeight: 24, marginBottom: theme.space.xxxl }}>
          Tu nutrición diaria, en tus propios términos. Registra alimentos en milisegundos sin
          depender del Wi-Fi.
        </Text>

        <Card padding="xxl">
          <Text variant="title" style={{ marginBottom: theme.space.xs }}>
            Iniciar sesión
          </Text>
          <Text variant="body" tone="secondary" style={{ lineHeight: 20, marginBottom: theme.space.xxl }}>
            Conéctate con tu cuenta de Google para sincronizar tus dispositivos en segundo plano.
          </Text>

          <Button
            title="Continuar con Google"
            loading={isLoading}
            onPress={loginWithGoogle}
            style={{ marginBottom: theme.space.md }}
          />

          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.7}
            onPress={continueAsGuest}
            style={[styles.guest, { paddingVertical: theme.space.md }]}>
            <Text variant="caption" tone="secondary" style={styles.underline}>
              Continuar como invitado
            </Text>
          </TouchableOpacity>
        </Card>
      </View>

      <View style={[styles.footer, { paddingVertical: theme.space.xl }]}>
        <Text variant="caption" tone="muted">
          Balance · Librería oficial y sincronización en segundo plano
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', maxWidth: 480, width: '100%', alignSelf: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  guest: { alignItems: 'center' },
  underline: { textDecorationLine: 'underline' },
  footer: { alignItems: 'center' },
});
