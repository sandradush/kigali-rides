import { RideResponse, MatchResponse } from './types';

export const API_BASE = 'http://192.168.1.72:3000';

let authToken: string | null = null;

export function setToken(token: string) { authToken = token; }
export function clearToken() { authToken = null; }

function authHeaders(): Record<string, string> {
  return authToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }
    : { 'Content-Type': 'application/json' };
}

async function post(path: string, body: object, auth = true): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: auth ? authHeaders() : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function register(
  email: string, password: string, role: 'driver' | 'passenger', name: string
): Promise<{ token: string; userId: string; role: string; name: string }> {
  return post('/auth/register', { email, password, role, name }, false);
}

export async function login(
  email: string, password: string
): Promise<{ token: string; userId: string; role: string; name: string }> {
  return post('/auth/login', { email, password }, false);
}

export async function updateDriverLocation(
  driverId: string, lat: number, lng: number,
  heading: number, speed: number, available: boolean
): Promise<void> {
  await post(`/drivers/${driverId}/location`, { lat, lng, heading, speed, available });
}

export async function requestRide(
  passengerId: string,
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number }
): Promise<RideResponse> {
  return post('/rides', { passengerId, pickup, dropoff });
}

export async function proposeMatch(requestId: string, driverId: string): Promise<MatchResponse> {
  return post(`/rides/${requestId}/match`, { driverId });
}

export async function confirmMatch(matchId: string, driverId: string): Promise<void> {
  await post(`/rides/matches/${matchId}/confirm`, { driverId });
}

export async function rejectMatch(matchId: string, driverId: string): Promise<void> {
  await post(`/rides/matches/${matchId}/reject`, { driverId });
}

export async function checkHealth(): Promise<{ status: string; drivers: number }> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}
