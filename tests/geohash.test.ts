import { encode, decode, neighbors, haversineMeters, projectPoint } from '../src/utils/geohash';

describe('geohash', () => {
  test('encode/decode round-trip within error bounds', () => {
    const lat = -1.9441, lng = 30.0619; // Kigali
    const hash = encode(lat, lng, 6);
    const { lat: dLat, lng: dLng, error } = decode(hash);
    expect(Math.abs(dLat - lat)).toBeLessThanOrEqual(error.lat);
    expect(Math.abs(dLng - lng)).toBeLessThanOrEqual(error.lng);
  });

  test('encode precision 6 produces 6-char hash', () => {
    expect(encode(-1.9441, 30.0619, 6)).toHaveLength(6);
  });

  test('neighbors returns 9 unique cells including self', () => {
    const hash = encode(-1.9441, 30.0619, 6);
    const n = neighbors(hash);
    expect(n.length).toBeGreaterThanOrEqual(8);
    expect(n).toContain(hash);
    expect(new Set(n).size).toBe(n.length);
  });

  test('haversine: same point = 0', () => {
    expect(haversineMeters(-1.9441, 30.0619, -1.9441, 30.0619)).toBe(0);
  });

  test('haversine: Kigali to Nyamata ~30km', () => {
    const dist = haversineMeters(-1.9441, 30.0619, -2.1441, 30.0619);
    expect(dist).toBeGreaterThan(20000);
    expect(dist).toBeLessThan(40000);
  });

  test('projectPoint moves in correct direction', () => {
    const { lat, lng } = projectPoint(-1.9441, 30.0619, 0, 1000); // north 1km
    expect(lat).toBeGreaterThan(-1.9441);
    expect(Math.abs(lng - 30.0619)).toBeLessThan(0.001);
  });
});
