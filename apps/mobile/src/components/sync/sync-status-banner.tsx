import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { syncClient } from '@/services/sync/sync-client';
import { useTheme } from '@/theme';

function useReducedMotion(): boolean {
  // Stay still until the preference is known, including after a failed query.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      if (mounted) setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !changed) setReduced(value);
    }).catch(() => {});
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

const count = (value: number) => value.toLocaleString('es-CL');

/** A view of the existing owner; this component never fetches or stores documents. */
export function SyncStatusBanner() {
  const status = useSyncStatus();
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const [trackWidth, setTrackWidth] = useState(0);
  const busy = status.phase === 'connecting' || status.phase === 'syncing';

  useEffect(() => {
    progress.setValue(0);
    if (!busy || reducedMotion) return;
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 1,
      duration: 1400,
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    }));
    animation.start();
    return () => {
      animation.stop();
      progress.stopAnimation();
      progress.setValue(0);
    };
  }, [busy, reducedMotion, progress]);

  if (status.phase === 'inactive') return null;

  const titles = {
    connecting: 'Conectando con el servidor',
    syncing: 'Sincronizando',
    pending: 'Sincronización pendiente',
    synced: 'Actualizado',
    offline: 'Sin conexión',
    error: 'No se pudo sincronizar',
  };
  const icons = {
    connecting: 'cloud',
    syncing: 'refresh-cw',
    pending: 'clock',
    synced: 'check',
    offline: 'cloud-off',
    error: 'circle-alert',
  } as const;
  const received = status.phase === 'synced' && status.receivedDocuments === 0
    ? 'Sin registros nuevos'
    : `${count(status.receivedDocuments)} registros recibidos`;
  const pending = `${count(status.pendingChanges)} ${status.pendingChanges === 1 ? 'cambio pendiente' : 'cambios pendientes'}`;
  let detail = status.pendingChanges > 0 ? `${received} · ${pending}` : received;
  if (status.phase === 'connecting' && status.receivedDocuments === 0) {
    detail = status.pendingChanges > 0 ? pending : 'Preparando la sincronización';
  } else if (status.phase === 'synced') {
    detail = status.lastSyncedAt === null ? received : `${received} · ${new Date(status.lastSyncedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
  } else if (status.phase === 'offline' && status.pendingChanges === 0) {
    detail = `${received} · Revisa tu conexión`;
  } else if (status.phase === 'error') {
    const reason = {
      download: 'No se completó la descarga',
      upload: 'No se completó el envío',
      local: 'No se pudieron guardar los datos',
      connection: 'No se pudo conectar al servidor',
    };
    detail = `${status.error ? reason[status.error] : 'Inténtalo de nuevo'} · ${status.pendingChanges > 0 ? pending : received}`;
  }
  const retryable = status.phase === 'offline' || status.phase === 'error' || status.phase === 'pending';
  const color = status.phase === 'error' ? theme.colors.danger : status.phase === 'synced' ? theme.colors.success : theme.colors.text;
  const segmentWidth = Math.max(theme.space.xxxl, trackWidth / 3);

  return (
    <View testID="sync-status-banner" style={{
      flexShrink: 0,
      marginHorizontal: theme.space.md,
      marginVertical: theme.space.xs,
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.xs,
      borderRadius: theme.radius.md,
      borderCurve: 'continuous',
      backgroundColor: theme.colors.surface,
      borderWidth: theme.border.hairline,
      borderColor: theme.colors.border,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, minHeight: 44 }}>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon name={icons[status.phase]} size={theme.space.xl} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0, paddingVertical: theme.space.xs }}>
          <Text
            testID="sync-status-title"
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy }}
            accessibilityLabel={`Sincronización: ${titles[status.phase]}`}
            style={[theme.type.bodyStrong, { color }]}
          >{titles[status.phase]}</Text>
          <Text
            testID="sync-status-detail"
            selectable
            accessibilityLiveRegion="none"
            accessibilityLabel={detail}
            style={[theme.type.caption, { color: theme.colors.textSecondary, fontVariant: ['tabular-nums'] }]}
          >{detail}</Text>
        </View>
        {retryable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reintentar sincronización"
            onPress={() => { void syncClient.retrySync().catch(() => {}); }}
            style={({ pressed }) => ({
              minWidth: 44,
              minHeight: 44,
              paddingHorizontal: theme.space.sm,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.sm,
              backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface,
            })}
          >
            <Text style={[theme.type.caption, { color: theme.colors.text }]}>Reintentar</Text>
          </Pressable>
        )}
      </View>
      {/* Reserve the same track space in every visible state. It is never a percentage. */}
      <View
        testID="sync-status-track"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
        style={{ height: theme.border.rule, overflow: 'hidden', borderRadius: theme.radius.pill, backgroundColor: theme.colors.border, opacity: busy ? 1 : 0 }}
      >
        {busy && <Animated.View style={{
          height: theme.border.rule,
          width: segmentWidth,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.primary,
          transform: [{ translateX: reducedMotion ? Math.max(0, (trackWidth - segmentWidth) / 2) : progress.interpolate({ inputRange: [0, 1], outputRange: [-segmentWidth, trackWidth] }) }],
        }} />}
      </View>
    </View>
  );
}
