import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'expo-router';

export default function LoginScreen() {
  const theme = useTheme();
  const { loginWithGoogle, enableGuestMode, isLoading, isAuthenticated, isGuest } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (isAuthenticated || isGuest) {
      router.replace('/(tabs)/logs');
    }
  }, [isAuthenticated, isGuest]);

  const handleGuestPress = async () => {
    await enableGuestMode();
    router.replace('/(tabs)/logs');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        {/* Brand Badge */}
        <View style={[styles.brandBadge, { backgroundColor: theme.accentMuted, borderColor: theme.surfaceBorder }]}>
          <View style={[styles.pulseDot, { backgroundColor: theme.primary }]} />
          <Text style={[styles.brandBadgeText, { color: theme.primary }]}>OFFLINE-FIRST ENGINE</Text>
        </View>

        {/* Hero Thesis / Title */}
        <Text style={[styles.title, { color: theme.textPrimary }]}>Balance</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Tu nutrición diaria, en tus propios términos. Registra alimentos en milisegundos sin depender del Wi-Fi.
        </Text>

        {/* Signature Action Card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              borderColor: theme.surfaceBorder,
            },
          ]}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Iniciar Sesión</Text>
          <Text style={[styles.cardSub, { color: theme.textSecondary }]}>
            Conéctate con tu cuenta de Google para sincronizar tus dispositivos en segundo plano.
          </Text>

          <TouchableOpacity
            activeOpacity={0.8}
            disabled={isLoading}
            onPress={loginWithGoogle}
            style={[
              styles.googleButton,
              {
                backgroundColor: theme.primary,
              },
            ]}>
            {isLoading ? (
              <ActivityIndicator color={theme.primaryText} size="small" />
            ) : (
              <View style={styles.buttonContent}>
                <Text style={[styles.googleIconText, { color: theme.primaryText }]}>G</Text>
                <Text style={[styles.buttonText, { color: theme.primaryText }]}>Continuar con Google</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleGuestPress}
            style={styles.guestButton}>
            <Text style={[styles.guestButtonText, { color: theme.textSecondary }]}>Continuar como Invitado (Librería Oficial)</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: theme.textMuted }]}>
          Balance App · Librería Oficial & Protocolo RxDB WebSocket
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 20,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  brandBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 32,
  },
  card: {
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardSub: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  googleButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  googleIconText: {
    fontSize: 18,
    fontWeight: '900',
    marginRight: 10,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  guestButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  guestButtonText: {
    fontSize: 13,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
  },
});
