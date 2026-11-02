import React, { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SyncStatusBanner } from '@/components/sync/sync-status-banner';
import { gradientBackground } from '@/theme/gradient';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { FoodLibraryFilter, FoodLibraryList } from '@/components/food-library/food-library-list';
import { Icon, Input, Screen, Text } from '@/components/ui';
import { makeStyles, useTheme } from '@/theme';

const FILTERS: { value: FoodLibraryFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'personal', label: 'Personal' },
  { value: 'official', label: 'Oficial' }
];

export default function LibraryScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const { libraryFoods, isLibraryReady, syncNotice, clearSyncNotice } = useFoodLibraryStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FoodLibraryFilter>('all');

  const openFood = (id?: string) => {
    router.push({ pathname: '/food-library-food', params: id ? { id } : {} });
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ headerTitleStyle: { fontFamily: 'Outfit', fontSize: 21, fontWeight: '500' }, headerRight: () => (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Crear alimento personal" onPress={() => openFood()} style={[{ width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, gradientBackground(theme.gradients.action)]}>
          <Icon name="plus" size={22} tone="onPrimary" />
        </TouchableOpacity>
      ) }} />
      <SyncStatusBanner />

      <View style={styles.controls}>
        {syncNotice ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cerrar aviso de sincronización"
            activeOpacity={0.75}
            style={styles.syncNotice}
            onPress={clearSyncNotice}>
            <Icon name="refresh-cw" size={18} tone="accent" />
            <Text variant="caption" tone="secondary" selectable style={styles.syncNoticeCopy}>
              {syncNotice}
            </Text>
            <Icon name="x" size={16} tone="muted" />
          </TouchableOpacity>
        ) : null}

        <Input
          style={{ borderRadius: 18, minHeight: 52, backgroundColor: theme.colors.surface }}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar un alimento"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Buscar en la biblioteca"
        />

        <View accessibilityRole="tablist" style={styles.filters}>
          {FILTERS.map((option) => {
            const selected = filter === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                activeOpacity={0.75}
                style={[styles.filter, selected && styles.filterSelected]}
                onPress={() => setFilter(option.value)}>
                <Text variant="caption" tone={selected ? 'primary' : 'secondary'}>
                  {option.label}
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
  syncNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    padding: t.space.md,
    borderWidth: 0,
    borderColor: t.colors.primary,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.surfaceRaised
  },
  syncNoticeCopy: { flex: 1 },
  filters: {
    flexDirection: 'row',
    gap: t.space.sm
  },
  filter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: t.space.sm,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: t.space.sm,
    borderWidth: 0,
    borderColor: t.colors.border,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface
  },
  filterSelected: {
    borderColor: t.colors.primary,
    backgroundColor: t.colors.secondary
  },
  list: { flex: 1 }
}));
