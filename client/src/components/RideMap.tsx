import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Driver, Candidate } from '../types';

// Fix default marker icons broken by Vite bundling
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const pickupIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

const dropoffIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

const candidateIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

function projectPoint(lat: number, lng: number, headingDeg: number, distMeters: number) {
  const R = 6371000;
  const d = distMeters / R;
  const bearing = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

interface Props {
  drivers: Driver[];
  candidates: Candidate[];
  pickup: { lat: number; lng: number } | null;
  dropoff: { lat: number; lng: number } | null;
  onMapClick: (lat: number, lng: number) => void;
  onSelectCandidate: (driverId: string) => void;
  selectedDriverId: string | null;
}

function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function RideMap({
  drivers, candidates, pickup, dropoff,
  onMapClick, onSelectCandidate, selectedDriverId,
}: Props) {
  const candidateIds = new Set(candidates.map(c => c.driverId));
  const driverMap = new Map(drivers.map(d => [d.driverId, d]));

  // Build trajectory lines for en-route candidates
  const trajectories = candidates
    .filter(c => c.explanation.startsWith('En-route'))
    .map(c => {
      const d = driverMap.get(c.driverId);
      if (!d) return null;
      const projected = projectPoint(d.lat, d.lng, d.heading, d.speed * 60);
      return { driverId: c.driverId, from: [d.lat, d.lng] as [number, number], to: [projected.lat, projected.lng] as [number, number] };
    })
    .filter(Boolean) as { driverId: string; from: [number, number]; to: [number, number] }[];

  return (
    <MapContainer
      center={[-1.9441, 30.0619]}
      zoom={14}
      style={{ height: '100%', width: '100%', borderRadius: '8px' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onMapClick={onMapClick} />

      {drivers.filter(d => !candidateIds.has(d.driverId)).map(driver => (
        <Marker key={driver.driverId} position={[driver.lat, driver.lng]}>
          <Popup>
            <strong>{driver.driverId}</strong><br />
            Speed: {driver.speed.toFixed(1)} m/s | Heading: {driver.heading}°<br />
            {driver.available ? '✅ Available' : '🔴 Unavailable'}
          </Popup>
        </Marker>
      ))}

      {candidates.map(c => (
        <Marker
          key={c.driverId}
          position={[c.currentLocation.lat, c.currentLocation.lng]}
          icon={candidateIcon}
          eventHandlers={{ click: () => onSelectCandidate(c.driverId) }}
        >
          <Popup>
            <strong>{c.driverId}</strong>
            {selectedDriverId === c.driverId && <span> ✓ Selected</span>}<br />
            Score: <strong>{c.score.toFixed(2)}</strong><br />
            Distance: {Math.round(c.distance)}m | ETA: {Math.round(c.eta)}s<br />
            <em>{c.explanation}</em>
          </Popup>
        </Marker>
      ))}

      {/* En-route trajectory lines */}
      {trajectories.map(t => (
        <Polyline
          key={t.driverId}
          positions={[t.from, t.to]}
          pathOptions={{ color: '#f97316', weight: 2, dashArray: '6 4', opacity: 0.8 }}
        />
      ))}

      {pickup && (
        <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
          <Popup>📍 Pickup</Popup>
        </Marker>
      )}
      {dropoff && (
        <Marker position={[dropoff.lat, dropoff.lng]} icon={dropoffIcon}>
          <Popup>🏁 Dropoff</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
