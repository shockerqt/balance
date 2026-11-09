import React, { useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { FlashList } from '@shopify/flash-list';
import { LegendList } from '@legendapp/list/react-native';
import type { LoggedFoodItem } from '../../hooks/use-meal-store';
import { buildHourRailRows, type HourRailRow } from '../../lib/hours';
import { RailRow, type FeedActions, type HourRailFeedHandle } from './hour-rail-feed';

export type RecyclingListEngine = 'flash' | 'legend';
const keyExtractor = (row: HourRailRow) => row.key;
const getItemType = (row: HourRailRow) => row.kind;

/** Shared cells/data/overscan make the phone comparison useful. */
export const RecyclingHourRailFeed = React.memo(function RecyclingHourRailFeed({ foods, engine, ref,
  onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, ...actions }: FeedActions & {
  foods: LoggedFoodItem[];
  ref?: React.Ref<HourRailFeedHandle>;
  engine: RecyclingListEngine;
  onScrollBeginDrag?: () => void;
  onScrollEndDrag?: () => void;
  onMomentumScrollBegin?: () => void;
  onMomentumScrollEnd?: () => void;
}) {
  const list = useRef<{ scrollToOffset: (options: { offset: number; animated: boolean }) => unknown } | null>(null);
  const attach = useCallback((value: typeof list.current) => { list.current = value; }, []);
  useImperativeHandle(ref, () => ({ resetScroll: () => { list.current?.scrollToOffset({ offset: 0, animated: false }); } }), []);
  const rows = useMemo(() => buildHourRailRows(foods), [foods]);
  const renderItem = useCallback(({ item, index }: { item: HourRailRow; index: number }) =>
    <RailRow row={item} isLast={index === rows.length - 1} {...actions} />,
  [rows.length, actions.onSelectFood, actions.onAddAtHour, actions.isSelectionMode,
    actions.selectedFoodIds, actions.onLongPressFood, actions.onLongPressGroup,
    actions.onToggleSelectFood, actions.onToggleSelectGroup]);
  const props = { ref: attach, data: rows, renderItem, keyExtractor, getItemType,
    drawDistance: 250, contentContainerStyle: { paddingBottom: 120 },
    onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd,
    showsVerticalScrollIndicator: false };
  return engine === 'flash'
    ? <FlashList {...props} maintainVisibleContentPosition={{ disabled: true }} />
    : <LegendList {...props} recycleItems maintainVisibleContentPosition={false} />;
});
