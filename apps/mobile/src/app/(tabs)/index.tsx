import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMealStore } from '@/hooks/use-meal-store';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from 'expo-router';

export default function SummaryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { currentDayLog } = useMealStore();

  const totalCal = currentDayLog.foods.reduce((sum, f) => sum + (f.calories || 0), 0);
  const totalP = currentDayLog.foods.reduce((sum, f) => sum + (f.protein || 0), 0);
  const totalC = currentDayLog.foods.reduce((sum, f) => sum + (f.carbs || 0), 0);
  const totalF = currentDayLog.foods.reduce((sum, f) => sum + (f.fat || 0), 0);
  const totalFib = currentDayLog.foods.reduce((sum, f) => sum + (f.fiber || 0), 0);

  const calRemaining = Math.max(0, currentDayLog.targetCalories - totalCal);
  const calPercent = Math.min(
    Math.round((totalCal / currentDayLog.targetCalories) * 100),
    100
  );

  const pPercent = Math.min(Math.round((totalP / currentDayLog.targetProtein) * 100), 100);
  const cPercent = Math.min(Math.round((totalC / currentDayLog.targetCarbs) * 100), 100);
  const fPercent = Math.min(Math.round((totalF / currentDayLog.targetFat) * 100), 100);
  const fibPercent = Math.min(Math.round((totalFib / currentDayLog.targetFiber) * 100), 100);

  const handleOpenAddModal = () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${hours}:${minutes}`;

    router.push({
      pathname: '/food-search',
      params: { dateId: currentDayLog.dateId, time: currentTimeStr },
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.userRow}>
            <View style={[styles.avatar, { backgroundColor: theme.surface, borderColor: theme.surfaceBorder }]}>
              <Text style={[styles.avatarText, { color: theme.textPrimary }]}>FJ</Text>
            </View>
            <View>
              <Text style={[styles.greetingText, { color: theme.textSecondary }]}>Hola, Francisco 👋</Text>
              <Text style={[styles.brandTitle, { color: theme.textPrimary }]}>Resumen Diario</Text>
            </View>
          </View>
          <View style={[styles.streakBadge, { backgroundColor: theme.surface, borderColor: theme.surfaceBorder }]}>
            <Text style={[styles.streakText, { color: theme.kcalCoral }]}>🔥 5 Días</Text>
          </View>
        </View>

        {/* Hero Calorie Gauge Card */}
        <View style={[styles.heroCard, { backgroundColor: theme.surface, borderColor: theme.surfaceBorder }]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={[styles.cardLabel, { color: theme.textMuted }]}>CALORÍAS RESTANTES</Text>
              <View style={styles.calRow}>
                <Text style={[styles.calMain, { color: theme.textPrimary }]}>{calRemaining}</Text>
                <Text style={[styles.calTarget, { color: theme.textSecondary }]}>/ {currentDayLog.targetCalories} kcal</Text>
              </View>
            </View>
            <View style={[styles.gaugeBox, { backgroundColor: theme.cardBackground }]}>
              <Text style={[styles.gaugePercent, { color: theme.primary }]}>{calPercent}%</Text>
            </View>
          </View>

          {/* Calorie Progress Bar */}
          <View style={[styles.progressBarBg, { backgroundColor: theme.surfaceBorder }]}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${calPercent}%`, backgroundColor: theme.primary },
                totalCal > currentDayLog.targetCalories && { backgroundColor: theme.kcalCoral },
              ]}
            />
          </View>

          {/* 4 Macros Grid */}
          <View style={styles.macrosGrid}>
            <View style={[styles.macroBox, { backgroundColor: theme.cardBackground, borderColor: theme.surfaceBorder }]}>
              <Text style={[styles.macroLabel, { color: theme.textMuted }]}>PROTEÍNA</Text>
              <Text style={[styles.macroVal, { color: theme.textPrimary }]}>{totalP}g</Text>
              <View style={[styles.miniBarBg, { backgroundColor: theme.surfaceBorder }]}>
                <View style={[styles.miniBarFill, { width: `${pPercent}%`, backgroundColor: theme.primary }]} />
              </View>
            </View>

            <View style={[styles.macroBox, { backgroundColor: theme.cardBackground, borderColor: theme.surfaceBorder }]}>
              <Text style={[styles.macroLabel, { color: theme.textMuted }]}>CARBS</Text>
              <Text style={[styles.macroVal, { color: theme.textPrimary }]}>{totalC}g</Text>
              <View style={[styles.miniBarBg, { backgroundColor: theme.surfaceBorder }]}>
                <View style={[styles.miniBarFill, { width: `${cPercent}%`, backgroundColor: '#10B981' }]} />
              </View>
            </View>

            <View style={[styles.macroBox, { backgroundColor: theme.cardBackground, borderColor: theme.surfaceBorder }]}>
              <Text style={[styles.macroLabel, { color: theme.textMuted }]}>GRASAS</Text>
              <Text style={[styles.macroVal, { color: theme.textPrimary }]}>{totalF}g</Text>
              <View style={[styles.miniBarBg, { backgroundColor: theme.surfaceBorder }]}>
                <View style={[styles.miniBarFill, { width: `${fPercent}%`, backgroundColor: theme.kcalCoral }]} />
              </View>
            </View>

            <View style={[styles.macroBox, { backgroundColor: theme.cardBackground, borderColor: theme.surfaceBorder }]}>
              <Text style={[styles.macroLabel, { color: theme.textMuted }]}>FIBRA</Text>
              <Text style={[styles.macroVal, { color: theme.textPrimary }]}>{totalFib}g</Text>
              <View style={[styles.miniBarBg, { backgroundColor: theme.surfaceBorder }]}>
                <View style={[styles.miniBarFill, { width: `${fibPercent}%`, backgroundColor: '#06B6D4' }]} />
              </View>
            </View>
          </View>
        </View>

        {/* Primary Quick Add Button */}
        <TouchableOpacity
          style={[styles.primaryAddBtn, { backgroundColor: theme.primary }]}
          activeOpacity={0.8}
          delayPressIn={0}
          onPress={handleOpenAddModal}>
          <Text style={[styles.primaryBtnText, { color: theme.primaryText }]}>+ Registrar Comida</Text>
        </TouchableOpacity>

        {/* Weekly Stats Widget */}
        <View style={[styles.statsCard, { backgroundColor: theme.surface, borderColor: theme.surfaceBorder }]}>
          <View style={styles.statsHeader}>
            <Text style={[styles.statsTitle, { color: theme.textSecondary }]}>Promedio últimos 7 días</Text>
            <Text style={[styles.statsValue, { color: theme.textPrimary }]}>2,010 kcal/día</Text>
          </View>
          <View style={styles.weeklyBarRow}>
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, idx) => (
              <View key={idx} style={styles.dayCol}>
                <View style={[styles.barTrack, { backgroundColor: theme.surfaceBorder }]}>
                  <View style={[styles.barFill, { height: `${60 + (idx % 3) * 15}%`, backgroundColor: theme.primary }]} />
                </View>
                <Text style={[styles.dayLabel, { color: theme.textMuted }]}>{day}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatarText: {
    fontWeight: '700',
    fontSize: 16,
  },
  greetingText: {
    fontSize: 13,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  streakBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  streakText: {
    fontSize: 13,
    fontWeight: '600',
  },
  heroCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    marginBottom: 20,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  calRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  calMain: {
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  calTarget: {
    fontSize: 14,
    fontWeight: '500',
  },
  gaugeBox: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  gaugePercent: {
    fontWeight: '700',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  macrosGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  macroBox: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  macroLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  macroVal: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
    fontVariant: ['tabular-nums'],
  },
  miniBarBg: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  primaryAddBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  statsCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statsTitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  statsValue: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  weeklyBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 80,
  },
  dayCol: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  barTrack: {
    width: 8,
    height: 60,
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 4,
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
});
