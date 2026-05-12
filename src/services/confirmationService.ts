import { randomUUID } from 'crypto';
import { MatchConfirmation, EventType } from '../models/types';
import { eventBus } from '../events/eventBus';
import { MatchStore, RideStore, DriverStore } from '../store/db';
import { spatialIndex } from '../store/spatialIndex';

const CONFIRMATION_TIMEOUT_MS = 30_000;

export class ConfirmationService {
  private expiryTimer: NodeJS.Timeout;

  constructor(
    private matchStore: MatchStore,
    private rideStore: RideStore,
    private driverStore: DriverStore
  ) {
    this.expiryTimer = setInterval(() => this.sweepExpired(), 5_000);
  }

  async propose(requestId: string, driverId: string): Promise<MatchConfirmation | null> {
    const now = Date.now();
    const match: MatchConfirmation = {
      matchId: randomUUID(), requestId, driverId,
      status: 'pending', timestamp: now, expiresAt: now + CONFIRMATION_TIMEOUT_MS,
    };
    const inserted = await this.matchStore.insertIfDriverFree(match);
    if (!inserted) return null;
    await this.driverStore.setAvailability(driverId, false);
    spatialIndex.remove(driverId);
    eventBus.emit(EventType.MATCH_PROPOSED, { matchId: match.matchId, requestId, driverId });
    return match;
  }

  async confirm(matchId: string, driverId: string): Promise<{ ok: boolean; reason?: string }> {
    const confirmed = await this.matchStore.confirm(matchId, driverId);
    if (!confirmed) {
      const match = await this.matchStore.getById(matchId);
      if (!match) return { ok: false, reason: 'match_not_found' };
      if (match.status === 'expired') return { ok: false, reason: 'match_expired' };
      if (match.status === 'confirmed') return { ok: false, reason: 'already_confirmed' };
      return { ok: false, reason: 'invalid_state' };
    }
    const match = (await this.matchStore.getById(matchId))!;
    await this.rideStore.updateStatus(match.requestId, 'matched');
    eventBus.emit(EventType.MATCH_CONFIRMED, { matchId, driverId, requestId: match.requestId });
    return { ok: true };
  }

  async reject(matchId: string, driverId: string): Promise<{ ok: boolean; reason?: string }> {
    const rejected = await this.matchStore.reject(matchId, driverId);
    if (!rejected) return { ok: false, reason: 'match_not_found_or_not_pending' };
    await this.driverStore.setAvailability(driverId, true);
    const driver = await this.driverStore.getById(driverId);
    if (driver) spatialIndex.upsert({ ...driver, available: true });
    const match = (await this.matchStore.getById(matchId))!;
    await this.rideStore.updateStatus(match.requestId, 'pending');
    eventBus.emit(EventType.MATCH_REJECTED, { matchId, driverId });
    return { ok: true };
  }

  private async sweepExpired(): Promise<void> {
    const count = await this.matchStore.expireStale();
    if (count > 0) eventBus.emit(EventType.MATCH_EXPIRED, { count });
  }

  shutdown(): void { clearInterval(this.expiryTimer); }
}
