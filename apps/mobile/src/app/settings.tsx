import React from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { makeStyles, useTheme } from '@/theme';

export default function SettingsScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const { user, isGuest, logout } = useAuth();
  const { preferencesReady, weightTrackingEnabled, syncError, setWeightTrackingEnabled } =
    usePreferencesStore();

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
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
                onPress={handleLogout}
              />
            </View>
          </Card>
        </View>
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
