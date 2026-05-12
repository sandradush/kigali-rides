import { RideRequest, MatchCandidate, DriverLocation, Location } from '../models/types';
import { haversineMeters, projectPoint } from '../utils/geohash';
import { LocationService } from './locationService';

const MAX_SEARCH_RADIUS_M = 5000; // 5km
const AVG_SPEED_MPS = 10; // 10 m/s (~36 km/h city speed)
const DIVERSION_THRESHOLD_M = 500; // max 500m diversion for en-route pickup

/**
 * Matching engine: returns top-3 candidates ranked by composite score.
 * Score = w1*(1 - distance/maxDist) + w2*(1 - eta/maxEta) + w3*availabilityBonus
 * Complexity: O(k log k) where k = candidates in 3x3 geohash neighborhood (~10-50 in practice)
 */
export class MatchingService {
  constructor(private locationService: LocationService) {}

  findMatches(req: RideRequest): MatchCandidate[] {
    const candidates = this.locationService.getCandidates(req.pickup.lat, req.pickup.lng);
    const scored: MatchCandidate[] = [];

    for (const driver of candidates) {
      const dist = haversineMeters(req.pickup.lat, req.pickup.lng, driver.lat, driver.lng);
      if (dist > MAX_SEARCH_RADIUS_M) continue;

      const eta = dist / AVG_SPEED_MPS;
      const score = this.computeScore(dist, eta, driver);
      const explanation = `Distance: ${Math.round(dist)}m, ETA: ${Math.round(eta)}s`;

      scored.push({
        driverId: driver.driverId,
        score,
        distance: dist,
        eta,
        explanation,
        currentLocation: { lat: driver.lat, lng: driver.lng }
      });
    }

    // Upgrade score for moving drivers whose trajectory passes near the pickup
    const enRouteMap = new Map(this.findEnRouteCandidates(req, candidates).map(c => [c.driverId, c]));
    for (const c of scored) {
      const er = enRouteMap.get(c.driverId);
      if (er && er.score > c.score) {
        c.score = er.score;
        c.explanation = er.explanation;
      }
    }

    // Sort descending by score, return top 3
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3);
  }

  private computeScore(distM: number, etaS: number, driver: DriverLocation): number {
    const distScore = 1 - Math.min(distM / MAX_SEARCH_RADIUS_M, 1);
    const etaScore = 1 - Math.min(etaS / (MAX_SEARCH_RADIUS_M / AVG_SPEED_MPS), 1);
    const speedBonus = driver.speed > 5 ? 0.1 : 0; // moving drivers slightly preferred
    return 0.5 * distScore + 0.4 * etaScore + 0.1 + speedBonus;
  }

  /**
   * En-route matching: if a driver is moving (speed > 5 m/s) and their trajectory
   * passes within DIVERSION_THRESHOLD_M of the pickup, suggest a dynamic pickup point.
   */
  private findEnRouteCandidates(req: RideRequest, drivers: DriverLocation[]): MatchCandidate[] {
    const enRoute: MatchCandidate[] = [];

    for (const driver of drivers) {
      if (driver.speed < 5) continue; // stationary

      // Project driver's position 60s ahead
      const projected = projectPoint(driver.lat, driver.lng, driver.heading, driver.speed * 60);
      const diversionDist = this.pointToSegmentDistance(
        req.pickup,
        { lat: driver.lat, lng: driver.lng },
        projected
      );

      if (diversionDist <= DIVERSION_THRESHOLD_M) {
        const dist = haversineMeters(req.pickup.lat, req.pickup.lng, driver.lat, driver.lng);
        const eta = dist / driver.speed;
        const score = this.computeScore(dist, eta, driver) + 0.15; // en-route bonus

        enRoute.push({
          driverId: driver.driverId,
          score,
          distance: dist,
          eta,
          explanation: `En-route: diversion ${Math.round(diversionDist)}m, ETA ${Math.round(eta)}s`,
          currentLocation: { lat: driver.lat, lng: driver.lng }
        });
      }
    }
    return enRoute;
  }

  // Perpendicular distance from point to line segment
  private pointToSegmentDistance(p: Location, a: Location, b: Location): number {
    const px = p.lng, py = p.lat;
    const ax = a.lng, ay = a.lat;
    const bx = b.lng, by = b.lat;

    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return haversineMeters(p.lat, p.lng, a.lat, a.lng);

    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const closestLat = ay + t * dy;
    const closestLng = ax + t * dx;
    return haversineMeters(p.lat, p.lng, closestLat, closestLng);
  }
}
