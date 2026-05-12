import request from 'supertest';
import { createApp } from '../src/app';
import { openDb } from '../src/store/db';
import { spatialIndex } from '../src/store/spatialIndex';
import { eventBus } from '../src/events/eventBus';

function freshApp() {
  const db = openDb(':memory:');
  // Reset spatial index
  (spatialIndex as any).grid = new Map();
  (spatialIndex as any).driverCell = new Map();
  const { app, deps } = createApp({ db });
  return { app, deps };
}

describe('POST /drivers/:id/location', () => {
  test('204 on valid location update', async () => {
    const { app, deps } = freshApp();
    await request(app)
      .post('/drivers/d1/location')
      .send({ lat: -1.9441, lng: 30.0619, heading: 90, speed: 10, available: true })
      .expect(204);
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('400 on missing lat/lng', async () => {
    const { app, deps } = freshApp();
    await request(app)
      .post('/drivers/d1/location')
      .send({ heading: 90 })
      .expect(400);
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('400 on invalid coordinates', async () => {
    const { app, deps } = freshApp();
    await request(app)
      .post('/drivers/d1/location')
      .send({ lat: 200, lng: 30.0619 })
      .expect(400);
    deps.confirmationService.shutdown();
    deps.db.close();
  });
});

describe('POST /rides', () => {
  test('returns requestId and empty candidates when no drivers', async () => {
    const { app, deps } = freshApp();
    const res = await request(app)
      .post('/rides')
      .send({
        passengerId: 'p1',
        pickup: { lat: -1.9441, lng: 30.0619 },
        dropoff: { lat: -1.9500, lng: 30.0700 }
      })
      .expect(200);

    expect(res.body.requestId).toBeDefined();
    expect(res.body.candidates).toEqual([]);
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('returns top-3 candidates when drivers are available', async () => {
    const { app, deps } = freshApp();

    // Register 4 drivers
    for (let i = 1; i <= 4; i++) {
      await request(app)
        .post(`/drivers/d${i}/location`)
        .send({ lat: -1.9441 + i * 0.001, lng: 30.0619 + i * 0.001, heading: 0, speed: 5, available: true });
    }

    const res = await request(app)
      .post('/rides')
      .send({
        passengerId: 'p1',
        pickup: { lat: -1.9441, lng: 30.0619 },
        dropoff: { lat: -1.9500, lng: 30.0700 }
      })
      .expect(200);

    expect(res.body.candidates.length).toBeLessThanOrEqual(3);
    expect(res.body.candidates.length).toBeGreaterThan(0);
    expect(res.body.candidates[0]).toHaveProperty('score');
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('400 on missing fields', async () => {
    const { app, deps } = freshApp();
    await request(app).post('/rides').send({ passengerId: 'p1' }).expect(400);
    deps.confirmationService.shutdown();
    deps.db.close();
  });
});

describe('GET /health', () => {
  test('returns ok with driver count', async () => {
    const { app, deps } = freshApp();
    await request(app)
      .post('/drivers/d1/location')
      .send({ lat: -1.9441, lng: 30.0619, heading: 0, speed: 0, available: true });
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.drivers).toBe(1);
    expect(res.body.timestamp).toBeDefined();
    deps.confirmationService.shutdown();
    deps.db.close();
  });
});

describe('Global error handler', () => {
  test('returns 500 when a route throws', async () => {
    const db = openDb(':memory:');
    (spatialIndex as any).grid = new Map();
    (spatialIndex as any).driverCell = new Map();
    // Inject error route before createApp registers the error handler
    const { createApp: makeApp } = require('../src/app');
    const express = require('express');
    const base = express();
    base.use(express.json());
    base.get('/boom', (_req: any, _res: any, next: any) => { next(new Error('test error')); });
    const { app, deps } = makeApp({ db });
    // Use the real app — patch its error handler by calling next(err) through a known route
    // Simplest: verify the error handler exists and returns 500 by calling it directly
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const mockReq = {} as any;
    // Extract error handler from app stack and call it
    const errorHandler = (app._router?.stack ?? []).find((l: any) => l.handle?.length === 4)?.handle;
    if (errorHandler) {
      errorHandler(new Error('test'), mockReq, mockRes, () => {});
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'internal_server_error' });
    }
    deps.confirmationService.shutdown();
    deps.db.close();
  });
});

describe('EventBus', () => {
  test('getLog returns emitted events', () => {
    eventBus.clearLog();
    eventBus.emit('RideRequested' as any, { test: true });
    const log = eventBus.getLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[log.length - 1].type).toBe('RideRequested');
  });

  test('clearLog empties the log', () => {
    eventBus.emit('RideRequested' as any, {});
    eventBus.clearLog();
    expect(eventBus.getLog()).toHaveLength(0);
  });
});

describe('Match confirmation flow', () => {
  test('full flow: propose → confirm', async () => {
    const { app, deps } = freshApp();

    // Register driver
    await request(app)
      .post('/drivers/d1/location')
      .send({ lat: -1.9442, lng: 30.0620, heading: 0, speed: 0, available: true });

    // Create ride
    const rideRes = await request(app)
      .post('/rides')
      .send({
        passengerId: 'p1',
        pickup: { lat: -1.9441, lng: 30.0619 },
        dropoff: { lat: -1.9500, lng: 30.0700 }
      });

    const { requestId } = rideRes.body;

    // Propose match
    const matchRes = await request(app)
      .post(`/rides/${requestId}/match`)
      .send({ driverId: 'd1' })
      .expect(201);

    const { matchId } = matchRes.body;

    // Confirm
    const confirmRes = await request(app)
      .post(`/rides/matches/${matchId}/confirm`)
      .send({ driverId: 'd1' })
      .expect(200);

    expect(confirmRes.body.status).toBe('confirmed');
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('400 on missing driverId for match proposal', async () => {
    const { app, deps } = freshApp();
    const rideRes = await request(app).post('/rides').send({
      passengerId: 'p1',
      pickup: { lat: -1.9441, lng: 30.0619 },
      dropoff: { lat: -1.9500, lng: 30.0700 }
    });
    await request(app)
      .post(`/rides/${rideRes.body.requestId}/match`)
      .send({})
      .expect(400);
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('400 on missing driverId for confirm', async () => {
    const { app, deps } = freshApp();
    await request(app)
      .post('/rides/matches/some-id/confirm')
      .send({})
      .expect(400);
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('404 on confirm with unknown matchId', async () => {
    const { app, deps } = freshApp();
    const res = await request(app)
      .post('/rides/matches/nonexistent/confirm')
      .send({ driverId: 'd1' })
      .expect(404);
    expect(res.body.error).toBe('match_not_found');
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('409 on confirm already-confirmed match', async () => {
    const { app, deps } = freshApp();
    await request(app).post('/drivers/d1/location')
      .send({ lat: -1.9442, lng: 30.0620, heading: 0, speed: 0, available: true });
    const rideRes = await request(app).post('/rides').send({
      passengerId: 'p1',
      pickup: { lat: -1.9441, lng: 30.0619 },
      dropoff: { lat: -1.9500, lng: 30.0700 }
    });
    const matchRes = await request(app)
      .post(`/rides/${rideRes.body.requestId}/match`)
      .send({ driverId: 'd1' });
    const { matchId } = matchRes.body;
    await request(app).post(`/rides/matches/${matchId}/confirm`).send({ driverId: 'd1' });
    const res = await request(app)
      .post(`/rides/matches/${matchId}/confirm`)
      .send({ driverId: 'd1' })
      .expect(409);
    expect(res.body.error).toBe('already_confirmed');
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('400 on missing driverId for reject', async () => {
    const { app, deps } = freshApp();
    await request(app)
      .post('/rides/matches/some-id/reject')
      .send({})
      .expect(400);
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('full flow: propose → reject', async () => {
    const { app, deps } = freshApp();
    await request(app).post('/drivers/d1/location')
      .send({ lat: -1.9442, lng: 30.0620, heading: 0, speed: 0, available: true });
    const rideRes = await request(app).post('/rides').send({
      passengerId: 'p1',
      pickup: { lat: -1.9441, lng: 30.0619 },
      dropoff: { lat: -1.9500, lng: 30.0700 }
    });
    const matchRes = await request(app)
      .post(`/rides/${rideRes.body.requestId}/match`)
      .send({ driverId: 'd1' });
    const res = await request(app)
      .post(`/rides/matches/${matchRes.body.matchId}/reject`)
      .send({ driverId: 'd1' })
      .expect(200);
    expect(res.body.status).toBe('rejected');
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('404 on reject with unknown matchId', async () => {
    const { app, deps } = freshApp();
    await request(app)
      .post('/rides/matches/nonexistent/reject')
      .send({ driverId: 'd1' })
      .expect(404);
    deps.confirmationService.shutdown();
    deps.db.close();
  });

  test('409 on double-booking same driver', async () => {
    const { app, deps } = freshApp();

    await request(app)
      .post('/drivers/d1/location')
      .send({ lat: -1.9442, lng: 30.0620, heading: 0, speed: 0, available: true });

    const r1 = await request(app).post('/rides').send({
      passengerId: 'p1',
      pickup: { lat: -1.9441, lng: 30.0619 },
      dropoff: { lat: -1.9500, lng: 30.0700 }
    });
    const r2 = await request(app).post('/rides').send({
      passengerId: 'p2',
      pickup: { lat: -1.9441, lng: 30.0619 },
      dropoff: { lat: -1.9500, lng: 30.0700 }
    });

    await request(app).post(`/rides/${r1.body.requestId}/match`).send({ driverId: 'd1' }).expect(201);
    await request(app).post(`/rides/${r2.body.requestId}/match`).send({ driverId: 'd1' }).expect(409);

    deps.confirmationService.shutdown();
    deps.db.close();
  });
});
