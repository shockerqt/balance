import React, { useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, TouchableOpacity, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Button, Icon, Screen, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { paletteNames } from '@/theme/organic-palettes';
import type { Appearance, ColorSource } from '@/theme/organic-palettes';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { makeStyles, useTheme, useThemeControls } from '@/theme';

export default function SettingsScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const { preference, setPreference, ready } = useThemeControls();
  const router = useRouter();
  const { user, isGuest, isLoading, logout, accountChoicesAvailable } = useAuth();
  const { preferencesReady, weightTrackingEnabled, syncError, setWeightTrackingEnabled } =
    usePreferencesStore();

  const logoutPending = useRef(false);
  const handleLogout = async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    try {
      const status = await logout();
      if (status === 'in_progress') return;
      if (status === 'unconfirmed') Alert.alert(
        accountChoicesAvailable ? 'No se pudo confirmar el cierre' : 'Sesión cerrada en Balance',
        accountChoicesAvailable
          ? 'No se pudo confirmar el cierre completo. Vuelve a intentarlo cuando tengas conexión.'
          : 'No se confirmó el cierre de la sesión de Eri.');
      router.replace('/login');
    } finally { logoutPending.current = false; }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Cuenta y configuración' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">Seguimiento</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text>Registrar peso</Text>
              <Text variant="caption" tone="secondary">Se conserva tu historial</Text>
            </View>
            <Switch
              accessibilityLabel="Registrar peso"
              accessibilityHint="Al desactivarlo se oculta y pausa el seguimiento. Tu historial se conserva."
              disabled={!preferencesReady}
              value={weightTrackingEnabled}
              trackColor={{ false: theme.colors.outline, true: theme.colors.primary }}
              thumbColor={weightTrackingEnabled ? theme.colors.onPrimary : theme.colors.surface}
              onValueChange={setWeightTrackingEnabled}
            />
          </View>
          {syncError ? <Text tone="danger" accessibilityRole="alert">{syncError}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">Apariencia</Text>
          <SettingsSelect
            label="Modo"
            value={preference.appearance}
            options={appearanceOptions}
            disabled={!ready}
            onSelect={(appearance) => setPreference({ ...preference, appearance })}
          />
          <SettingsSelect
            label="Colores"
            value={preference.colorSource}
            options={colorOptions}
            disabled={!ready}
            onSelect={(colorSource) => setPreference({ ...preference, colorSource })}
          />
        </View>

        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">Datos</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityHint="Añade el historial y los nutrientes de una exportación XLSX."
            style={styles.toolLink}
            onPress={() => router.push('/macro-factor-import')}
          >
            <Text style={styles.settingCopy}>Importar desde MacroFactor</Text>
            <Icon name="chevron-right" size={18} tone="primary" />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">Cuenta</Text>
          <Text variant="bodyStrong" selectable>
            {isGuest ? 'Modo invitado' : (user?.name ?? 'Cuenta Balance')}
          </Text>
          <Text tone="secondary" selectable>
            {isGuest ? 'Los datos permanecen en este dispositivo.' : (user?.email ?? 'Sesión autenticada')}
          </Text>
          <Button
            title={isGuest ? 'Salir del modo invitado' : 'Cerrar sesión'}
            variant="danger"
            loading={isLoading}
            onPress={handleLogout}
          />
        </View>

        <View style={{ height: theme.space.xl }} />
      </ScrollView>
    </Screen>
  );
}

const appearanceOptions: [Appearance, string][] = [
  ['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro'],
];
const colorOptions = Object.entries(paletteNames) as [ColorSource, string][];

function SettingsSelect<T extends string>({ label, value, options, disabled, onSelect }: {
  label: string;
  value: T;
  options: [T, string][];
  disabled: boolean;
  onSelect: (value: T) => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find(([key]) => key === value)?.[1] ?? value;
  return (
    <View style={styles.field}>
      <Text tone="secondary">{label}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selectedLabel }}
        accessibilityHint="Abre el menú de opciones"
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.select, disabled && styles.disabled]}
      >
        <Text style={styles.settingCopy}>{selectedLabel}</Text>
        <Icon name="chevron-down" size={16} tone="primary" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <Pressable
            style={styles.backdrop}
            accessibilityRole="button"
            accessibilityLabel={`Cerrar menú de ${label}`}
            onPress={() => setOpen(false)}
          />
          <View style={styles.menu} accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)}>
            <Text variant="title" accessibilityRole="header">{label}</Text>
            <ScrollView accessibilityRole="menu" accessibilityLabel={label}>
              {options.map(([key, title]) => (
                <TouchableOpacity
                  key={key}
                  accessibilityRole="menuitem"
                  accessibilityLabel={title}
                  accessibilityState={{ selected: value === key, disabled }}
                  disabled={disabled}
                  style={[styles.menuItem, value === key && styles.selected]}
                  onPress={() => { setOpen(false); onSelect(key); }}
                >
                  <Text style={styles.settingCopy}>{title}</Text>
                  {value === key ? <Icon name="check" tone="primary" /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(false)} style={styles.menuItem}>
              <Text tone="accent">Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  content: { padding: t.space.xl, gap: t.space.xl },
  section: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.xl,
    padding: t.space.xl,
    gap: t.space.lg,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.lg,
    minHeight: 64,
  },
  settingCopy: { flex: 1, gap: t.space.xs },
  field: { gap: t.space.sm, paddingBottom: t.space.lg },
  select: {
    minHeight: 48,
    borderRadius: t.radius.md + 2,
    paddingHorizontal: t.space.md + 2,
    paddingVertical: t.space.md,
    backgroundColor: t.colors.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
  },
  toolLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  disabled: { opacity: 0.55 },
  modal: { flex: 1, justifyContent: 'center', padding: t.space.xl },
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: t.colors.scrim },
  menu: { maxHeight: '80%', backgroundColor: t.colors.surface, borderRadius: t.radius.xl, padding: t.space.xl, gap: t.space.lg },
  menuItem: { minHeight: 48, padding: t.space.md, borderRadius: t.radius.md, flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  selected: { backgroundColor: t.colors.surfaceRaised },
}));
