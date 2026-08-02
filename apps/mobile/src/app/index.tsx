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

export default function SummaryScreen() {
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>FJ</Text>
            </View>
            <View>
              <Text style={styles.greetingText}>Hola, Francisco 👋</Text>
              <Text style={styles.brandTitle}>Balance Tracker</Text>
            </View>
          </View>
          <View style={styles.streakBadge}>
            <Text style={styles.streakText}>🔥 5 Días</Text>
          </View>
        </View>

        {/* Hero Gauge Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.cardLabel}>CALORÍAS RESTANTES</Text>
              <View style={styles.calRow}>
                <Text style={styles.calMain}>{calRemaining}</Text>
                <Text style={styles.calTarget}>/ {currentDayLog.targetCalories} kcal</Text>
              </View>
            </View>
            <View style={styles.gaugeBox}>
              <Text style={styles.gaugePercent}>{calPercent}%</Text>
            </View>
          </View>

          {/* Calorie Progress Bar */}
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${calPercent}%` }]} />
          </View>

          {/* 4 Macros Grid */}
          <View style={styles.macrosGrid}>
            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>PROTEÍNA</Text>
              <Text style={styles.macroVal}>{totalP}g</Text>
              <View style={styles.miniBarBg}>
                <View style={[styles.miniBarFill, { width: `${pPercent}%`, backgroundColor: '#6366F1' }]} />
              </View>
            </View>

            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>CARBS</Text>
              <Text style={styles.macroVal}>{totalC}g</Text>
              <View style={styles.miniBarBg}>
                <View style={[styles.miniBarFill, { width: `${cPercent}%`, backgroundColor: '#10B981' }]} />
              </View>
            </View>

            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>GRASAS</Text>
              <Text style={styles.macroVal}>{totalF}g</Text>
              <View style={styles.miniBarBg}>
                <View style={[styles.miniBarFill, { width: `${fPercent}%`, backgroundColor: '#F59E0B' }]} />
              </View>
            </View>

            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>FIBRA</Text>
              <Text style={styles.macroVal}>{totalFib}g</Text>
              <View style={styles.miniBarBg}>
                <View style={[styles.miniBarFill, { width: `${fibPercent}%`, backgroundColor: '#06B6D4' }]} />
              </View>
            </View>
          </View>
        </View>

        {/* Primary AI Scan Button */}
        <TouchableOpacity style={styles.primaryScanBtn} activeOpacity={0.8}>
          <Text style={styles.primaryBtnText}>📷 Escanear Comida con IA</Text>
        </TouchableOpacity>

        {/* Weekly Stats Widget */}
        <View style={styles.statsCard}>
          <View style={styles.statsHeader}>
            <Text style={styles.statsTitle}>Promedio de los últimos 7 días</Text>
            <Text style={styles.statsValue}>2,010 kcal/día</Text>
          </View>
          <View style={styles.weeklyBarRow}>
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, idx) => (
              <View key={idx} style={styles.dayCol}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${60 + (idx % 3) * 15}%` }]} />
                </View>
                <Text style={styles.dayLabel}>{day}</Text>
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
    backgroundColor: '#090C15',
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
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  avatarText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 16,
  },
  greetingText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  brandTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  streakBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  streakText: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '600',
  },
  heroCard: {
    backgroundColor: '#111726',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 20,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  cardLabel: {
    color: '#94A3B8',
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
    color: '#F8FAFC',
    fontSize: 32,
    fontWeight: '800',
  },
  calTarget: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  gaugeBox: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  gaugePercent: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 13,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#1E293B',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 20,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 4,
  },
  macrosGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  macroBox: {
    flex: 1,
    backgroundColor: '#161E2E',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  macroLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  macroVal: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  miniBarBg: {
    height: 4,
    backgroundColor: '#1E293B',
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  primaryScanBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  statsCard: {
    backgroundColor: '#111726',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statsTitle: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
  },
  statsValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
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
    backgroundColor: '#1E293B',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 4,
  },
  dayLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
});
