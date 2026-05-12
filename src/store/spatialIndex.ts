import { DriverLocation } from '../models/types';
import { encode, neighbors } from '../utils/geohash';

const GEOHASH_PRECISION = 6; // ~1.2km x 0.6km cells

/**
 * In-memory geohash grid. Writes are O(1), neighbor lookups are O(9k) where k = drivers/cell.
 * This is the hot path for matching — kept purely in memory for latency.
 * The SQLite store is the durable source of truth; this is a read-through cache.
 */
export class SpatialIndex {
  // cell -> driverId -> location
  private grid: Map<string, Map<string, DriverLocation>> = new Map();
  // driverId -> current cell (for O(1) removal on update)
  private driverCell: Map<string, string> = new Map();

  upsert(loc: DriverLocation): void {
    const cell = encode(loc.lat, loc.lng, GEOHASH_PRECISION);
    const prevCell = this.driverCell.get(loc.driverId);

    if (prevCell && prevCell !== cell) {
      this.grid.get(prevCell)?.delete(loc.driverId);
    }

    if (!this.grid.has(cell)) this.grid.set(cell, new Map());
    this.grid.get(cell)!.set(loc.driverId, { ...loc, geohash: cell });
    this.driverCell.set(loc.driverId, cell);
  }

  remove(driverId: string): void {
    const cell = this.driverCell.get(driverId);
    if (cell) {
      this.grid.get(cell)?.delete(driverId);
      this.driverCell.delete(driverId);
    }
  }

  /**
   * Returns all available, fresh drivers within the 3x3 neighborhood of the query point.
   * Complexity: O(9 * k) where k = average drivers per cell.
   */
  query(lat: number, lng: number, maxStalenessMs: number): DriverLocation[] {
    const cell = encode(lat, lng, GEOHASH_PRECISION);
    const cells = neighbors(cell); // includes self
    const cutoff = Date.now() - maxStalenessMs;
    const results: DriverLocation[] = [];

    for (const c of cells) {
      const bucket = this.grid.get(c);
      if (!bucket) continue;
      for (const loc of bucket.values()) {
        if (loc.available && loc.timestamp >= cutoff) {
          results.push(loc);
        }
      }
    }
    return results;
  }

  size(): number {
    let n = 0;
    for (const bucket of this.grid.values()) n += bucket.size;
    return n;
  }

  getCell(lat: number, lng: number): string {
    return encode(lat, lng, GEOHASH_PRECISION);
  }
}

export const spatialIndex = new SpatialIndex();
