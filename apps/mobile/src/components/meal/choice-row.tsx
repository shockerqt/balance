import React from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui';

export function ChoiceRow({ values, selected, onChange, disabled = false }: { values: string[]; selected: number; onChange: (index: number) => void; disabled?: boolean }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{values.map((value, i) =>
    <Button key={`${i}:${value}`} title={value} size="md" variant={selected === i ? 'primary' : 'secondary'} disabled={disabled}
      accessibilityState={{ selected: selected === i, disabled }} onPress={() => onChange(i)} style={{ paddingHorizontal: 12 }} />)}</View>;
}
