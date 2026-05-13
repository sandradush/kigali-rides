import express, { Application, Request, Response, NextFunction } from 'express';
import mysql from 'mysql2/promise';
import { DriverStore, RideStore, MatchStore, EventStore, UserStore, openDb } from './store/db';
import { LocationService } from './services/locationService';
import { MatchingService } from './services/matchingService';
import { ConfirmationService } from './services/confirmationService';
import { locationRouter } from './routes/location';
import { ridesRouter } from './routes/rides';
import { authRouter } from './routes/auth';
import { authenticate, requireRole } from './middleware/auth';
import { spatialIndex } from './store/spatialIndex';
import { eventBus } from './events/eventBus';
import { EventType } from './models/types';

export interface AppDependencies {
  pool: mysql.Pool;
  locationService: LocationService;
  matchingService: MatchingService;
  confirmationService: ConfirmationService;
}

export async function createApp(): Promise<{ app: Application; deps: AppDependencies }> {
  const pool = await openDb();

  const driverStore  = new DriverStore(pool);
  const rideStore    = new RideStore(pool);
  const matchStore   = new MatchStore(pool);
  const eventStore   = new EventStore(pool);
  const userStore    = new UserStore(pool);

  const locationService     = new LocationService(driverStore);
  const matchingService     = new MatchingService(locationService);
  const confirmationService = new ConfirmationService(matchStore, rideStore, driverStore);

  Object.values(EventType).forEach((type) => {
    eventBus.on(type as EventType, (event) => {
      eventStore.insert(event.eventId, event.type, event.payload, event.timestamp);
    });
  });

  const app = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const start = Date.now();
    _res.on('finish', () => {
      console.log(`${req.method} ${req.path} ${_res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.use('/auth', authRouter(userStore));
  app.use('/drivers', authenticate, locationRouter(locationService));
  app.use('/rides', authenticate, ridesRouter(matchingService, confirmationService, rideStore));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', drivers: spatialIndex.size(), timestamp: Date.now() });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal_server_error' });
  });

  return { app, deps: { pool, locationService, matchingService, confirmationService } };
}
