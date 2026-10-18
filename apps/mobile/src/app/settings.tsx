import React, { useRef } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { makeStyles, useTheme } from '@/theme';

export default function SettingsScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const { user, isGuest, isLoading, logout, refreshReplayAvailable, runRefreshReplay } = useAuth();
  const { preferencesReady, weightTrackingEnabled, syncError, setWeightTrackingEnabled } =
    usePreferencesStore();

  const logoutPending = useRef(false);
  const handleLogout = async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    try {
      const status = await logout();
      if (status === 'in_progress') return;
      if (status === 'unconfirmed') Alert.alert('Sesión cerrada en Balance',
        'No se confirmó el cierre de la sesión de Eri.');
      router.replace('/login');
    } finally { logoutPending.current = false; }
  };
  const diagnosticPending = useRef(false);
  const handleRefreshReplay = async () => {
    if (diagnosticPending.current) return;
    diagnosticPending.current = true;
    try {
      const result = await runRefreshReplay();
      const title = result.status === 'PASS' ? 'Comprobación correcta' :
        result.status === 'FAIL' ? 'Comprobación fallida' : 'No se pudo confirmar';
      const detail = result.status === 'PASS'
        ? 'La sesión anterior dejó de funcionar después de renovarla. Inicia sesión de nuevo para continuar.'
        : result.status === 'FAIL'
          ? result.step === 'replay'
            ? 'La sesión anterior siguió funcionando después de renovarla. Inicia sesión de nuevo para continuar.'
            : 'La sesión renovada siguió funcionando tras reutilizar la anterior. Inicia sesión de nuevo para continuar.'
        : result.reason === 'unavailable' || result.reason === 'busy'
          ? 'La comprobación no está disponible ahora.'
          : result.reason === 'storage'
            ? 'No se pudo borrar la sesión guardada. Intenta cerrar sesión de nuevo.'
          : result.reason === 'expired'
            ? 'La comprobación tardó demasiado. Espera antes de iniciar sesión de nuevo.'
            : 'No se pudo confirmar el resultado. Inicia sesión de nuevo para continuar.';
      Alert.alert(title, detail);
    } finally { diagnosticPending.current = false; }
  };

  return (
    <Screen>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text variant="label" tone="muted">
            SEGUIMIENTO
          </Text>
          <Card padding="none">
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text variant="heading">Registrar peso</Text>
                <Text variant="body" tone="secondary">
                  Al desactivarlo se oculta y pausa el seguimiento. Tu historial se conserva.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Registrar peso"
                disabled={!preferencesReady}
                value={weightTrackingEnabled}
                onValueChange={setWeightTrackingEnabled}
              />
            </View>
          </Card>
          {syncError ? <Text tone="danger">{syncError}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text variant="label" tone="muted">
            DATOS
          </Text>
          <Card>
            <View style={styles.account}>
              <View style={styles.settingCopy}>
                <Text variant="heading">Importar desde MacroFactor</Text>
                <Text variant="body" tone="secondary">
                  Añade el historial y los nutrientes de una exportación XLSX.
                </Text>
              </View>
              <Button
                title="Abrir importador"
                variant="secondary"
                onPress={() => router.push('/macro-factor-import')}
              />
            </View>
          </Card>
        </View>

        <View style={styles.section}>
          <Text variant="label" tone="muted">
            CUENTA
          </Text>
          <Card>
            <View style={styles.account}>
              <View style={styles.settingCopy}>
                <Text variant="heading" selectable>
                  {isGuest ? 'Modo invitado' : (user?.name ?? 'Cuenta Balance')}
                </Text>
                <Text variant="body" tone="secondary" selectable>
                  {isGuest ? 'Los datos permanecen solo en este dispositivo.' : (user?.email ?? 'Sesión autenticada')}
                </Text>
              </View>
              <Button
                title={isGuest ? 'Salir del modo invitado' : 'Cerrar sesión'}
                variant="danger"
                loading={isLoading}
                onPress={handleLogout}
              />
            </View>
          </Card>
        </View>
        {refreshReplayAvailable ? <View style={styles.section}>
          <Text variant="label" tone="muted">COMPROBACIÓN</Text>
          <Card>
            <Text variant="body" tone="secondary">
              Comprueba cómo se cierra una sesión tras renovarla. Tendrás que iniciar sesión de nuevo.
            </Text>
            <Button title="Comprobar sesión" variant="secondary" onPress={handleRefreshReplay} />
          </Card>
        </View> : null}
        <View style={{ height: theme.space.xl }} />
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  content: { padding: t.space.xl, gap: t.space.xxl },
  section: { gap: t.space.sm },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.xl,
    padding: t.space.xl,
  },
  settingCopy: { flex: 1, gap: t.space.xs },
  account: { gap: t.space.xl },
}));
