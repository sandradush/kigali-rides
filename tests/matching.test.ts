import Database from 'better-sqlite3';
import { DriverStore, RideStore, MatchStore, EventStore, openDb } from '../src/store/db';
import { LocationService } from '../src/services/locationService';
import { MatchingService } from '../src/services/matchingService';
import { ConfirmationService } from '../src/services/confirmationService';
import { SpatialIndex } from '../src/store/spatialIndex';
import { spatialIndex } from '../src/store/spatialIndex';
import { RideRequest } from '../src/models/types';
import { randomUUID } from 'crypto';

// Use in-memory SQLite for tests
function makeTestDb(): Database.Database {
  return openDb(':memory:');
}

function makeRideRequest(overrides: Partial<RideRequest> = {}): RideRequest {
  return {
    requestId: randomUUID(),
    passengerId: 'p1',
    pickup: { lat: -1.9441, lng: 30.0619 },
    dropoff: { lat: -1.9500, lng: 30.0700 },
    timestamp: Date.now(),
    ...overrides
  };
}

describe('MatchingService', () => {
  let db: Database.Database;
  let locationService: LocationService;
  let matchingService: MatchingService;

  beforeEach(() => {
    db = makeTestDb();
    // Reset spatial index for each test
    (spatialIndex as any).grid = new Map();
    (spatialIndex as any).driverCell = new Map();

    const driverStore = new DriverStore(db);
    locationService = new LocationService(driverStore);
    matchingService = new MatchingService(locationService);
  });

  afterEach(() => db.close());

  test('returns empty array when no drivers available', () => {
    const req = makeRideRequest();
    expect(matchingService.findMatches(req)).toHaveLength(0);
  });

  test('returns top-3 candidates sorted by score descending', () => {
    // Add 5 drivers at varying distances
    const drivers = [
      { id: 'd1', lat: -1.9442, lng: 30.0620 }, // very close
      { id: 'd2', lat: -1.9460, lng: 30.0640 }, // close
      { id: 'd3', lat: -1.9500, lng: 30.0680 }, // medium
      { id: 'd4', lat: -1.9600, lng: 30.0800 }, // far
      { id: 'd5', lat: -1.9700, lng: 30.0900 }, // farther
    ];

    for (const d of drivers) {
      locationService.update({ driverId: d.id, lat: d.lat, lng: d.lng, heading: 0, speed: 0, available: true, timestamp: Date.now() });
    }

    const req = makeRideRequest();
    const candidates = matchingService.findMatches(req);

    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates.length).toBeGreaterThan(0);

    // Scores should be descending
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].score).toBeGreaterThanOrEqual(candidates[i].score);
    }

    // Closest driver should rank first
    expect(candidates[0].driverId).toBe('d1');
  });

  test('skips driver in geohash neighborhood but beyond 5km radius', () => {
    // Geohash precision-6 cells are ~1.2km x 0.6km, neighbors cover ~3.6km x 1.8km.
    // Place driver ~5.5km away along same longitude so it may land in an edge neighbor cell.
    // The key is: getCandidates returns it (same geohash region), but haversine > 5000m filters it.
    locationService.update({
      driverId: 'd_edge', lat: -1.8940, lng: 30.0619, // ~5.6km north of pickup
      heading: 0, speed: 0, available: true, timestamp: Date.now()
    });
    const req = makeRideRequest({ pickup: { lat: -1.9441, lng: 30.0619 } });
    const candidates = matchingService.findMatches(req);
    expect(candidates.map(c => c.driverId)).not.toContain('d_edge');
  });

  test('excludes drivers beyond 5km radius', () => {
    // Driver 50km away
    locationService.update({ driverId: 'd_far', lat: -2.4, lng: 30.5, heading: 0, speed: 0, available: true, timestamp: Date.now() });
    const req = makeRideRequest();
    const candidates = matchingService.findMatches(req);
    expect(candidates.map(c => c.driverId)).not.toContain('d_far');
  });

  test('each candidate has required fields', () => {
    locationService.update({ driverId: 'd1', lat: -1.9442, lng: 30.0620, heading: 0, speed: 0, available: true, timestamp: Date.now() });
    const req = makeRideRequest();
    const [c] = matchingService.findMatches(req);
    expect(c).toHaveProperty('driverId');
    expect(c).toHaveProperty('score');
    expect(c).toHaveProperty('distance');
    expect(c).toHaveProperty('eta');
    expect(c).toHaveProperty('explanation');
    expect(c.score).toBeGreaterThan(0);
    expect(c.score).toBeLessThanOrEqual(1.2); // max with bonuses
  });
});

