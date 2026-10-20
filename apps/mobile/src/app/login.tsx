import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/theme';
import { Button, Card, Screen, Text } from '@/components/ui';

export default function LoginScreen() {
  const theme = useTheme();
  const { loginWithGoogle, enableGuestMode, isLoading, isAuthenticated, isGuest,
    providerLogoutAvailable, providerLogoutNotice, runProviderLogoutDiagnostic,
    dismissProviderLogoutNotice, accountChoicesAvailable, rememberedAccount,
    continueWithRememberedAccount, forgetRememberedAccount, loginError } = useAuth();
  const router = useRouter();
  const [pendingChoice, setPendingChoice] = useState<string | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const remembered = accountChoicesAvailable ? rememberedAccount : null;
  const rememberedName = remembered?.user.name?.trim() || remembered?.user.email;
  const busy = isLoading || pendingChoice !== null;
  const choose = async (choice: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setPendingChoice(choice);
    setChoiceError(null);
    try { await action(); }
    catch { setChoiceError(choice === 'forget'
      ? 'No se pudo olvidar la cuenta. Vuelve a intentarlo.'
      : 'No se pudo continuar. Vuelve a intentarlo.'); }
    finally { setPendingChoice(null); }
  };

  useEffect(() => {
    if (isAuthenticated || isGuest) router.replace('/(tabs)/logs');
  }, [isAuthenticated, isGuest, router]);

  const continueAsGuest = async () => {
    if (await enableGuestMode()) router.replace('/(tabs)/logs');
  };

  return (
    <Screen edges={['top', 'bottom']} style={{ paddingHorizontal: theme.space.xxl }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
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
            Elige cómo continuar
          </Text>
          <Text variant="body" tone="secondary" style={{ lineHeight: 20, marginBottom: theme.space.xxl }}>
            Conéctate con tu cuenta de Google para sincronizar tus dispositivos en segundo plano.
          </Text>

          {remembered ? <View style={{ gap: theme.space.md, marginBottom: theme.space.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
              <View style={{ width: 44, height: 44, borderRadius: theme.radius.pill,
                backgroundColor: theme.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="title" accessibilityElementsHidden importantForAccessibility="no">
                  {Array.from(rememberedName ?? '')[0]?.toLocaleUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, gap: theme.space.xs }}>
                <Text variant="bodyStrong">{rememberedName}</Text>
                <Text variant="caption" tone="secondary" selectable>{remembered.user.email}</Text>
                <Text variant="caption" tone="muted">Cuenta recordada en este dispositivo</Text>
              </View>
            </View>
            <Button title={`Continuar como ${rememberedName}`} disabled={busy}
              loading={pendingChoice === 'remembered'}
              onPress={() => { void choose('remembered', continueWithRememberedAccount); }} />
            <TouchableOpacity accessibilityRole="button" disabled={busy}
              accessibilityLabel="Olvidar la cuenta recordada en este dispositivo"
              onPress={() => { void choose('forget', forgetRememberedAccount); }}
              style={{ alignSelf: 'center', paddingVertical: theme.space.sm }}>
              <Text variant="caption" tone="secondary" style={styles.underline}>Olvidar esta cuenta</Text>
            </TouchableOpacity>
          </View> : null}

          <Button
            title={remembered ? 'Usar otra cuenta de Google' : 'Continuar con Google'}
            variant={remembered ? 'secondary' : 'primary'}
            icon={<View style={{ backgroundColor: '#FFFFFF', padding: 3, borderRadius: 3 }}>
              <Image source={require('../../assets/images/google-g.png')}
                style={{ width: 18, height: 18 }} accessible={false} />
            </View>}
            disabled={busy}
            loading={pendingChoice === 'google' || (isLoading && pendingChoice === null)}
            onPress={() => { void choose('google', loginWithGoogle); }}
            style={{ marginBottom: theme.space.md }}
          />

          {loginError || choiceError ? <Text variant="body" tone="danger" accessibilityRole="alert"
            accessibilityLiveRegion="polite" style={{ marginBottom: theme.space.md }}>{loginError || choiceError}</Text> : null}

          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.7}
            disabled={busy}
            onPress={() => { void choose('guest', continueAsGuest); }}
            style={[styles.guest, { paddingVertical: theme.space.md }]}>
            <Text variant="caption" tone="secondary" style={styles.underline}>
              Continuar como invitado
            </Text>
          </TouchableOpacity>
          <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginTop: theme.space.xs }}>
            Sin cuenta. Tus registros se guardan en este dispositivo.
          </Text>
        </Card>
        {providerLogoutAvailable ? <Card padding="xxl">
          <Text variant="title" style={{ marginBottom: theme.space.xs }}>Comprobar cierre de sesión</Text>
          <Text variant="body" tone="secondary" style={{ marginBottom: theme.space.md }}>
            Abrirá dos sesiones de prueba y pedirá confirmar el cierre. Puede tardar unos minutos.
          </Text>
          <Button title="Iniciar comprobación" variant="secondary" loading={isLoading}
            disabled={isLoading || isAuthenticated || isGuest}
            onPress={() => { void runProviderLogoutDiagnostic(); }} />
          {providerLogoutNotice ? <View style={{ marginTop: theme.space.md, gap: theme.space.sm }}>
            <Text variant="body" tone={providerLogoutNotice.status === 'FAIL' ? 'danger' : 'secondary'}>
              {providerLogoutNotice.reason === 'provider_proof_pending'
                ? 'Comprobación local completada. Falta verificar el resultado en el servidor.'
                : providerLogoutNotice.reason === 'accepted'
                  ? 'Una sesión siguió activa después del cierre. El resultado requiere revisión.'
                  : providerLogoutNotice.reason === 'storage'
                    ? 'No se pudo borrar la sesión guardada. Intenta cerrar sesión de nuevo.'
                    : providerLogoutNotice.reason === 'cleanup'
                      ? 'No se pudo terminar de cerrar las sesiones de prueba. Espera y vuelve a intentarlo.'
                    : providerLogoutNotice.reason === 'expired'
                      ? 'La comprobación tardó demasiado. Espera a que termine antes de volver a intentarlo.'
                      : 'No se pudo confirmar el resultado. Inicia sesión de nuevo antes de repetirla.'}
            </Text>
            {providerLogoutNotice.cleanupIssue ? <Text variant="caption" tone="danger">
              No se pudo terminar de cerrar una sesión de prueba. Espera antes de repetir la comprobación.
            </Text> : null}
            {providerLogoutNotice.reference ? <Text variant="caption" tone="muted" selectable>
              Referencia: {providerLogoutNotice.reference}
            </Text> : null}
            <Button title="Ocultar resultado" variant="secondary" onPress={dismissProviderLogoutNotice} />
          </View> : null}
        </Card> : null}
      </View>

      <View style={[styles.footer, { paddingVertical: theme.space.xl }]}>
        <Text variant="caption" tone="muted">
          Balance · Librería oficial y sincronización en segundo plano
        </Text>
      </View>
      </ScrollView>
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
