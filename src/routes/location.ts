import { Router, Request, Response } from 'express';
import { LocationService } from '../services/locationService';
import { DriverLocation } from '../models/types';

export function locationRouter(locationService: LocationService): Router {
  const router = Router();

  router.post('/:driverId/location', async (req: Request, res: Response) => {
    const driverId = req.params['driverId'] as string;
    const { lat, lng, heading = 0, speed = 0, available = true } = req.body;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ error: 'lat and lng must be numbers' }); return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: 'invalid coordinates' }); return;
    }

    const loc: DriverLocation = { driverId, lat, lng, heading, speed, available, timestamp: Date.now() };
    await locationService.update(loc);
    res.status(204).send();
  });

  return router;
}
