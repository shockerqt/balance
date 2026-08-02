import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SummaryScreen() {
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

        {/* Cal AI Style Gauge Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.cardLabel}>CALORÍAS RESTANTES</Text>
              <View style={styles.calRow}>
                <Text style={styles.calMain}>360</Text>
                <Text style={styles.calTarget}>/ 2,200 kcal</Text>
              </View>
            </View>
            <View style={styles.gaugeBox}>
              <Text style={styles.gaugePercent}>83.6%</Text>
            </View>
          </View>

          {/* Calorie Progress Bar */}
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: '83.6%' }]} />
          </View>

          {/* 4 Macros Grid */}
          <View style={styles.macrosGrid}>
            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>PROTEÍNA</Text>
              <Text style={styles.macroVal}>128g</Text>
              <View style={styles.miniBarBg}>
                <View style={[styles.miniBarFill, { width: '85%', backgroundColor: '#6366F1' }]} />
              </View>
            </View>

            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>CARBS</Text>
              <Text style={styles.macroVal}>190g</Text>
              <View style={styles.miniBarBg}>
                <View style={[styles.miniBarFill, { width: '86%', backgroundColor: '#10B981' }]} />
              </View>
            </View>

            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>GRASAS</Text>
              <Text style={styles.macroVal}>52g</Text>
              <View style={styles.miniBarBg}>
                <View style={[styles.miniBarFill, { width: '80%', backgroundColor: '#F59E0B' }]} />
              </View>
            </View>

            <View style={styles.macroBox}>
              <Text style={styles.macroLabel}>FIBRA</Text>
              <Text style={styles.macroVal}>26g</Text>
              <View style={styles.miniBarBg}>
                <View style={[styles.miniBarFill, { width: '86%', backgroundColor: '#06B6D4' }]} />
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
                <View
                  style={[
                    styles.dayBar,
                    { height: `${[60, 85, 70, 90, 65, 80, 83][idx]}%` },
                    idx === 3 ? styles.activeDayBar : null,
                  ]}
                />
                <Text style={[styles.dayText, idx === 3 ? styles.activeDayText : null]}>{day}</Text>
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
    padding: 16,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  avatarText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  greetingText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  brandTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  streakBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
  },
  streakText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: 'bold',
  },
  heroCard: {
    backgroundColor: '#111726',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 12,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  cardLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  calRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  calMain: {
    color: '#FFF',
    fontSize: 32,
    fontWeight: 'bold',
  },
  calTarget: {
    color: '#94A3B8',
    fontSize: 13,
  },
  gaugeBox: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  gaugePercent: {
    color: '#818CF8',
    fontWeight: 'bold',
    fontSize: 12,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#1E293B',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 999,
  },
  macrosGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 4,
  },
  macroBox: {
    flex: 1,
    backgroundColor: '#090C15',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  macroLabel: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: 'bold',
  },
  macroVal: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
    marginVertical: 2,
  },
  miniBarBg: {
    height: 4,
    backgroundColor: '#1E293B',
    borderRadius: 999,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  primaryScanBtn: {
    backgroundColor: '#FFFFFF',
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  statsCard: {
    backgroundColor: '#111726',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 12,
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsTitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  statsValue: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: 'bold',
  },
  weeklyBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 70,
    paddingTop: 10,
  },
  dayCol: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  dayBar: {
    width: 14,
    backgroundColor: '#1E293B',
    borderRadius: 4,
  },
  activeDayBar: {
    backgroundColor: '#6366F1',
  },
  dayText: {
    color: '#94A3B8',
    fontSize: 10,
  },
  activeDayText: {
    color: '#818CF8',
    fontWeight: 'bold',
  },
});
