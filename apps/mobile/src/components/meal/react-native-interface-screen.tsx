import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ScrollView, Switch, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen, Button, Card, Icon, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { useTodayId } from '@/hooks/use-today-id';
import { logsDateStore, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { currentTimeString, displayDateFor, todayId } from '@/lib/dates';
import { font, useTheme } from '@/theme';
import { WeightTrendCard } from '@/components/weight/weight-trend-card';
import { CalendarMonth } from './calendar-month';
import { ReactNativeDiary } from './react-native-diary';
import { ReactNativeSummary } from './react-native-summary';
import { PageHeader } from './page-header';
import { QuickAddDock } from './quick-add-dock';

export default function ReactNativeInterfaceScreen() {
  const { user, isGuest } = useAuth();
  return <InterfaceSession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}

const Diary = React.memo(ReactNativeDiary);
const destinations = [
  { title: 'Diario', icon: 'receipt-text' }, { title: 'Mediciones', icon: 'trending-up' },
  { title: 'Resumen', icon: 'chart-no-axes-column' }, { title: 'Perfil', icon: 'user-round' },
] as const;

function InterfaceSession() {
  const router = useRouter();
  const theme = useTheme();
  const [destination, setDestination] = useState(0);
  const [date] = useLogsSelectedDate();
  const [measurementDate, setMeasurementDate] = useState(date);
  const preference = usePreferencesStore();
  const today = useTodayId();
  useEffect(() => { setMeasurementDate(date); }, [date]);
  const target = destination === 1 ? measurementDate : date;
  const active = useRef(false);
  const focusGeneration = useRef(0);
  const [focusToken, setFocusToken] = useState(0);
  const liveTarget = useRef(target);
  useLayoutEffect(() => { liveTarget.current = target; }, [target]);
  useFocusEffect(useCallback(() => { active.current = true; focusGeneration.current++; setFocusToken(focusGeneration.current); return () => { active.current = false; focusGeneration.current++; }; }, []));
  const liveDestination = useRef(destination);
  useLayoutEffect(() => { liveDestination.current = destination; }, [destination]);
  const valid = () => active.current && liveTarget.current === target && liveDestination.current === destination && focusGeneration.current === focusToken;
  const registerFood = (time = currentTimeString()) => {
    if (!valid()) return;
    logsDateStore.set(target);
    router.push({ pathname: '/food-search', params: { dateId: target, time } });
  };
  const weightAvailable = preference.preferencesReady && preference.weightTrackingEnabled && target <= today;
  const registerWeight = () => {
    if (valid() && weightAvailable) router.push({ pathname: '/weight-entry', params: { dateId: target } });
  };
  return <Screen edges={['top', 'bottom']}>
    <View style={{ flex: 1 }}>
      {destination === 0 ? <Diary today={today} /> : destination === 1 ? <Measurements date={measurementDate} today={today} onDate={setMeasurementDate} /> : destination === 2 ?
        <ReactNativeSummary onOpen={(selected, body) => { logsDateStore.set(selected); setMeasurementDate(selected); setDestination(body ? 1 : 0); }} /> : <Profile />}
    </View>
    <QuickAddDock contextKey={`${target}:${destination}`} weightAvailable={weightAvailable} onFood={registerFood} onWeight={registerWeight}>
      {[0, 1, 2, 3].map(index => <TouchableOpacity key={index} accessibilityRole="tab" accessibilityLabel={destinations[index].title} accessibilityState={{ selected: destination === index }} onPress={() => setDestination(index)}
          style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          <Icon name={destinations[index].icon} size={22} tone={destination === index ? 'primary' : 'secondary'} />
          <Text variant="label" tone={destination === index ? 'primary' : 'secondary'}
            style={{ fontFamily: destination === index ? font.semibold : font.medium }}>{destinations[index].title}</Text>
        </TouchableOpacity>)}
    </QuickAddDock>
  </Screen>;
}

function Measurements({ date, today, onDate }: { date: string; today: string; onDate: (date: string) => void }) {
  const preference = usePreferencesStore();
  const weight = useWeightStore();
  const router = useRouter();
  return <View style={{ flex: 1 }}>
    <PageHeader title="Mediciones" subtitle="Peso" />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 20 }}>
      {!preference.preferencesReady ? <Text>Cargando preferencias…</Text> : !preference.weightTrackingEnabled ? <Text tone="secondary">El seguimiento de peso está desactivado. Puedes activarlo en Perfil.</Text> : <>
        <CalendarMonth value={date} onChange={onDate} marked={weight.weightsByDate} />
        <Text variant="heading">{displayDateFor(date)}</Text>
        {date <= today ? <WeightTrendCard dateId={date} weightsByDate={weight.weightsByDate}
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
