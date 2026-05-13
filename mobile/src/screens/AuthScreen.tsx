import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { login, register, setToken } from '../api';

interface Props {
  onAuth: (user: { userId: string; role: string; name: string }) => void;
}

export default function AuthScreen({ onAuth }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'driver' | 'passenger'>('passenger');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!email.trim() || !password.trim() || (mode === 'register' && !name.trim())) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = mode === 'login'
        ? await login(email.trim(), password)
        : await register(email.trim(), password, role, name.trim());
      setToken(res.token);
      onAuth({ userId: res.userId, role: res.role, name: res.name });
    } catch (e: any) {
      setError(
        e.message === 'invalid_credentials' ? 'Invalid email or password.' :
        e.message === 'email_already_registered' ? 'Email already registered.' :
        'Connection error. Is the backend running?'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="always">
        <Text style={styles.title}>🚕 Kigali Rides</Text>
        <Text style={styles.subtitle}>Real-time ride coordination</Text>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === 'login' && styles.tabActive]}
            onPress={() => { setMode('login'); setError(null); }}
          >
            <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === 'register' && styles.tabActive]}
            onPress={() => { setMode('register'); setError(null); }}
          >
            <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>Register</Text>
          </TouchableOpacity>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {mode === 'register' && (
            <View>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Jean Pierre"
                placeholderTextColor="#9ca3af"
                returnKeyType="next"
              />
              <Text style={styles.label}>Role</Text>
              <View style={styles.roleRow}>
                <TouchableOpacity
                  style={[styles.roleBtn, role === 'passenger' && styles.roleBtnActive]}
                  onPress={() => setRole('passenger')}
                >
                  <Text style={[styles.roleBtnText, role === 'passenger' && styles.roleBtnTextActive]}>
                    👤 Passenger
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleBtn, role === 'driver' && styles.roleBtnActive]}
                  onPress={() => setRole('driver')}
                >
                  <Text style={[styles.roleBtnText, role === 'driver' && styles.roleBtnTextActive]}>
                    🚗 Driver
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#9ca3af"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.pwRow}>
            <TextInput
              style={styles.pwInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Min 6 characters"
              placeholderTextColor="#9ca3af"
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)}>
              <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.submitBtnText}>{mode === 'login' ? 'Login' : 'Create Account'}</Text>
            }
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
          style={styles.switchBtn}
        >
          <Text style={styles.switchText}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <Text style={styles.switchLink}>{mode === 'login' ? 'Register' : 'Login'}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1a1a2e' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 30, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#a5b4fc', textAlign: 'center', marginBottom: 28 },
  tabs: { flexDirection: 'row', borderRadius: 10, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: '#3d3d6e' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: '#2d2d4e' },
  tabActive: { backgroundColor: '#4f46e5' },
  tabText: { fontWeight: '600', color: '#9ca3af', fontSize: 15 },
  tabTextActive: { color: '#fff' },
  form: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#111827', marginBottom: 14,
    backgroundColor: '#fff',
  },
  roleRow: { flexDirection: 'row', marginBottom: 14 },
  roleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8,
    borderWidth: 2, borderColor: '#e5e7eb', alignItems: 'center', marginRight: 8,
  },
  roleBtnActive: { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  roleBtnText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  roleBtnTextActive: { color: '#4f46e5' },
  pwRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8,
    marginBottom: 14, backgroundColor: '#fff',
  },
  pwInput: {
    flex: 1, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#111827',
  },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  eyeText: { fontSize: 18 },
  errorBox: {
    backgroundColor: '#fef2f2', borderRadius: 8,
    padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: '#fca5a5',
  },
  errorText: { color: '#dc2626', fontSize: 13 },
  submitBtn: {
    backgroundColor: '#4f46e5', borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  switchBtn: { alignItems: 'center', paddingVertical: 8 },
  switchText: { color: '#9ca3af', fontSize: 14, textAlign: 'center' },
  switchLink: { color: '#a5b4fc', fontWeight: '700' },
});
