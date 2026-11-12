import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { syncClient } from '@/services/sync/sync-client';
import type { SyncStatusSnapshot } from '@/services/sync/sync-status';
import { useTheme } from '@/theme';

export const STALE_PENDING_MS = 120_000;

export type SyncAttention = 'error' | 'offline' | 'stale' | null;

export function syncAttention(status: SyncStatusSnapshot, stale: boolean): SyncAttention {
  if (status.phase === 'inactive') return null;
  if (status.phase === 'error') return 'error';
  if (status.phase === 'offline' && status.pendingChanges > 0) return 'offline';
  if (stale && status.pendingChanges > 0) return 'stale';
  return null;
}

interface ToastSnapshot {
  status: SyncStatusSnapshot;
  attention: SyncAttention;
  key: string | null;
  visible: boolean;
}

const hiddenStatus: SyncStatusSnapshot = Object.freeze({
  phase: 'inactive',
  receivedDocuments: 0,
  pendingChanges: 0,
  lastSyncedAt: null,
  error: null,
});

const serverSnapshot: ToastSnapshot = Object.freeze({
  status: hiddenStatus,
  attention: null,
  key: null,
  visible: false,
});
const getServerToastSnapshot = () => serverSnapshot;

const storeListeners = new Set<() => void>();
let ownerUnsubscribe: (() => void) | null = null;
let pendingSince: number | null = null;
let stale = false;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
let dismissedKey: string | null = null;
let currentSnapshot: ToastSnapshot = serverSnapshot;

function attentionKey(status: SyncStatusSnapshot, attention: SyncAttention): string | null {
  if (attention === null) return null;
  return attention === 'error' ? `error:${status.error ?? ''}` : attention;
}

function sameStatus(a: SyncStatusSnapshot, b: SyncStatusSnapshot): boolean {
  return (
    a === b ||
    (a.phase === b.phase &&
      a.receivedDocuments === b.receivedDocuments &&
      a.pendingChanges === b.pendingChanges &&
      a.lastSyncedAt === b.lastSyncedAt &&
      a.error === b.error)
  );
}

function clearStaleTimer() {
  if (staleTimer !== null) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
}

function onStaleTimeout() {
  staleTimer = null;
  if (pendingSince === null) return;
  const elapsed = Date.now() - pendingSince;
  if (elapsed >= STALE_PENDING_MS) {
    stale = true;
    reconcile(true);
  } else {
    staleTimer = setTimeout(onStaleTimeout, STALE_PENDING_MS - elapsed);
  }
}

function reconcile(notify: boolean) {
  const nextStatus = syncClient.getStatusSnapshot();
  if (nextStatus.phase !== 'inactive' && nextStatus.pendingChanges > 0) {
    if (pendingSince === null) {
      pendingSince = Date.now();
      stale = false;
      clearStaleTimer();
      staleTimer = setTimeout(onStaleTimeout, STALE_PENDING_MS);
    } else if (!stale) {
      const elapsed = Date.now() - pendingSince;
      if (elapsed >= STALE_PENDING_MS) {
        stale = true;
        clearStaleTimer();
      } else if (staleTimer === null) {
        staleTimer = setTimeout(onStaleTimeout, STALE_PENDING_MS - Math.max(0, elapsed));
      }
    }
  } else {
    clearStaleTimer();
    pendingSince = null;
    stale = false;
  }

  const attention = syncAttention(nextStatus, stale);
  const key = attentionKey(nextStatus, attention);
  if (key === null) {
    dismissedKey = null;
  }
  const visible = key !== null && key !== dismissedKey;

  if (
    sameStatus(currentSnapshot.status, nextStatus) &&
    currentSnapshot.attention === attention &&
    currentSnapshot.key === key &&
    currentSnapshot.visible === visible
  ) {
    return;
  }

  currentSnapshot = Object.freeze({ status: nextStatus, attention, key, visible });
  if (notify) {
    for (const listener of storeListeners) listener();
  }
}

function dismissToast() {
  if (currentSnapshot.key === null || dismissedKey === currentSnapshot.key) return;
  dismissedKey = currentSnapshot.key;
  reconcile(true);
}

function subscribeToast(listener: () => void): () => void {
  storeListeners.add(listener);
  if (ownerUnsubscribe === null) {
    ownerUnsubscribe = syncClient.subscribeStatus(() => reconcile(true));
    reconcile(false);
  }
  return () => {
    storeListeners.delete(listener);
    if (storeListeners.size === 0) {
      ownerUnsubscribe?.();
      ownerUnsubscribe = null;
      clearStaleTimer();
    }
  };
}

function getToastSnapshot(): ToastSnapshot {
  return currentSnapshot;
}

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

export interface SyncStatusBannerProps {
  offset?: number;
}

/** A view of the existing owner; this component never fetches or stores documents. */
export function SyncStatusBanner({ offset = 0 }: SyncStatusBannerProps) {
  const toast = useToastState();
  const status = toast.status;
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const [trackWidth, setTrackWidth] = useState(0);
  const busy = toast.visible && (status.phase === 'connecting' || status.phase === 'syncing');

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

  if (!toast.visible || status.phase === 'inactive') return null;

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
    <View
      testID="sync-status-banner"
      style={{
        position: 'absolute',
        top: offset,
        left: 0,
        right: 0,
        zIndex: 20,
        pointerEvents: 'box-none',
      }}
    >
      <View style={{
        marginHorizontal: theme.space.md,
        marginVertical: theme.space.xs,
        paddingHorizontal: theme.space.sm,
        paddingVertical: theme.space.xs,
        borderRadius: theme.radius.md,
        borderCurve: 'continuous',
        backgroundColor: theme.colors.surface,
        borderWidth: theme.border.hairline,
        borderColor: theme.colors.border,
        shadowColor: theme.colors.shadow,
        shadowOpacity: 0.16,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ocultar estado de sincronización"
            onPress={dismissToast}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.sm,
              backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface,
            })}
          >
            <Icon name="x" size={theme.space.lg} tone="secondary" />
          </Pressable>
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
    </View>
  );
}

function useToastState(): ToastSnapshot {
  return useSyncExternalStore(subscribeToast, getToastSnapshot, getServerToastSnapshot);
}
