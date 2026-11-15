import React from 'react';
import * as Updates from 'expo-updates';
import { Card, Text } from '@/components/ui';

/** The native running-update identity, independent of published/downloaded updates. */
export function UpdateInformation() {
  const { currentlyRunning, downloadedUpdate, isUpdatePending } = Updates.useUpdates();
  const runningId = currentlyRunning.updateId ?? Updates.updateId;
  const channel = currentlyRunning.channel ?? Updates.channel ?? 'Sin canal';
  const runtime = currentlyRunning.runtimeVersion ?? Updates.runtimeVersion ?? 'No disponible';
  const source = !Updates.isEnabled ? 'Bundle local · OTA desactivada' : currentlyRunning.isEmbeddedLaunch ? 'Incluida en la APK' : 'OTA aplicada';
  return <Card style={{ gap: 12 }}>
    <Text variant="title" accessibilityRole="header">Información de la app</Text>
    <Text selectable tone="secondary">Canal: {channel} · Runtime: {runtime}</Text>
    <Text selectable>{source}</Text>
    <Text variant="caption" tone="secondary">Código en ejecución</Text>
    <Text selectable accessibilityLabel="Código de la actualización en ejecución">{runningId ?? 'No disponible'}</Text>
    {isUpdatePending ? <Text selectable tone="secondary">Hay otra actualización descargada pendiente de aplicar: {downloadedUpdate?.updateId ?? 'Sin identificador'}. Se aplicará al reiniciar la app.</Text> : null}
    {currentlyRunning.isEmergencyLaunch ? <Text tone="danger">La app arrancó en modo de recuperación.</Text> : null}
  </Card>;
}
