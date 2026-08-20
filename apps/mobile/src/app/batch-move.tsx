import React, { useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMealStore } from '@/hooks/use-meal-store';
import { makeStyles, useTheme } from '@/theme';
import { Button, Field, Input, Sheet, Text } from '@/components/ui';
import { todayId } from '@/lib/dates';

/* Mover varios registros a otra hora. Era un Modal hecho a mano; pasa
   a ser hoja del router como el resto de los formularios. */

const ATAJOS = ['08:00', '11:00', '13:00', '16:00', '19:00', '21:00'];

export default function BatchMoveScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const { dateId, ids } = useLocalSearchParams<{ dateId?: string; ids?: string }>();

  const { moveMultipleFoodsTime } = useMealStore();
  const targetDate = dateId || todayId();
  const foodIds = (ids ?? '').split(',').filter(Boolean);

  const [time, setTime] = useState('13:00');

  const confirm = () => {
    if (foodIds.length) moveMultipleFoodsTime(targetDate, foodIds, time.trim() || '13:00');
    router.back();
  };

  const count = foodIds.length;

  return (
    <Sheet
      title="Mover a otra hora"
      subtitle={`${count} ${count === 1 ? 'registro' : 'registros'}`}
      closeLabel="Cancelar">
      <ScrollView
        contentContainerStyle={[styles.content, { gap: theme.space.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Field label="Nueva hora" hint="Formato de 24 horas">
          <Input
            value={time}
            onChangeText={setTime}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            placeholder="13:00"
            autoFocus
          />
        </Field>

        <View style={[styles.shortcuts, { gap: theme.space.sm }]}>
          {ATAJOS.map((t) => (
            <TouchableOpacity
              key={t}
              accessibilityRole="button"
              accessibilityState={{ selected: time === t }}
              style={[styles.chip, time === t && styles.chipOn]}
              delayPressIn={0}
              onPress={() => setTime(t)}>
              <Text variant="caption" tone={time === t ? 'onPrimary' : 'secondary'}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Button title={`Mover a las ${time}`} onPress={confirm} />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  content: { padding: t.space.xl, paddingBottom: t.space.xxxl },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.sm,
    borderRadius: t.radius.md,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  chipOn: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
}));
