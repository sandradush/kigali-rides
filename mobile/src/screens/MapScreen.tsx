import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import { requestRide, proposeMatch, confirmMatch, rejectMatch, checkHealth } from '../api';
import { Driver, Candidate, MatchResponse } from '../types';

const KIGALI = { lat: -1.9441, lng: 30.0619 };

type ClickMode = 'pickup' | 'dropoff' | null;
interface Props { drivers: Driver[]; }

function buildMapHtml(
  drivers: Driver[],
  candidates: Candidate[],
  pickup: { lat: number; lng: number } | null,
  dropoff: { lat: number; lng: number } | null,
  selectedDriverId: string | null
): string {
  const candidateIds = new Set(candidates.map(c => c.driverId));

  const driverMarkers = drivers
    .filter(d => !candidateIds.has(d.driverId))
    .map(d => `L.marker([${d.lat},${d.lng}],{title:'${d.driverId}'})
      .addTo(map).bindPopup('<b>${d.driverId}</b><br>Speed:${d.speed}m/s');`)
    .join('\n');

  const candidateMarkers = candidates.map(c => {
    const color = selectedDriverId === c.driverId ? 'green' : 'orange';
    return `L.circleMarker([${c.currentLocation.lat},${c.currentLocation.lng}],
      {radius:10,color:'${color}',fillColor:'${color}',fillOpacity:0.9})
      .addTo(map)
      .bindPopup('<b>${c.driverId}</b><br>Score:${c.score.toFixed(2)}<br>${c.explanation}')
      .on('click',()=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'selectDriver',driverId:'${c.driverId}'})));`;
  }).join('\n');

  const pickupMarker = pickup
    ? `L.marker([${pickup.lat},${pickup.lng}],{icon:greenIcon}).addTo(map).bindPopup('Pickup');` : '';
  const dropoffMarker = dropoff
    ? `L.marker([${dropoff.lat},${dropoff.lng}],{icon:redIcon}).addTo(map).bindPopup('Dropoff');` : '';

  return `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>html,body,#map{margin:0;padding:0;height:100%;width:100%;}</style>
  </head><body>
    <div id="map"></div>
    <script>
      var map = L.map('map').setView([${KIGALI.lat},${KIGALI.lng}],14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

      var greenIcon = L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41]});
      var redIcon = L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41]});

      ${driverMarkers}
      ${candidateMarkers}
      ${pickupMarker}
      ${dropoffMarker}

      map.on('click', function(e){
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapClick',lat:e.latlng.lat,lng:e.latlng.lng}));
      });
    </script>
  </body></html>`;
}

