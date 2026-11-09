import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Switch, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen, Button, Card, Icon, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { logsDateStore, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { currentTimeString, displayDateFor, todayId } from '@/lib/dates';
import { useTheme } from '@/theme';
import { gradientBackground } from '@/theme/gradient';
import { WeightTrendCard } from '@/components/weight/weight-trend-card';
import { CalendarMonth } from './calendar-month';
import { ReactNativeDiary } from './react-native-diary';
import { ReactNativeSummary } from './react-native-summary';
import { PageHeader } from './page-header';

export default function ReactNativeInterfaceScreen() {
  const { user, isGuest } = useAuth();
  return <InterfaceSession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}

const Diary = React.memo(ReactNativeDiary);
const destinations = [
  { title: 'Alimentos', icon: 'notebook-pen' }, { title: 'Mediciones', icon: 'ruler' },
  { title: 'Resumen', icon: 'chart-no-axes-combined' }, { title: 'Perfil', icon: 'user-round' },
] as const;

function InterfaceSession() {
  const router = useRouter();
  const theme = useTheme();
  const [destination, setDestination] = useState(0);
  const [date] = useLogsSelectedDate();
  const [measurementDate, setMeasurementDate] = useState(date);
  const preference = usePreferencesStore();
  useEffect(() => { setMeasurementDate(date); }, [date]);
  const target = destination === 1 ? measurementDate : date;
  const active = useRef(false);
  const focusGeneration = useRef(0);
  const liveTarget = useRef(target);
  useLayoutEffect(() => { liveTarget.current = target; }, [target]);
  useFocusEffect(useCallback(() => { active.current = true; focusGeneration.current++; return () => { active.current = false; focusGeneration.current++; }; }, []));
  const registerFood = (generation: number) => { if (!active.current || liveTarget.current !== target || focusGeneration.current !== generation) return; logsDateStore.set(target); router.push({ pathname: '/food-search', params: { dateId: target, time: currentTimeString() } }); };
  const register = () => {
    const generation = focusGeneration.current;
    if (preference.preferencesReady && preference.weightTrackingEnabled && target <= todayId())
      Alert.alert('Registrar', displayDateFor(target), [
        { text: 'Alimento', onPress: () => registerFood(generation) },
        { text: 'Peso', onPress: () => { if (active.current && liveTarget.current === target && focusGeneration.current === generation) router.push({ pathname: '/weight-entry', params: { dateId: target } }); } },
        { text: 'Cancelar', style: 'cancel' },
      ]);
    else registerFood(generation);
  };
  return <Screen edges={['top', 'bottom']}>
    <View style={{ flex: 1 }}>
      {destination === 0 ? <Diary /> : destination === 1 ? <Measurements date={measurementDate} onDate={setMeasurementDate} /> : destination === 2 ?
        <ReactNativeSummary onOpen={(selected, body) => { logsDateStore.set(selected); setMeasurementDate(selected); setDestination(body ? 1 : 0); }} /> : <Profile />}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 10, backgroundColor: theme.colors.surface }}>
      {[0, 1, -1, 2, 3].map(index => index === -1 ?
        <TouchableOpacity key="register" accessibilityRole="button" accessibilityLabel="Registrar alimento o peso" onPress={register}
          style={[{ width: 56, height: 56, marginHorizontal: 6, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary }, gradientBackground(theme.gradients.action)]}>
          <Icon name="plus" size={26} tone="onPrimary" />
        </TouchableOpacity> :
        <TouchableOpacity key={index} accessibilityRole="tab" accessibilityLabel={destinations[index].title} accessibilityState={{ selected: destination === index }} onPress={() => setDestination(index)}
          style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 5, borderRadius: 16, backgroundColor: destination === index ? theme.colors.surfaceRaised : 'transparent' }}>
            <Icon name={destinations[index].icon} size={20} tone={destination === index ? 'accent' : 'secondary'} />
          </View>
          <Text variant="caption" tone={destination === index ? 'primary' : 'secondary'} style={{ fontSize: 10 }}>{destinations[index].title}</Text>
        </TouchableOpacity>)}
    </View>
  </Screen>;
}

function Measurements({ date, onDate }: { date: string; onDate: (date: string) => void }) {
  const preference = usePreferencesStore();
  const weight = useWeightStore();
  const router = useRouter();
  return <View style={{ flex: 1 }}>
    <PageHeader title="Mediciones" subtitle="Peso" />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 20 }}>
      {!preference.preferencesReady ? <Text>Cargando preferencias…</Text> : !preference.weightTrackingEnabled ? <Text tone="secondary">El seguimiento de peso está desactivado. Puedes activarlo en Perfil.</Text> : <>
        <CalendarMonth value={date} onChange={onDate} marked={weight.weightsByDate} />
        <Text variant="heading">{displayDateFor(date)}</Text>
        {date <= todayId() ? <WeightTrendCard dateId={date} weightsByDate={weight.weightsByDate}
          onPress={() => router.push({ pathname: '/weight-entry', params: { dateId: date } })} /> : <Text tone="secondary">Elige hoy o una fecha anterior para registrar peso.</Text>}
        {weight.syncError ? <Text selectable tone="danger">{weight.syncError.message}</Text> : null}
      </>}
    </ScrollView>
  </View>;
}

function Profile() {
  const router = useRouter();
  const { user, isGuest } = useAuth();
  const preference = usePreferencesStore();
  return <View style={{ flex: 1 }}>
    <PageHeader title="Perfil" subtitle="Tu cuenta y tus herramientas" />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 20 }}>
      <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}><Icon name="user-round" size={36} tone="accent" />
        <View style={{ gap: 5 }}><Text variant="title">{user?.name ?? (isGuest ? 'Invitado' : 'Cuenta')}</Text><Text tone="secondary">{isGuest ? 'Datos en este dispositivo' : 'Cuenta conectada'}</Text></View>
      </View>
      <Card style={{ gap: 14 }}>
        <Text variant="heading">Preferencias</Text>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ flex: 1, gap: 5 }}><Text>Seguimiento de peso</Text><Text variant="caption" tone="secondary">Tu historial se conserva al desactivar</Text></View>
          <Switch accessibilityLabel="Seguimiento de peso" value={preference.weightTrackingEnabled} disabled={!preference.preferencesReady} onValueChange={preference.setWeightTrackingEnabled} />
        </View>
        {preference.syncError ? <Text selectable tone="danger">{preference.syncError}</Text> : null}
        <Text tone="secondary">kg · g / ml · kcal</Text>
      </Card>
      <Card style={{ gap: 12 }}><Text variant="heading">Herramientas</Text>
        <Button title="Biblioteca" variant="secondary" onPress={() => router.push('/(tabs)/library')} />
        <Button title="Importar MacroFactor" variant="secondary" onPress={() => router.push('/macro-factor-import')} />
        <Button title="Cuenta y configuración" variant="secondary" onPress={() => router.push('/settings')} />
      </Card>
    </ScrollView>
  </View>;
}
