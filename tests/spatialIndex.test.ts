import { SpatialIndex } from '../src/store/spatialIndex';
import { DriverLocation } from '../src/models/types';

function makeDriver(id: string, lat: number, lng: number, available = true): DriverLocation {
  return { driverId: id, lat, lng, heading: 0, speed: 0, available, timestamp: Date.now() };
}

describe('SpatialIndex', () => {
  let index: SpatialIndex;

  beforeEach(() => { index = new SpatialIndex(); });

  test('upsert and query finds nearby driver', () => {
    index.upsert(makeDriver('d1', -1.9441, 30.0619));
    const results = index.query(-1.9441, 30.0619, 10_000);
    expect(results.map(r => r.driverId)).toContain('d1');
  });

  test('query excludes unavailable drivers', () => {
    index.upsert(makeDriver('d1', -1.9441, 30.0619, false));
    const results = index.query(-1.9441, 30.0619, 10_000);
    expect(results).toHaveLength(0);
  });

  test('query excludes stale drivers', () => {
    const stale: DriverLocation = { ...makeDriver('d1', -1.9441, 30.0619), timestamp: Date.now() - 20_000 };
    index.upsert(stale);
    const results = index.query(-1.9441, 30.0619, 10_000);
    expect(results).toHaveLength(0);
  });

  test('remove deletes driver from index', () => {
    index.upsert(makeDriver('d1', -1.9441, 30.0619));
    index.remove('d1');
    expect(index.query(-1.9441, 30.0619, 10_000)).toHaveLength(0);
  });

  test('upsert moves driver to new cell on location change', () => {
    index.upsert(makeDriver('d1', -1.9441, 30.0619));
    // Move driver far away
    index.upsert(makeDriver('d1', -2.5, 29.5));
    const nearKigali = index.query(-1.9441, 30.0619, 10_000);
    expect(nearKigali.map(r => r.driverId)).not.toContain('d1');
  });

  test('size reflects active drivers', () => {
    index.upsert(makeDriver('d1', -1.9441, 30.0619));
    index.upsert(makeDriver('d2', -1.9450, 30.0625));
    expect(index.size()).toBe(2);
    index.remove('d1');
    expect(index.size()).toBe(1);
  });
});
