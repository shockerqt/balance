import React, { useMemo } from 'react';
import { ActivityIndicator, SectionList, View } from 'react-native';
import type { LibraryFoodItem } from '@/hooks/use-food-library-store';
import { Button, Text } from '@/components/ui';
import { makeStyles, useTheme } from '@/theme';
import { FoodLibraryRow } from './food-library-row';

export type FoodLibraryFilter = 'all' | 'personal' | 'official';

interface FoodLibraryListProps {
  foods: LibraryFoodItem[];
  filter?: FoodLibraryFilter;
  query?: string;
  isReady: boolean;
  onPressFood: (food: LibraryFoodItem) => void;
  onCreateFood?: () => void;
  emptyMessage?: string;
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CL');

export const useFoodLibrarySections = (
  foods: LibraryFoodItem[],
  filter: FoodLibraryFilter = 'all',
  query = ''
) =>
  useMemo(() => {
    const needle = normalize(query.trim());
    const visible = foods
      .filter((food) => {
        if (filter === 'personal' && food.isOfficial) return false;
        if (filter === 'official' && !food.isOfficial) return false;
        if (!needle) return true;
        return normalize(`${food.name} ${food.category ?? ''} ${food.portion}`).includes(needle);
      })
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es-CL'));

    const personal = visible.filter((food) => !food.isOfficial);
    const official = visible.filter((food) => food.isOfficial);

    return [
      ...(filter !== 'official' && personal.length
        ? [
            {
              key: 'personal',
              title: 'MIS ALIMENTOS',
              caption: 'Puedes editarlos',
              data: personal
            }
          ]
        : []),
      ...(filter !== 'personal' && official.length
        ? [
            {
              key: 'official',
              title: 'CATÁLOGO OFICIAL',
              caption: 'Solo lectura',
              data: official
            }
          ]
        : [])
    ];
  }, [filter, foods, query]);

export const FoodLibraryList: React.FC<FoodLibraryListProps> = ({
  foods,
  filter = 'all',
  query = '',
  isReady,
  onPressFood,
  onCreateFood,
  emptyMessage,
}) => {
  const styles = useStyles();
  const theme = useTheme();
  const sections = useFoodLibrarySections(foods, filter, query);

  const emptyCopy = emptyMessage ?? (query.trim()
    ? 'No hay alimentos que coincidan con esta búsqueda.'
    : filter === 'official'
      ? 'El catálogo oficial todavía no está disponible. Tus alimentos personales siguen funcionando sin conexión.'
      : 'Tu biblioteca personal está vacía. Crea un alimento para reutilizar sus datos cada vez que lo registres.');

  return (
    <SectionList
      sections={sections}
      keyExtractor={(food) => food.id}
      renderItem={({ item }) => <FoodLibraryRow food={item} onPress={onPressFood} />}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text variant="label">{section.title}</Text>
          <Text variant="caption" tone="muted">
            {section.data.length} · {section.caption}
          </Text>
        </View>
      )}
      stickySectionHeadersEnabled
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={sections.length ? styles.content : styles.emptyContent}
      ListEmptyComponent={
        <View style={styles.empty}>
          {!isReady ? (
            <>
              <ActivityIndicator color={theme.colors.text} />
              <Text variant="body" tone="secondary">
                Abriendo la biblioteca…
              </Text>
            </>
          ) : (
            <>
              <IconEmpty />
              <Text variant="heading">Nada por aquí</Text>
              <Text variant="body" tone="secondary" style={styles.emptyCopy}>
                {emptyCopy}
              </Text>
              {onCreateFood && filter !== 'official' && !query.trim() ? (
                <Button title="Crear alimento" size="md" onPress={onCreateFood} />
              ) : null}
            </>
          )}
        </View>
      }
    />
  );
};

const IconEmpty = () => {
  const styles = useStyles();
  return (
    <View style={styles.emptyMark}>
      <Text variant="title">＋</Text>
    </View>
  );
};

const useStyles = makeStyles((t) => ({
  content: { paddingBottom: t.space.xxxl * 3 + t.space.lg },
  emptyContent: { flexGrow: 1 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: t.space.md,
    paddingHorizontal: t.space.lg,
    paddingTop: t.space.md,
    paddingBottom: t.space.sm,
    borderTopWidth: t.border.rule,
    borderBottomWidth: t.border.hairline,
    borderColor: t.colors.text,
    backgroundColor: t.colors.surfaceRaised
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.space.md,
    padding: t.space.xxxl
  },
  emptyCopy: { maxWidth: 320, textAlign: 'center' },
  emptyMark: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: t.border.rule,
    borderColor: t.colors.text,
    borderRadius: t.radius.pill
  }
}));
