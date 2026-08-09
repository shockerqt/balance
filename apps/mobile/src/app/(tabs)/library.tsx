import React, { useMemo, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { FoodLibraryFilter, FoodLibraryList } from '@/components/food-library/food-library-list';
import { Icon, Input, Screen, Text } from '@/components/ui';
import { makeStyles } from '@/theme';

const FILTERS: { value: FoodLibraryFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'personal', label: 'Míos' },
  { value: 'official', label: 'Oficiales' }
];

export default function LibraryScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { libraryFoods, isLibraryReady } = useFoodLibraryStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FoodLibraryFilter>('all');

  const counts = useMemo(
    () => ({
      personal: libraryFoods.filter((food) => !food.isOfficial).length,
      official: libraryFoods.filter((food) => food.isOfficial).length
    }),
    [libraryFoods]
  );

  const openFood = (id?: string) => {
    router.push({ pathname: '/food-library-food', params: id ? { id } : {} });
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <View style={styles.titleBlock}>
          <Text variant="label" tone="muted">
            BIBLIOTECA · {libraryFoods.length} REGISTROS
          </Text>
          <Text variant="display">Alimentos</Text>
          <Text variant="body" tone="secondary">
            Una sola ficha para cada porción que vuelves a registrar.
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Crear alimento personal"
          activeOpacity={0.75}
          style={styles.createButton}
          onPress={() => openFood()}>
          <Icon name="plus" size={22} tone="onPrimary" />
        </TouchableOpacity>
      </View>

      <View style={styles.controls}>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por nombre, categoría o porción"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Buscar en la biblioteca"
        />

        <View accessibilityRole="tablist" style={styles.filters}>
          {FILTERS.map((option) => {
            const selected = filter === option.value;
            const count = option.value === 'all' ? libraryFoods.length : counts[option.value];
            return (
              <TouchableOpacity
                key={option.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                activeOpacity={0.75}
                style={[styles.filter, selected && styles.filterSelected]}
                onPress={() => setFilter(option.value)}>
                <Text variant="caption" tone={selected ? 'onPrimary' : 'secondary'}>
                  {option.label} {count}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.list}>
        <FoodLibraryList
          foods={libraryFoods}
          filter={filter}
          query={query}
          isReady={isLibraryReady}
          onPressFood={(food) => openFood(food.id)}
          onCreateFood={() => openFood()}
        />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: t.space.lg,
    paddingHorizontal: t.space.xl,
    paddingTop: t.space.lg,
    paddingBottom: t.space.lg
  },
  titleBlock: { flex: 1, gap: t.space.xs },
  createButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.md,
    backgroundColor: t.colors.primary
  },
  controls: {
    gap: t.space.md,
    paddingHorizontal: t.space.xl,
    paddingBottom: t.space.lg
  },
  filters: {
    flexDirection: 'row',
    gap: t.space.sm
  },
  filter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: t.space.sm,
    paddingVertical: t.space.sm,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface
  },
  filterSelected: {
    borderColor: t.colors.primary,
    backgroundColor: t.colors.primary
  },
  list: { flex: 1 }
}));
