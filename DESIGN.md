# Kigali Rides — Design Document

## 1. Technology Choice

**TypeScript / Node.js** — chosen because:
- Single-threaded event loop is well-suited to I/O-bound, high-concurrency workloads (location ingestion, HTTP matching).
- Rich ecosystem for geospatial utilities and HTTP servers.
- Strong typing via TypeScript catches data-model bugs at compile time.
- Faster iteration than Go/Java for a take-home scope while still demonstrating production patterns.

**SQLite (WAL mode)** — durable store for drivers, rides, matches, and events.
- WAL mode allows concurrent reads alongside writes, giving read-heavy matching queries low contention.
- Single-file deployment; trivially swappable for PostgreSQL in production (same SQL surface).
- Atomic `INSERT ... WHERE NOT EXISTS` is the concurrency guard for double-booking — no external lock manager needed.

**In-memory geohash grid** — hot-path spatial index.
- O(1) write, O(9k) neighbor lookup (k = drivers per cell, typically < 50 in a city).
- Backed by SQLite for durability; rebuilt from DB on restart.

---

## 2. High-Level Architecture

```
Passenger / Driver clients
        │
        ▼
┌───────────────────────────────┐
│         Express HTTP API       │
│  POST /drivers/:id/location   │  ← location ingestion
│  POST /rides                  │  ← ride request + matching
│  POST /rides/:id/match        │  ← propose assignment
│  POST /rides/matches/:id/confirm │
│  POST /rides/matches/:id/reject  │
└──────────┬────────────────────┘
           │
    ┌──────┴──────────────────────┐
    │                             │
    ▼                             ▼
LocationService            MatchingService
  - upsert spatial index     - query spatial index
  - persist to SQLite        - score candidates
  - emit event               - en-route detection
    │                             │
    ▼                             ▼
SpatialIndex (memory)      ConfirmationService
  geohash grid               - atomic propose
                             - confirm / reject
                             - expiry sweep
                                  │
                                  ▼
                           SQLite (WAL)
                    driver_locations, ride_requests,
                    match_confirmations, events
                                  │
                                  ▼
                           EventBus (in-memory)
                    → persists all events to events table
```

Service boundaries are intentional: each service owns one concern and communicates through typed interfaces, not shared mutable state (except the spatial index, which is a deliberate shared cache).

---

## 3. Data Model

### `driver_locations`
| Column      | Type    | Notes                              |
|-------------|---------|-------------------------------------|
| driver_id   | TEXT PK | Stable driver identifier            |
| lat, lng    | REAL    | WGS-84 coordinates                  |
| heading     | REAL    | Degrees 0–360                       |
| speed       | REAL    | m/s                                 |
| geohash     | TEXT    | Precision-6 cell (~1.2km × 0.6km)  |
| available   | INTEGER | 0/1 boolean                         |
| updated_at  | INTEGER | Unix ms — staleness check           |

Index on `(geohash)` for spatial fallback queries; index on `(available, updated_at)` for sweep queries.

### `ride_requests`
| Column       | Type    | Notes                        |
|--------------|---------|-------------------------------|
| request_id   | TEXT PK | UUID                          |
| passenger_id | TEXT    |                               |
| pickup_lat/lng | REAL  | WGS-84                        |
| dropoff_lat/lng | REAL |                               |
| status       | TEXT    | pending / matched / cancelled |
| created_at   | INTEGER | Unix ms                       |

### `match_confirmations`
| Column     | Type    | Notes                                      |
|------------|---------|---------------------------------------------|
| match_id   | TEXT PK | UUID                                        |
| request_id | TEXT FK | → ride_requests                             |
| driver_id  | TEXT    |                                             |
| status     | TEXT    | pending / confirmed / expired / rejected    |
| created_at | INTEGER |                                             |
| expires_at | INTEGER | created_at + 30s                            |

Index on `(driver_id, status)` — used by the double-booking guard.

### `events` (append-only)
| Column     | Type | Notes                    |
|------------|------|---------------------------|
| event_id   | TEXT PK | UUID                   |
| type       | TEXT | EventType enum            |
| payload    | TEXT | JSON                      |
| created_at | INTEGER |                        |