describe('ConfirmationService — concurrency safety', () => {
  let db: Database.Database;
  let confirmationService: ConfirmationService;
  let rideStore: RideStore;

  beforeEach(() => {
    db = makeTestDb();
    const driverStore = new DriverStore(db);
    rideStore = new RideStore(db);
    const matchStore = new MatchStore(db);
    confirmationService = new ConfirmationService(matchStore, rideStore, driverStore);

    // Seed a ride request
    rideStore.insert(makeRideRequest({ requestId: 'req-1' }));
  });

  afterEach(() => {
    confirmationService.shutdown();
    db.close();
  });

  test('propose returns a match for a free driver', () => {
    const match = confirmationService.propose('req-1', 'driver-1');
    expect(match).not.toBeNull();
    expect(match!.status).toBe('pending');
    expect(match!.driverId).toBe('driver-1');
  });

  test('double-booking: second propose for same driver returns null', () => {
    rideStore.insert(makeRideRequest({ requestId: 'req-2' }));
    const m1 = confirmationService.propose('req-1', 'driver-1');
    const m2 = confirmationService.propose('req-2', 'driver-1');
    expect(m1).not.toBeNull();
    expect(m2).toBeNull(); // driver already assigned
  });

  test('concurrent proposals for same driver: exactly one succeeds', () => {
    // Simulate concurrent proposals synchronously (SQLite serializes)
    rideStore.insert(makeRideRequest({ requestId: 'req-2' }));
    rideStore.insert(makeRideRequest({ requestId: 'req-3' }));

    const results = [
      confirmationService.propose('req-1', 'driver-x'),
      confirmationService.propose('req-2', 'driver-x'),
      confirmationService.propose('req-3', 'driver-x'),
    ];

    const successes = results.filter(r => r !== null);
    expect(successes).toHaveLength(1);
  });

  test('confirm succeeds for valid pending match', () => {
    const match = confirmationService.propose('req-1', 'driver-1')!;
    const result = confirmationService.confirm(match.matchId, 'driver-1');
    expect(result.ok).toBe(true);
  });

  test('confirm fails for wrong driver', () => {
    const match = confirmationService.propose('req-1', 'driver-1')!;
    const result = confirmationService.confirm(match.matchId, 'driver-2');
    expect(result.ok).toBe(false);
  });

  test('confirm fails after rejection', () => {
    const match = confirmationService.propose('req-1', 'driver-1')!;
    confirmationService.reject(match.matchId, 'driver-1');
    const result = confirmationService.confirm(match.matchId, 'driver-1');
    expect(result.ok).toBe(false);
  });

  test('reject frees driver for re-matching', () => {
    rideStore.insert(makeRideRequest({ requestId: 'req-2' }));
    const m1 = confirmationService.propose('req-1', 'driver-1')!;
    confirmationService.reject(m1.matchId, 'driver-1');

    // Driver should now be free
    const m2 = confirmationService.propose('req-2', 'driver-1');
    expect(m2).not.toBeNull();
  });

  test('confirm returns match_expired reason for expired match', () => {
    const db2 = makeTestDb();
    const driverStore2 = new DriverStore(db2);
    const rideStore2 = new RideStore(db2);
    const matchStore2 = new MatchStore(db2);
    rideStore2.insert(makeRideRequest({ requestId: 'req-exp' }));
    // Insert an already-expired match directly
    const expiredMatch = {
      matchId: 'match-exp',
      requestId: 'req-exp',
      driverId: 'driver-exp',
      status: 'expired' as const,
      timestamp: Date.now() - 60_000,
      expiresAt: Date.now() - 30_000
    };
    // Use raw db to insert expired match
    db2.prepare(`INSERT INTO match_confirmations (match_id, request_id, driver_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(expiredMatch.matchId, expiredMatch.requestId, expiredMatch.driverId,
        expiredMatch.status, expiredMatch.timestamp, expiredMatch.expiresAt);
    const svc2 = new ConfirmationService(matchStore2, rideStore2, driverStore2);
    const result = svc2.confirm('match-exp', 'driver-exp');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('match_expired');
    svc2.shutdown();
    db2.close();
  });

  test('sweepExpired emits MatchExpired event when matches expire', () => {
    const db2 = makeTestDb();
    const driverStore2 = new DriverStore(db2);
    const rideStore2 = new RideStore(db2);
    const matchStore2 = new MatchStore(db2);
    rideStore2.insert(makeRideRequest({ requestId: 'req-sweep' }));
    db2.prepare(`INSERT INTO match_confirmations (match_id, request_id, driver_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('match-sweep', 'req-sweep', 'driver-sweep', 'pending', Date.now() - 60_000, Date.now() - 1);
    const svc2 = new ConfirmationService(matchStore2, rideStore2, driverStore2);
    // Trigger sweep directly — should expire the stale match and emit event
    (svc2 as any).sweepExpired();
    const match = matchStore2.getById('match-sweep');
    expect(match!.status).toBe('expired');
    svc2.shutdown();
    db2.close();
  });
});

describe('LocationService', () => {
  test('getMaxStalenessMs returns 10000', () => {
    const db = makeTestDb();
    const locationService = new LocationService(new DriverStore(db));
    expect(locationService.getMaxStalenessMs()).toBe(10_000);
    db.close();
  });
});

describe('MatchingService — en-route', () => {
  let db: Database.Database;
  let locationService: LocationService;
  let matchingService: MatchingService;

  beforeEach(() => {
    db = makeTestDb();
    (spatialIndex as any).grid = new Map();
    (spatialIndex as any).driverCell = new Map();
    locationService = new LocationService(new DriverStore(db));
    matchingService = new MatchingService(locationService);
  });

  afterEach(() => db.close());

  test('en-route driver gets upgraded explanation', () => {
    // Driver moving north (heading=0) at 10 m/s, positioned so trajectory passes near pickup
    locationService.update({
      driverId: 'en-d1', lat: -1.9460, lng: 30.0619,
      heading: 0, speed: 10, available: true, timestamp: Date.now()
    });
    const req = makeRideRequest({ pickup: { lat: -1.9441, lng: 30.0619 } });
    const candidates = matchingService.findMatches(req);
    const enRoute = candidates.find(c => c.driverId === 'en-d1');
    expect(enRoute).toBeDefined();
    expect(enRoute!.explanation).toMatch(/En-route/);
  });

  test('pointToSegmentDistance handles zero-length segment (driver not moving)', () => {
    // speed=6 so en-route check runs, but heading=0 and distance=0 projected
    // Force lenSq=0 by giving a driver whose projected point equals current point
    // We do this by setting speed very low so projection is negligible — but speed must be >5
    // Instead call the private method directly via casting
    const svc = matchingService as any;
    const p = { lat: -1.9441, lng: 30.0619 };
    const a = { lat: -1.9442, lng: 30.0620 };
    // a === b triggers lenSq === 0 branch
    const dist = svc.pointToSegmentDistance(p, a, a);
    expect(dist).toBeGreaterThan(0);
  });

  test('stationary driver does not get en-route bonus', () => {
    locationService.update({
      driverId: 'stat-d1', lat: -1.9442, lng: 30.0620,
      heading: 0, speed: 0, available: true, timestamp: Date.now()
    });
    const req = makeRideRequest();
    const candidates = matchingService.findMatches(req);
    const c = candidates.find(c => c.driverId === 'stat-d1');
    expect(c).toBeDefined();
    expect(c!.explanation).not.toMatch(/En-route/);
  });
});

describe('DriverStore.findByGeohashes', () => {
  test('returns empty array for empty cell list', () => {
    const db = makeTestDb();
    const store = new DriverStore(db);
    expect(store.findByGeohashes([], 10_000)).toEqual([]);
    db.close();
  });

  test('returns matching fresh drivers', () => {
    const db = makeTestDb();
    const store = new DriverStore(db);
    const loc = { driverId: 'd1', lat: -1.9441, lng: 30.0619, heading: 0, speed: 0, geohash: 'kf5731', available: true, timestamp: Date.now() };
    store.upsert(loc);
    const results = store.findByGeohashes(['kf5731'], 10_000);
    expect(results.map(r => r.driverId)).toContain('d1');
    db.close();
  });
});

describe('RideStore.getById', () => {
  test('returns undefined for unknown id', () => {
    const db = makeTestDb();
    const store = new RideStore(db);
    expect(store.getById('nope')).toBeUndefined();
    db.close();
  });

  test('returns ride for known id', () => {
    const db = makeTestDb();
    const store = new RideStore(db);
    const req = makeRideRequest({ requestId: 'r1' });
    store.insert(req);
    const found = store.getById('r1');
    expect(found).toBeDefined();
    expect(found!.requestId).toBe('r1');
    db.close();
  });
});

describe('MatchStore extras', () => {
  test('expireStale returns count of expired matches', () => {
    const db = makeTestDb();
    const rideStore = new RideStore(db);
    const matchStore = new MatchStore(db);
    rideStore.insert(makeRideRequest({ requestId: 'r1' }));
    db.prepare(`INSERT INTO match_confirmations (match_id, request_id, driver_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('m1', 'r1', 'd1', 'pending', Date.now() - 60_000, Date.now() - 1);
    expect(matchStore.expireStale()).toBe(1);
    db.close();
  });

  test('hasActiveMatch returns true for pending match', () => {
    const db = makeTestDb();
    const rideStore = new RideStore(db);
    const matchStore = new MatchStore(db);
    rideStore.insert(makeRideRequest({ requestId: 'r1' }));
    db.prepare(`INSERT INTO match_confirmations (match_id, request_id, driver_id, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run('m1', 'r1', 'd1', 'pending', Date.now(), Date.now() + 30_000);
    expect(matchStore.hasActiveMatch('d1')).toBe(true);
    expect(matchStore.hasActiveMatch('d2')).toBe(false);
    db.close();
  });
});

describe('EventStore', () => {
  test('insert persists event and is idempotent', () => {
    const db = makeTestDb();
    const store = new EventStore(db);
    store.insert('evt-1', 'RideRequested', { foo: 1 }, Date.now());
    store.insert('evt-1', 'RideRequested', { foo: 1 }, Date.now()); // duplicate — no error
    const row = db.prepare('SELECT * FROM events WHERE event_id = ?').get('evt-1') as any;
    expect(row).toBeDefined();
    expect(row.type).toBe('RideRequested');
    db.close();
  });
});

describe('SpatialIndex.getCell', () => {
  test('returns geohash string for coordinates', () => {
    const { SpatialIndex } = require('../src/store/spatialIndex');
    const idx = new SpatialIndex();
    const cell = idx.getCell(-1.9441, 30.0619);
    expect(typeof cell).toBe('string');
    expect(cell.length).toBe(6);
  });
});
