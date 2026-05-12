import mysql from 'mysql2/promise';
import { DriverLocation, RideRequest, MatchConfirmation } from '../models/types';

export interface User {
  userId: string;
  email: string;
  passwordHash: string;
  role: 'driver' | 'passenger';
  name: string;
}

export interface DbConnection {
  pool: mysql.Pool;
}

const DB_CONFIG = {
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? '3306'),
  user:     process.env.DB_USER     ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME     ?? 'kigali_rides',
  waitForConnections: true,
  connectionLimit: 10,
};

export async function openDb(): Promise<mysql.Pool> {
  const pool = mysql.createPool(DB_CONFIG);
  await applySchema(pool);
  return pool;
}

async function applySchema(pool: mysql.Pool): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id       VARCHAR(36) PRIMARY KEY,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role          ENUM('driver','passenger') NOT NULL,
        name          VARCHAR(255) NOT NULL,
        created_at    BIGINT NOT NULL
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS driver_locations (
        driver_id  VARCHAR(36) PRIMARY KEY,
        lat        DOUBLE NOT NULL,
        lng        DOUBLE NOT NULL,
        heading    DOUBLE NOT NULL DEFAULT 0,
        speed      DOUBLE NOT NULL DEFAULT 0,
        geohash    VARCHAR(12) NOT NULL,
        available  TINYINT NOT NULL DEFAULT 1,
        updated_at BIGINT NOT NULL,
        INDEX idx_driver_geohash (geohash),
        INDEX idx_driver_available (available, updated_at)
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ride_requests (
        request_id   VARCHAR(36) PRIMARY KEY,
        passenger_id VARCHAR(36) NOT NULL,
        pickup_lat   DOUBLE NOT NULL,
        pickup_lng   DOUBLE NOT NULL,
        dropoff_lat  DOUBLE NOT NULL,
        dropoff_lng  DOUBLE NOT NULL,
        status       ENUM('pending','matched','cancelled') NOT NULL DEFAULT 'pending',
        created_at   BIGINT NOT NULL
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS match_confirmations (
        match_id   VARCHAR(36) PRIMARY KEY,
        request_id VARCHAR(36) NOT NULL,
        driver_id  VARCHAR(36) NOT NULL,
        status     ENUM('pending','confirmed','expired','rejected') NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        INDEX idx_match_driver (driver_id, status),
        INDEX idx_match_request (request_id)
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS events (
        event_id   VARCHAR(36) PRIMARY KEY,
        type       VARCHAR(64) NOT NULL,
        payload    JSON NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
  } finally {
    conn.release();
  }
}

export class DriverStore {
  constructor(private pool: mysql.Pool) {}

  async upsert(loc: DriverLocation): Promise<void> {
    await this.pool.query(`
      INSERT INTO driver_locations (driver_id, lat, lng, heading, speed, geohash, available, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        lat=VALUES(lat), lng=VALUES(lng), heading=VALUES(heading),
        speed=VALUES(speed), geohash=VALUES(geohash),
        available=VALUES(available), updated_at=VALUES(updated_at)
    `, [loc.driverId, loc.lat, loc.lng, loc.heading, loc.speed, loc.geohash ?? '', loc.available ? 1 : 0, loc.timestamp]);
  }

  async findByGeohashes(cells: string[], maxStalenessMs: number): Promise<DriverLocation[]> {
    if (cells.length === 0) return [];
    const cutoff = Date.now() - maxStalenessMs;
    const placeholders = cells.map(() => '?').join(',');
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM driver_locations WHERE geohash IN (${placeholders}) AND available = 1 AND updated_at >= ?`,
      [...cells, cutoff]
    );
    return rows.map(rowToDriver);
  }

  async getById(driverId: string): Promise<DriverLocation | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM driver_locations WHERE driver_id = ?', [driverId]
    );
    return rows[0] ? rowToDriver(rows[0]) : undefined;
  }

  async setAvailability(driverId: string, available: boolean): Promise<void> {
    await this.pool.query(
      'UPDATE driver_locations SET available = ? WHERE driver_id = ?',
      [available ? 1 : 0, driverId]
    );
  }
}

export class RideStore {
  constructor(private pool: mysql.Pool) {}

  async insert(req: RideRequest): Promise<void> {
    await this.pool.query(`
      INSERT INTO ride_requests (request_id, passenger_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `, [req.requestId, req.passengerId, req.pickup.lat, req.pickup.lng, req.dropoff.lat, req.dropoff.lng, req.timestamp]);
  }

  async updateStatus(requestId: string, status: string): Promise<void> {
    await this.pool.query('UPDATE ride_requests SET status = ? WHERE request_id = ?', [status, requestId]);
  }

  async getById(requestId: string): Promise<RideRequest | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM ride_requests WHERE request_id = ?', [requestId]
    );
    if (!rows[0]) return undefined;
    const r = rows[0];
    return {
      requestId: r.request_id, passengerId: r.passenger_id,
      pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
      dropoff: { lat: r.dropoff_lat, lng: r.dropoff_lng },
      timestamp: r.created_at,
    };
  }
}

export class MatchStore {
  constructor(private pool: mysql.Pool) {}

  async insertIfDriverFree(match: MatchConfirmation): Promise<boolean> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT 1 FROM match_confirmations WHERE driver_id = ? AND status = 'pending' LIMIT 1 FOR UPDATE`,
        [match.driverId]
      );
      if (rows.length > 0) { await conn.rollback(); return false; }
      await conn.query(
        `INSERT INTO match_confirmations (match_id, request_id, driver_id, status, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?)`,
        [match.matchId, match.requestId, match.driverId, match.timestamp, match.expiresAt]
      );
      await conn.commit();
      return true;
    } catch (e) {
      await conn.rollback(); throw e;
    } finally {
      conn.release();
    }
  }

  async confirm(matchId: string, driverId: string): Promise<boolean> {
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      `UPDATE match_confirmations SET status = 'confirmed' WHERE match_id = ? AND driver_id = ? AND status = 'pending' AND expires_at > ?`,
      [matchId, driverId, Date.now()]
    );
    return result.affectedRows > 0;
  }

  async reject(matchId: string, driverId: string): Promise<boolean> {
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      `UPDATE match_confirmations SET status = 'rejected' WHERE match_id = ? AND driver_id = ? AND status = 'pending'`,
      [matchId, driverId]
    );
    return result.affectedRows > 0;
  }

  async expireStale(): Promise<number> {
    const [result] = await this.pool.query<mysql.ResultSetHeader>(
      `UPDATE match_confirmations SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`,
      [Date.now()]
    );
    return result.affectedRows;
  }

  async getById(matchId: string): Promise<MatchConfirmation | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM match_confirmations WHERE match_id = ?', [matchId]
    );
    return rows[0] ? rowToMatch(rows[0]) : undefined;
  }

  async hasActiveMatch(driverId: string): Promise<boolean> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM match_confirmations WHERE driver_id = ? AND status IN ('pending','confirmed') LIMIT 1`,
      [driverId]
    );
    return rows.length > 0;
  }
}

export class EventStore {
  constructor(private pool: mysql.Pool) {}

  async insert(eventId: string, type: string, payload: any, createdAt: number): Promise<void> {
    await this.pool.query(
      `INSERT IGNORE INTO events (event_id, type, payload, created_at) VALUES (?, ?, ?, ?)`,
      [eventId, type, JSON.stringify(payload), createdAt]
    );
  }
}

export class UserStore {
  constructor(private pool: mysql.Pool) {}

  async insert(user: User): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (user_id, email, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [user.userId, user.email, user.passwordHash, user.role, user.name, Date.now()]
    );
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM users WHERE email = ?', [email]
    );
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }

  async findById(userId: string): Promise<User | undefined> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT * FROM users WHERE user_id = ?', [userId]
    );
    return rows[0] ? rowToUser(rows[0]) : undefined;
  }
}

function rowToDriver(row: any): DriverLocation {
  return {
    driverId: row.driver_id, lat: row.lat, lng: row.lng,
    heading: row.heading, speed: row.speed, geohash: row.geohash,
    available: row.available === 1, timestamp: Number(row.updated_at),
  };
}

function rowToMatch(row: any): MatchConfirmation {
  return {
    matchId: row.match_id, requestId: row.request_id, driverId: row.driver_id,
    status: row.status, timestamp: Number(row.created_at), expiresAt: Number(row.expires_at),
  };
}

function rowToUser(row: any): User {
  return {
    userId: row.user_id, email: row.email, passwordHash: row.password_hash,
    role: row.role, name: row.name,
  };
}
