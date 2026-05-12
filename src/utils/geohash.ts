/**
 * Geohash spatial index for O(1) cell lookup and O(k) neighbor search.
 * Precision 6 ≈ 1.2km x 0.6km cells — good balance for city-scale matching.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encode(lat: number, lng: number, precision = 6): string {
  let idx = 0, bit = 0, evenBit = true;
  let hash = '';
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { idx = (idx << 1) | 1; minLng = mid; }
      else { idx = idx << 1; maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { idx = (idx << 1) | 1; minLat = mid; }
      else { idx = idx << 1; maxLat = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += BASE32[idx]; idx = 0; bit = 0; }
  }
  return hash;
}

export function decode(hash: string): { lat: number; lng: number; error: { lat: number; lng: number } } {
  let evenBit = true;
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;

  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    for (let bits = 4; bits >= 0; bits--) {
      const bitN = (idx >> bits) & 1;
      if (evenBit) {
        const mid = (minLng + maxLng) / 2;
        if (bitN === 1) minLng = mid; else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (bitN === 1) minLat = mid; else maxLat = mid;
      }
      evenBit = !evenBit;
    }
  }
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
    error: { lat: (maxLat - minLat) / 2, lng: (maxLng - minLng) / 2 }
  };
}

// Returns the 8 neighbors + self for a given geohash cell
export function neighbors(hash: string): string[] {
  const { lat, lng, error } = decode(hash);
  const precision = hash.length;
  const latStep = error.lat * 2;
  const lngStep = error.lng * 2;

  const cells: string[] = [];
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlng = -1; dlng <= 1; dlng++) {
      const nLat = lat + dlat * latStep;
      const nLng = lng + dlng * lngStep;
      if (nLat >= -90 && nLat <= 90 && nLng >= -180 && nLng <= 180) {
        cells.push(encode(nLat, nLng, precision));
      }
    }
  }
  return [...new Set(cells)];
}

// Haversine distance in meters
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Project a point along a bearing by distanceMeters
export function projectPoint(lat: number, lng: number, bearingDeg: number, distanceMeters: number): { lat: number; lng: number } {
  const R = 6371000;
  const d = distanceMeters / R;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}
