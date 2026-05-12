import { DriverLocation } from '../models/types';
import { EventType } from '../models/types';
import { eventBus } from '../events/eventBus';
import { spatialIndex } from '../store/spatialIndex';
import { DriverStore } from '../store/db';
import { encode } from '../utils/geohash';

const GEOHASH_PRECISION = 6;
const MAX_STALENESS_MS = 10_000;

export class LocationService {
  constructor(private driverStore: DriverStore) {}

  async update(loc: DriverLocation): Promise<void> {
    const geohash = encode(loc.lat, loc.lng, GEOHASH_PRECISION);
    const enriched: DriverLocation = { ...loc, geohash };
    spatialIndex.upsert(enriched);
    await this.driverStore.upsert(enriched);
    eventBus.emit(EventType.DRIVER_LOCATION_UPDATED, {
      driverId: loc.driverId, lat: loc.lat, lng: loc.lng,
      heading: loc.heading, speed: loc.speed, available: loc.available, geohash,
    });
  }

  getCandidates(lat: number, lng: number): DriverLocation[] {
    return spatialIndex.query(lat, lng, MAX_STALENESS_MS);
  }

  getMaxStalenessMs(): number { return MAX_STALENESS_MS; }
}