`INSERT OR IGNORE` ensures idempotent event writes.

---

## 4. Spatial Indexing Strategy

**Geohash at precision 6** (~1.2km × 0.6km cells).

On each location update:
1. Encode `(lat, lng)` → 6-char geohash cell.
2. Move driver from old cell to new cell in the in-memory grid (O(1) via `driverCell` reverse map).
3. Persist geohash to SQLite.

On each ride request:
1. Encode pickup → cell.
2. Expand to 3×3 neighborhood (9 cells, ~3.6km × 1.8km search area).
3. Filter by `available=true` and `timestamp >= now - 10s`.
4. Apply distance filter (5km hard cap) and score.

**Complexity**: O(9k) lookup where k ≈ 10–50 drivers per cell in Kigali density. At 10k drivers city-wide across ~200 cells, k ≈ 50 → ~450 candidates evaluated per request, well within 200ms budget.

**Why not H3?** H3 is superior for production (uniform cell areas, hierarchical indexing) but requires a native addon. Geohash is pure JS, zero native dependencies, and sufficient for this scope. The interface is identical — swapping is a one-file change.

---

## 5. Matching Algorithm

```
score(driver) = 0.5 × distanceScore + 0.4 × etaScore + 0.1 + speedBonus

distanceScore = 1 - min(dist / 5000, 1)
etaScore      = 1 - min(eta / 500, 1)
speedBonus    = 0.1 if driver.speed > 5 m/s   (moving = more reliable ETA)
```

Weights (0.5 / 0.4 / 0.1) reflect that distance is the dominant factor in city matching, ETA is secondary (accounts for traffic via speed), and availability/movement is a tiebreaker.

**En-route pickup**: For moving drivers (speed > 5 m/s), project their trajectory 60s ahead and compute perpendicular distance from pickup to that segment. If diversion ≤ 500m, the driver is eligible with a +0.15 score bonus. The dynamic pickup point is the closest point on the segment to the passenger.

**Top-3 selection**: Sort all scored candidates descending, slice first 3. O(k log k).

---

## 6. Consistency Model — No Double-Booking

The atomic guard is a single SQL statement:

```sql
INSERT INTO match_confirmations (...)
SELECT @matchId, @requestId, @driverId, 'pending', @createdAt, @expiresAt
WHERE NOT EXISTS (
  SELECT 1 FROM match_confirmations
  WHERE driver_id = @driverId AND status = 'pending'
)
```

SQLite serializes all writes. Two concurrent `propose()` calls for the same driver will execute sequentially; the second finds `status='pending'` already exists and inserts 0 rows. The caller receives `null` and returns HTTP 409.

This is **optimistic concurrency without locks** — no mutex, no Redis SETNX, no distributed transaction. It works because SQLite's WAL mode serializes writers at the DB level.

In a PostgreSQL production deployment, the equivalent is:
```sql
INSERT ... ON CONFLICT DO NOTHING
```
with a partial unique index on `(driver_id) WHERE status = 'pending'`.

**Confirmation timeout**: A background sweep runs every 5s, expiring matches where `expires_at <= now`. Expired matches free the driver for re-matching. The sweep emits `MatchExpired` events for observability.

---

## 7. Failure Scenarios & Recovery

| Scenario | Detection | Recovery |
|---|---|---|
| Driver stops sending updates | `updated_at` staleness check (10s) | Driver excluded from candidates automatically |
| Confirmation message lost | `expires_at` sweep after 30s | Match expires → driver freed → passenger can retry |
| Duplicate ride request (retry) | `request_id` is client-generated UUID; `INSERT OR IGNORE` on events | Idempotent: second insert is a no-op |
| Node crash mid-match | SQLite WAL ensures committed state survives | On restart, pending matches are still in DB; sweep will expire them |
| Duplicate location update | `ON CONFLICT ... DO UPDATE` — last-write-wins by `updated_at` | Safe: newer timestamp overwrites stale data |
| Driver accepts two rides (race) | `WHERE NOT EXISTS` guard | Exactly one proposal succeeds; second returns 409 |

