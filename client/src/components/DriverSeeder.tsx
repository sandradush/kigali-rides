import { useState, useRef } from 'react';
import { updateDriverLocation } from '../api';
import { Driver } from '../types';

interface Props {
  onDriversSeeded: (drivers: Driver[]) => void;
  onDriversUpdated: (drivers: Driver[]) => void;
}

const KIGALI = { latMin: -2.0, latMax: -1.85, lngMin: 29.95, lngMax: 30.15 };
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function moveDriver(d: Driver): Driver {
  const headingRad = (d.heading * Math.PI) / 180;
  const distMeters = d.speed * 3; // 3 second tick
  const dLat = (distMeters / 111320) * Math.cos(headingRad);
  const dLng = (distMeters / (111320 * Math.cos(d.lat * Math.PI / 180))) * Math.sin(headingRad);
  let lat = d.lat + dLat;
  let lng = d.lng + dLng;
  let heading = d.heading;
  // Bounce off bounding box
  if (lat < KIGALI.latMin || lat > KIGALI.latMax) { heading = (360 - heading) % 360; lat = Math.max(KIGALI.latMin, Math.min(KIGALI.latMax, lat)); }
  if (lng < KIGALI.lngMin || lng > KIGALI.lngMax) { heading = (180 - heading + 360) % 360; lng = Math.max(KIGALI.lngMin, Math.min(KIGALI.lngMax, lng)); }
  return { ...d, lat, lng, heading };
}

export default function DriverSeeder({ onDriversSeeded, onDriversUpdated }: Props) {
  const [count, setCount] = useState(10);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [live, setLive] = useState(false);
  const driversRef = useRef<Driver[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function seed() {
    setSeeding(true);
    const drivers: Driver[] = Array.from({ length: count }, (_, i) => ({
      driverId: `driver-${i + 1}`,
      lat: rand(KIGALI.latMin, KIGALI.latMax),
      lng: rand(KIGALI.lngMin, KIGALI.lngMax),
      heading: Math.round(rand(0, 360)),
      speed: parseFloat(rand(3, 15).toFixed(1)),
      available: true,
    }));
    await Promise.all(
      drivers.map(d => updateDriverLocation(d.driverId, d.lat, d.lng, d.heading, d.speed, true))
    );
    driversRef.current = drivers;
    onDriversSeeded(drivers);
    setSeeded(true);
    setSeeding(false);
  }

  function toggleLive() {
    if (live) {
      if (timerRef.current) clearInterval(timerRef.current);
      setLive(false);
    } else {
      setLive(true);
      timerRef.current = setInterval(() => {
        driversRef.current = driversRef.current.map(moveDriver);
        driversRef.current.forEach(d =>
          updateDriverLocation(d.driverId, d.lat, d.lng, d.heading, d.speed, d.available)
        );
        onDriversUpdated([...driversRef.current]);
      }, 3000);
    }
  }

  return (
    <div className="card">
      <h3>Seed Drivers</h3>
      <div className="row">
        <label>Count</label>
        <input
          type="number" min={1} max={50} value={count}
          onChange={e => setCount(Number(e.target.value))}
          className="input-small"
        />
        <button className="btn btn-secondary" onClick={seed} disabled={seeding}>
          {seeding ? 'Seeding…' : seeded ? '↺ Re-seed' : 'Seed Drivers'}
        </button>
      </div>
      {seeded && (
        <button
          className={`btn ${live ? 'btn-danger' : 'btn-primary'}`}
          onClick={toggleLive}
        >
          {live ? '⏹ Stop Live Updates' : '▶ Start Live Updates'}
        </button>
      )}
      {seeded && <p className="hint">{live ? `🔴 Live — drivers moving every 3s` : `✅ ${count} drivers on map`}</p>}
    </div>
  );
}
