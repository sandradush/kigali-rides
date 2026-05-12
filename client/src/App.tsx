import { useState, useEffect, useCallback } from 'react';
import RideMap from './components/RideMap';
import CandidateList from './components/CandidateList';
import MatchPanel from './components/MatchPanel';
import DriverSeeder from './components/DriverSeeder';
import AuthPage from './components/AuthPage';
import { requestRide, proposeMatch, confirmMatch, rejectMatch, checkHealth, clearToken, getStoredUser } from './api';
import { Driver, Candidate, MatchResponse } from './types';
import './App.css';

type ClickMode = 'pickup' | 'dropoff' | null;

export default function App() {
  const [user, setUser] = useState<{ userId: string; role: string; name: string } | null>(getStoredUser());
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [pickup, setPickup] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoff, setDropoff] = useState<{ lat: number; lng: number } | null>(null);
  const [clickMode, setClickMode] = useState<ClickMode>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [matchStatus, setMatchStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ status: string; drivers: number } | null>(null);

  useEffect(() => {
    checkHealth().then(setHealth).catch(() => setHealth(null));
    const t = setInterval(() => checkHealth().then(setHealth).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (clickMode === 'pickup') { setPickup({ lat, lng }); setClickMode('dropoff'); }
    else if (clickMode === 'dropoff') { setDropoff({ lat, lng }); setClickMode(null); }
  }, [clickMode]);

  async function handleRequestRide() {
    if (!pickup || !dropoff) return;
    setLoading(true); setError(null); setCandidates([]);
    setMatch(null); setMatchStatus(null); setSelectedDriverId(null);
    try {
      const res = await requestRide(user?.userId ?? 'passenger-1', pickup, dropoff);
      setRequestId(res.requestId);
      setCandidates(res.candidates);
      if (res.candidates.length === 0) setError('No drivers available nearby. Try seeding more drivers.');
    } catch {
      setError('Failed to request ride. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  async function handlePropose() {
    if (!requestId || !selectedDriverId) return;
    setProposing(true); setError(null);
    try {
      const m = await proposeMatch(requestId, selectedDriverId);
      setMatch(m); setMatchStatus('pending');
    } catch (e: any) {
      setError(e.message === 'driver_already_assigned' ? 'Driver already assigned — pick another.' : e.message);
    } finally {
      setProposing(false);
    }
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

  function handleLogout() {
    clearToken();
    setUser(null);
    reset();
  }

  if (!user) return <AuthPage onAuth={setUser} />;

  return (
    <div className="app">
      <header className="header">
        <h1>🚕 Kigali Rides</h1>
        <div className="header-right">
          <span className="user-badge">
            {user.role === 'driver' ? '🚗' : '👤'} {user.name}
            <span className="role-tag">{user.role}</span>
          </span>
          <div className="health">
            {health
              ? <span className="health-ok">● Backend online · {health.drivers} drivers</span>
              : <span className="health-err">● Backend offline</span>}
          </div>
          <button className="btn btn-ghost" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <DriverSeeder onDriversSeeded={setDrivers} onDriversUpdated={setDrivers} />

          <div className="card">
            <h3>Request a Ride</h3>
            <p className="hint">
              {!clickMode && !pickup && 'Click "Set Pickup" then click the map'}
              {clickMode === 'pickup' && '🟢 Click map to set pickup location'}
              {clickMode === 'dropoff' && '🔴 Click map to set dropoff location'}
              {pickup && dropoff && !clickMode && '✅ Pickup & dropoff set'}
            </p>
            <div className="location-row">
              <button
                className={`btn ${clickMode === 'pickup' ? 'btn-active' : 'btn-secondary'}`}
                onClick={() => setClickMode('pickup')}
              >
                📍 Set Pickup
              </button>
              {pickup && <span className="coord">{pickup.lat.toFixed(4)}, {pickup.lng.toFixed(4)}</span>}
            </div>
            <div className="location-row">
              <button
                className={`btn ${clickMode === 'dropoff' ? 'btn-active' : 'btn-secondary'}`}
                onClick={() => setClickMode('dropoff')}
              >
                🏁 Set Dropoff
              </button>
              {dropoff && <span className="coord">{dropoff.lat.toFixed(4)}, {dropoff.lng.toFixed(4)}</span>}
            </div>
            <button
              className="btn btn-primary"
              onClick={handleRequestRide}
              disabled={!pickup || !dropoff || loading}
            >
              {loading ? 'Matching…' : 'Find Drivers'}
            </button>
            <button className="btn btn-ghost" onClick={reset}>Reset</button>
          </div>

          {error && <div className="error-box">{error}</div>}

          <CandidateList
            candidates={candidates}
            selectedDriverId={selectedDriverId}
            onSelect={setSelectedDriverId}
            onPropose={handlePropose}
            proposing={proposing}
          />

          {match && (
            <MatchPanel
              match={match}
              onConfirm={handleConfirm}
              onReject={handleReject}
              loading={loading}
              status={matchStatus}
            />
          )}
        </aside>

        <main className="map-container">
          <RideMap
            drivers={drivers}
            candidates={candidates}
            pickup={pickup}
            dropoff={dropoff}
            onMapClick={handleMapClick}
            onSelectCandidate={setSelectedDriverId}
            selectedDriverId={selectedDriverId}
          />
          <div className="map-legend">
            <span>🔵 Driver</span>
            <span>🟠 Candidate</span>
            <span>🟢 Pickup</span>
            <span>🔴 Dropoff</span>
            <span>〰️ En-route path</span>
          </div>
        </main>
      </div>
    </div>
  );
}
