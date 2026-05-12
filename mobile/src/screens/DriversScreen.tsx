import { View, Text, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useState } from 'react';
import { updateDriverLocation } from '../api';
import { Driver } from '../types';

const KIGALI = { latMin: -2.0, latMax: -1.85, lngMin: 29.95, lngMax: 30.15 };
const rand = (min: number, max: number) => min + Math.random() * (max - min);

interface Props { onDriversSeeded: (drivers: Driver[]) => void; seededCount: number; }

export default function DriversScreen({ onDriversSeeded, seededCount }: Props) {
  const [count, setCount] = useState('10');
  const [seeding, setSeeding] = useState(false);

  async function seed() {
    const n = parseInt(count, 10);
    if (isNaN(n) || n < 1 || n > 100) { Alert.alert('Enter a number between 1 and 100'); return; }
    setSeeding(true);
    try {
      const drivers: Driver[] = Array.from({ length: n }, (_, i) => ({
        driverId: `driver-${i + 1}`,
        lat: rand(KIGALI.latMin, KIGALI.latMax),
        lng: rand(KIGALI.lngMin, KIGALI.lngMax),
        heading: Math.round(rand(0, 360)),
        speed: parseFloat(rand(0, 15).toFixed(1)),
        available: true,
      }));
      await Promise.all(
        drivers.map(d => updateDriverLocation(d.driverId, d.lat, d.lng, d.heading, d.speed, true))
      );
      onDriversSeeded(drivers);
    } catch {
      Alert.alert('Error', 'Could not reach backend. Check your IP in api.ts.');
    } finally {
      setSeeding(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Seed Drivers</Text>
      <Text style={styles.subtitle}>
        Places random drivers across Kigali and registers them with the backend.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Number of drivers</Text>
        <TextInput
          style={styles.input}
          value={count}
          onChangeText={setCount}
          keyboardType="number-pad"
          maxLength={3}
        />
        <TouchableOpacity
          style={[styles.btn, seeding && styles.btnDisabled]}
          onPress={seed}
          disabled={seeding}
        >
          {seeding
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>{seededCount > 0 ? `↺ Re-seed (${seededCount} active)` : 'Seed Drivers'}</Text>
          }
        </TouchableOpacity>
      </View>

      {seededCount > 0 && (
        <View style={styles.successCard}>
          <Text style={styles.successText}>✅ {seededCount} drivers active on the map</Text>
          <Text style={styles.hint}>Switch to the Map tab to request a ride.</Text>
        </View>
      )}

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>How it works</Text>
        <Text style={styles.infoText}>1. Seed drivers here</Text>
        <Text style={styles.infoText}>2. Go to Map tab</Text>
        <Text style={styles.infoText}>3. Tap 📍 Pickup then tap the map</Text>
        <Text style={styles.infoText}>4. Tap 🏁 Dropoff then tap the map</Text>
        <Text style={styles.infoText}>5. Tap Find Drivers</Text>
        <Text style={styles.infoText}>6. Select a candidate → Propose Match</Text>
        <Text style={styles.infoText}>7. Confirm or Reject</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  content: { padding: 16, gap: 14 },
  title: { fontSize: 22, fontWeight: '800', color: '#1a1a2e' },
  subtitle: { fontSize: 14, color: '#6b7280', lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, fontSize: 16, color: '#1a1a2e' },
  btn: { backgroundColor: '#4f46e5', borderRadius: 8, padding: 14, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  successCard: { backgroundColor: '#f0fdf4', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#86efac', gap: 4 },
  successText: { color: '#16a34a', fontWeight: '700', fontSize: 14 },
  hint: { color: '#6b7280', fontSize: 13 },
  infoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 6, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: '#1a1a2e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoText: { fontSize: 13, color: '#374151', lineHeight: 22 },
});
