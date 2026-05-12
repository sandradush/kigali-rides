/**
 * Load simulation: measures matching latency under concurrent ride requests.
 * Targets: p95 ≤ 200ms, p99 ≤ 500ms
 *
 * Run: npx ts-node scripts/loadTest.ts
 */

import http from 'http';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const DRIVER_COUNT = 200;
const REQUEST_COUNT = 500;
const CONCURRENCY = 50;

// Kigali bounding box
const LAT_MIN = -2.0, LAT_MAX = -1.85;
const LNG_MIN = 29.95, LNG_MAX = 30.15;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function post(path: string, body: object): Promise<{ status: number; latencyMs: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const start = Date.now();
    const req = http.request(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, latencyMs: Date.now() - start, body: JSON.parse(raw || '{}') });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function seedDrivers(): Promise<void> {
  console.log(`Seeding ${DRIVER_COUNT} drivers...`);
  const batch: Promise<any>[] = [];
  for (let i = 0; i < DRIVER_COUNT; i++) {
    batch.push(post(`/drivers/driver-${i}/location`, {
      lat: rand(LAT_MIN, LAT_MAX),
      lng: rand(LNG_MIN, LNG_MAX),
      heading: rand(0, 360),
      speed: rand(0, 15),
      available: true
    }));
  }
  await Promise.all(batch);
  console.log('Drivers seeded.');
}

async function runConcurrent(tasks: (() => Promise<number>)[], concurrency: number): Promise<number[]> {
  const results: number[] = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const task = tasks[idx++];
      results.push(await task());
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  // Check server is up
  try {
    await post('/rides', {});
  } catch {
    console.error('Server not reachable at', BASE_URL);
    process.exit(1);
  }

  await seedDrivers();

  console.log(`\nRunning ${REQUEST_COUNT} ride requests at concurrency=${CONCURRENCY}...`);

  const tasks = Array.from({ length: REQUEST_COUNT }, () => async (): Promise<number> => {
    const { latencyMs } = await post('/rides', {
      passengerId: `p-${Math.random()}`,
      pickup: { lat: rand(LAT_MIN, LAT_MAX), lng: rand(LNG_MIN, LNG_MAX) },
      dropoff: { lat: rand(LAT_MIN, LAT_MAX), lng: rand(LNG_MIN, LNG_MAX) }
    });
    return latencyMs;
  });

  const latencies = await runConcurrent(tasks, CONCURRENCY);
  latencies.sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  console.log('\n=== Latency Results ===');
  console.log(`Requests:  ${REQUEST_COUNT}`);
  console.log(`p50:       ${p50}ms`);
  console.log(`p95:       ${p95}ms  (SLO: ≤200ms) ${p95 <= 200 ? '✓' : '✗'}`);
  console.log(`p99:       ${p99}ms  (SLO: ≤500ms) ${p99 <= 500 ? '✓' : '✗'}`);
  console.log(`avg:       ${avg}ms`);
  console.log(`min:       ${latencies[0]}ms`);
  console.log(`max:       ${latencies[latencies.length - 1]}ms`);

  // Location update throughput test
  console.log('\n=== Location Update Throughput ===');
  const locStart = Date.now();
  const LOC_COUNT = 500;
  const locTasks = Array.from({ length: LOC_COUNT }, (_, i) => () =>
    post(`/drivers/driver-${i % DRIVER_COUNT}/location`, {
      lat: rand(LAT_MIN, LAT_MAX), lng: rand(LNG_MIN, LNG_MAX),
      heading: rand(0, 360), speed: rand(0, 15), available: true
    }).then(r => r.latencyMs)
  );
  await runConcurrent(locTasks, 100);
  const elapsed = Date.now() - locStart;
  const throughput = Math.round((LOC_COUNT / elapsed) * 1000);
  console.log(`${LOC_COUNT} updates in ${elapsed}ms = ${throughput} updates/sec`);
}

main().catch(console.error);