---

## 8. Scalability Plan (10k+ Drivers)

**Current bottleneck**: SQLite single-writer lock. At 50 updates/driver/second × 10k drivers = 500k writes/second — SQLite cannot handle this.

**Production path**:

1. **Location writes → Redis Sorted Set + Hash**
   - `HSET driver:{id} lat lng heading speed ts` — O(1) write
   - `ZADD geo:drivers <geohash_score> driver:{id}` — O(log n) spatial index
   - Redis handles 500k+ ops/second on a single node; cluster for horizontal scale
   - SQLite/PostgreSQL receives async batch writes for durability (every 5s flush)

2. **Matching reads → in-memory only**
   - The in-memory geohash grid already handles this; at 10k drivers it uses ~10MB RAM
   - Multiple API replicas each maintain their own grid, refreshed from Redis pub/sub on location updates

3. **Match confirmations → PostgreSQL**
   - Partial unique index: `CREATE UNIQUE INDEX ON matches(driver_id) WHERE status='pending'`
   - Handles concurrent proposals safely at scale

4. **Horizontal scaling**
   - Stateless API replicas behind a load balancer
   - Location updates fan-out via Redis pub/sub to all replicas (keeps grids in sync)
   - Matching is read-only against the grid — no coordination needed

5. **Event streaming → Kafka**
   - Replace in-memory EventBus with Kafka producer
   - Enables downstream consumers (analytics, notifications, billing) without coupling

**At 10k drivers, 1k requests/second**: p95 matching latency stays < 50ms (grid lookup is microseconds; HTTP overhead dominates).

---

## 9. Observability

**Key metrics** (expose via `/metrics` in production with `prom-client`):
- `matching_latency_ms` histogram (p50/p95/p99) — primary SLO metric
- `location_update_rate` counter — ingestion throughput
- `driver_staleness_ratio` gauge — % of drivers with `updated_at > 10s`
- `match_proposal_conflicts_total` counter — double-booking attempts
- `match_expiry_total` counter — confirmation timeout rate
- `spatial_index_size` gauge — active driver count

**Structured logs**: Every request logs `method path status latencyMs`. Matching logs candidate count and top score. Errors include stack traces.

**Traces**: In production, wrap `findMatches` and `propose` with OpenTelemetry spans. The spatial query, scoring loop, and DB write are the three spans worth tracing.

**Alerts**:
- p95 matching latency > 200ms for 2 consecutive minutes
- Driver staleness ratio > 1% (location pipeline degraded)
- Match expiry rate > 20% (driver acceptance UX issue)
- Error rate > 0.1%

---

## 11. Security Notes

**CSRF**: Not applicable. This API is consumed exclusively by mobile/driver clients using token-based authentication — not browser sessions. CSRF attacks require a browser cookie context, which does not exist here.

**Log injection**: Request paths are logged directly in development. In production, sanitize newline characters from `req.path` before logging to prevent log forging.

**SQL placeholders**: `findByGeohashes` builds a dynamic `IN (?, ?, ...)` clause by repeating `?` literals — not by interpolating user input. All values are passed as bound parameters to `better-sqlite3`, which prevents SQL injection.

---

## 10. Trade-offs & Alternatives

| Decision | Choice | Alternative | Reason |
|---|---|---|---|
| Spatial index | Geohash (pure JS) | H3, PostGIS | Zero native deps; swappable |
| Durable store | SQLite WAL | PostgreSQL | Simpler ops for take-home; same SQL |
| Concurrency guard | SQL WHERE NOT EXISTS | Redis SETNX, Mutex | No external dependency; atomic in SQLite |
| Event bus | In-memory + SQLite | Kafka | Sufficient for scope; Kafka interface documented |
| Location cache | In-memory Map | Redis | Single-process; Redis path documented |
| Matching | Synchronous in-request | Async queue | Lower latency; queue adds resilience at scale |

The in-memory spatial index is the most significant production risk: a crash loses the grid and requires a warm-up period. Mitigation: rebuild from SQLite on startup (all recent locations are persisted), and use Redis as the primary store in production.