export default function MapScreen({ drivers }: Props) {
  const [pickup, setPickup] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoff, setDropoff] = useState<{ lat: number; lng: number } | null>(null);
  const [clickMode, setClickMode] = useState<ClickMode>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [matchStatus, setMatchStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ status: string; drivers: number } | null>(null);
  const clickModeRef = useRef<ClickMode>(null);

  useEffect(() => {
    checkHealth().then(setHealth).catch(() => setHealth(null));
    const t = setInterval(() => checkHealth().then(setHealth).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  // keep ref in sync so WebView message handler always has latest value
  useEffect(() => { clickModeRef.current = clickMode; }, [clickMode]);

  function handleWebViewMessage(event: any) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'mapClick') {
        const mode = clickModeRef.current;
        if (mode === 'pickup') { setPickup({ lat: msg.lat, lng: msg.lng }); setClickMode('dropoff'); }
        else if (mode === 'dropoff') { setDropoff({ lat: msg.lat, lng: msg.lng }); setClickMode(null); }
      } else if (msg.type === 'selectDriver') {
        setSelectedDriverId(msg.driverId);
      }
    } catch {}
  }

  async function handleFindDrivers() {
    if (!pickup || !dropoff) return;
    setLoading(true); setError(null); setCandidates([]);
    setMatch(null); setMatchStatus(null); setSelectedDriverId(null);
    try {
      const res = await requestRide('passenger-1', pickup, dropoff);
      setRequestId(res.requestId);
      setCandidates(res.candidates);
      if (res.candidates.length === 0) setError('No drivers nearby. Seed drivers first.');
    } catch { setError('Cannot reach backend. Check your IP in api.ts.'); }
    finally { setLoading(false); }
  }

  async function handlePropose() {
    if (!requestId || !selectedDriverId) return;
    setLoading(true); setError(null);
    try { const m = await proposeMatch(requestId, selectedDriverId); setMatch(m); setMatchStatus('pending'); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleConfirm() {
    if (!match) return;
    setLoading(true);
    try { await confirmMatch(match.matchId, match.driverId); setMatchStatus('confirmed'); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleReject() {
    if (!match) return;
    setLoading(true);
    try { await rejectMatch(match.matchId, match.driverId); setMatchStatus('rejected'); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  function reset() {
    setPickup(null); setDropoff(null); setCandidates([]);
    setRequestId(null); setSelectedDriverId(null);
    setMatch(null); setMatchStatus(null); setError(null); setClickMode(null);
  }

  const mapHtml = buildMapHtml(drivers, candidates, pickup, dropoff, selectedDriverId);

  return (
    <View style={styles.container}>
      <View style={styles.healthBar}>
        <View style={[styles.dot, { backgroundColor: health ? '#4ade80' : '#f87171' }]} />
        <Text style={styles.healthText}>
          {health ? `Backend online · ${health.drivers} drivers` : 'Backend offline'}
        </Text>
      </View>

      <WebView
        style={styles.map}
        source={{ html: mapHtml }}
        onMessage={handleWebViewMessage}
        javaScriptEnabled
        originWhitelist={['*']}
      />

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">

        {clickMode && (
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              {clickMode === 'pickup' ? '🟢 Tap map to set pickup' : '🔴 Tap map to set dropoff'}
            </Text>
          </View>
        )}

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, clickMode === 'pickup' ? styles.btnActive : styles.btnSecondary]}
            onPress={() => setClickMode('pickup')}
          >
            <Text style={clickMode === 'pickup' ? styles.btnTextWhite : styles.btnText}>📍 Pickup</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, clickMode === 'dropoff' ? styles.btnActive : styles.btnSecondary]}
            onPress={() => setClickMode('dropoff')}
          >
            <Text style={clickMode === 'dropoff' ? styles.btnTextWhite : styles.btnText}>🏁 Dropoff</Text>
          </TouchableOpacity>
        </View>

        {pickup && dropoff && (
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
            onPress={handleFindDrivers} disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTextWhite}>Find Drivers</Text>}
          </TouchableOpacity>
        )}

        {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

        {candidates.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TOP CANDIDATES</Text>
            {candidates.map((c, i) => (
              <TouchableOpacity
                key={c.driverId}
                style={[styles.candidateItem, selectedDriverId === c.driverId && styles.candidateSelected]}
                onPress={() => setSelectedDriverId(c.driverId)}
              >
                <Text style={styles.candidateRank}>#{i + 1}</Text>
                <View style={styles.candidateInfo}>
                  <Text style={styles.candidateName}>{c.driverId}</Text>
                  <Text style={styles.candidateExpl}>{c.explanation}</Text>
                </View>
                <View style={styles.scoreBadge}>
                  <Text style={styles.scoreText}>{c.score.toFixed(2)}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {selectedDriverId && !match && (
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
                onPress={handlePropose} disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTextWhite}>Propose Match → {selectedDriverId}</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}

        {match && (
          <View style={styles.matchPanel}>
            <Text style={styles.sectionTitle}>MATCH PROPOSED</Text>
            <Text style={styles.matchDetail}>Driver: <Text style={styles.bold}>{match.driverId}</Text></Text>
            <Text style={styles.matchDetail}>
              Status: <Text style={[styles.bold,
                matchStatus === 'confirmed' ? styles.green :
                matchStatus === 'rejected' ? styles.red : styles.orange]}>
                {matchStatus ?? match.status}
              </Text>
            </Text>
            <Text style={styles.matchDetail}>
              Expires in: {Math.max(0, Math.round((match.expiresAt - Date.now()) / 1000))}s
            </Text>
            {(matchStatus ?? match.status) === 'pending' && (
              <View style={styles.row}>
                <TouchableOpacity style={[styles.btn, styles.btnSuccess]} onPress={handleConfirm} disabled={loading}>
                  <Text style={styles.btnTextWhite}>✓ Confirm</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={handleReject} disabled={loading}>
                  <Text style={styles.btnTextWhite}>✗ Reject</Text>
                </TouchableOpacity>
              </View>
            )}
            {matchStatus === 'confirmed' && <Text style={[styles.statusMsg, styles.green]}>✅ Ride confirmed!</Text>}
            {matchStatus === 'rejected' && <Text style={[styles.statusMsg, styles.orange]}>❌ Rejected. Driver freed.</Text>}
          </View>
        )}

        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={reset}>
          <Text style={styles.btnTextGhost}>Reset</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  healthBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', padding: 8, paddingHorizontal: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  healthText: { color: '#fff', fontSize: 12 },
  map: { height: 280 },
  panel: { flex: 1 },
  panelContent: { padding: 12 },
  hintBox: { backgroundColor: '#eef2ff', borderRadius: 8, padding: 10, marginBottom: 10 },
  hintText: { color: '#4f46e5', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  row: { flexDirection: 'row', marginBottom: 10 },
  btn: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  btnPrimary: { backgroundColor: '#4f46e5' },
  btnSecondary: { backgroundColor: '#e5e7eb' },
  btnActive: { backgroundColor: '#4f46e5' },
  btnSuccess: { backgroundColor: '#16a34a' },
  btnDanger: { backgroundColor: '#dc2626' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#d1d5db', marginTop: 8 },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  btnTextWhite: { fontSize: 13, fontWeight: '600', color: '#fff' },
  btnTextGhost: { fontSize: 13, color: '#6b7280' },
  errorBox: { backgroundColor: '#fef2f2', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#fca5a5', marginBottom: 10 },
  errorText: { color: '#dc2626', fontSize: 13 },
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, elevation: 2 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#6b7280', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  candidateItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 8, borderWidth: 2, borderColor: '#e5e7eb', marginBottom: 6 },
  candidateSelected: { borderColor: '#4f46e5', backgroundColor: '#eef2ff' },
  candidateRank: { fontSize: 12, fontWeight: '700', color: '#6b7280', width: 20 },
  candidateInfo: { flex: 1, marginLeft: 8 },
  candidateName: { fontSize: 13, fontWeight: '700' },
  candidateExpl: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  scoreBadge: { backgroundColor: '#4f46e5', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  scoreText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  matchPanel: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: '#4f46e5', elevation: 2 },
  matchDetail: { fontSize: 13, color: '#374151', marginBottom: 4 },
  bold: { fontWeight: '700' },
  green: { color: '#16a34a' },
  red: { color: '#dc2626' },
  orange: { color: '#d97706' },
  statusMsg: { fontSize: 13, fontWeight: '600', marginTop: 6 },
});
