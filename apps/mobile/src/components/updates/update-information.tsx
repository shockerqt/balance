import React, { useState, useSyncExternalStore } from 'react';
import { Share, View } from 'react-native';
import * as Updates from 'expo-updates';
import { Button, Card, Text } from '@/components/ui';
import { getNativePagerStatus, nativePagerStatusText, subscribeNativePagerStatus } from '@/dev/native-pager-status';

/** The native running-update identity, independent of published/downloaded updates. */
export function UpdateInformation() {
  const { currentlyRunning, downloadedUpdate, isUpdatePending } = Updates.useUpdates();
  const [details, setDetails] = useState(false);
  const runningId = currentlyRunning.updateId ?? Updates.updateId;
  const channel = currentlyRunning.channel ?? Updates.channel ?? 'Sin canal';
  const runtime = currentlyRunning.runtimeVersion ?? Updates.runtimeVersion ?? 'No disponible';
  const source = !Updates.isEnabled ? 'Bundle local · OTA desactivada' : currentlyRunning.isEmbeddedLaunch ? 'Incluida en la APK' : 'OTA aplicada';
  const identity = `Canal: ${channel}\nRuntime: ${runtime}\nOrigen: ${source}\nCódigo en ejecución: ${runningId ?? 'No disponible'}\nRecuperación: ${currentlyRunning.isEmergencyLaunch ? 'Sí' : 'No'}\nPendiente: ${isUpdatePending ? downloadedUpdate?.updateId ?? 'Sí' : 'No'}`;
  return <Card style={{ gap: 12 }}>
    <Text variant="title" accessibilityRole="header">Información de la app</Text>
    <Text selectable tone="secondary">Canal: {channel} · Runtime: {runtime}</Text>
    <Text selectable>{source}</Text>
    <Text variant="caption" tone="secondary">Código en ejecución</Text>
    <Text selectable accessibilityLabel="Código de la actualización en ejecución">{runningId ?? 'No disponible'}</Text>
    {isUpdatePending ? <Text selectable tone="secondary">Hay otra actualización descargada pendiente de aplicar: {downloadedUpdate?.updateId ?? 'Sin identificador'}. Se aplicará al reiniciar la app.</Text> : null}
    {currentlyRunning.isEmergencyLaunch ? <Text tone="danger">La app arrancó en modo de recuperación.</Text> : null}
    <Button title={details ? 'Ocultar diagnóstico' : 'Ver diagnóstico del deslizamiento'} variant="secondary" size="md" onPress={() => setDetails(!details)} />
    {details ? <PagerDetails identity={identity} /> : null}
  </Card>;
}

function PagerDetails({ identity }: { identity: string }) {
  const status = useSyncExternalStore(subscribeNativePagerStatus, getNativePagerStatus, getNativePagerStatus);
  const [error, setError] = useState('');
  return <View style={{ gap: 12 }}>
    <Text variant="caption" tone="secondary">Diagnóstico local · eventos del pager desde que abriste la app</Text>
    <Text selectable variant="caption">{nativePagerStatusText(status)}</Text>
    <Button title="Compartir diagnóstico" variant="ghost" size="md" onPress={async () => {
      try { await Share.share({ message: `${identity}\n${nativePagerStatusText(getNativePagerStatus())}` }); }
      catch { setError('No se pudo abrir el menú para compartir. Puedes copiar el texto manteniéndolo pulsado.'); }
    }} />
    {error ? <Text selectable tone="danger">{error}</Text> : null}
  </View>;
}
