import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { MatchingService } from '../services/matchingService';
import { ConfirmationService } from '../services/confirmationService';
import { RideStore } from '../store/db';
import { RideRequest, EventType } from '../models/types';
import { eventBus } from '../events/eventBus';

export function ridesRouter(
  matchingService: MatchingService,
  confirmationService: ConfirmationService,
  rideStore: RideStore
): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const { passengerId, pickup, dropoff } = req.body;
    if (!passengerId || !pickup?.lat || !pickup?.lng || !dropoff?.lat || !dropoff?.lng) {
      res.status(400).json({ error: 'passengerId, pickup, and dropoff are required' }); return;
    }
    const rideReq: RideRequest = {
      requestId: randomUUID(), passengerId, pickup, dropoff, timestamp: Date.now(),
    };
    await rideStore.insert(rideReq);
    eventBus.emit(EventType.RIDE_REQUESTED, rideReq);
    const candidates = matchingService.findMatches(rideReq);
    if (candidates.length === 0) {
      res.status(200).json({ requestId: rideReq.requestId, candidates: [], message: 'no_drivers_available' }); return;
    }
    res.status(200).json({ requestId: rideReq.requestId, candidates });
  });

  router.post('/:requestId/match', async (req: Request, res: Response) => {
    const requestId = req.params['requestId'] as string;
    const { driverId } = req.body;
    if (!driverId) { res.status(400).json({ error: 'driverId is required' }); return; }
    const match = await confirmationService.propose(requestId, driverId);
    if (!match) { res.status(409).json({ error: 'driver_already_assigned' }); return; }
    res.status(201).json(match);
  });

  router.post('/matches/:matchId/confirm', async (req: Request, res: Response) => {
    const matchId = req.params['matchId'] as string;
    const { driverId } = req.body;
    if (!driverId) { res.status(400).json({ error: 'driverId is required' }); return; }
    const result = await confirmationService.confirm(matchId, driverId);
    if (!result.ok) {
      const statusCode = result.reason === 'match_not_found' ? 404 : 409;
      res.status(statusCode).json({ error: result.reason }); return;
    }
    res.status(200).json({ status: 'confirmed' });
  });

  router.post('/matches/:matchId/reject', async (req: Request, res: Response) => {
    const matchId = req.params['matchId'] as string;
    const { driverId } = req.body;
    if (!driverId) { res.status(400).json({ error: 'driverId is required' }); return; }
    const result = await confirmationService.reject(matchId, driverId);
    if (!result.ok) { res.status(404).json({ error: result.reason }); return; }
    res.status(200).json({ status: 'rejected' });
  });

  return router;
}
