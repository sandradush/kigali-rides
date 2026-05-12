import { RideResponse, MatchResponse } from './types';

const BASE = '';

let authToken: string | null = localStorage.getItem('token');

export function setToken(token: string) {
  authToken = token;
  localStorage.setItem('token', token);
}

export function clearToken() {
  authToken = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export function getStoredUser(): { userId: string; role: string; name: string } | null {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

function authHeaders(): Record<string, string> {
  return authToken
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }
    : { 'Content-Type': 'application/json' };
}

export async function register(
  email: string, password: string, role: 'driver' | 'passenger', name: string
): Promise<{ token: string; userId: string; role: string; name: string }> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role, name }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

export async function login(
  email: string, password: string
): Promise<{ token: string; userId: string; role: string; name: string }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

export async function updateDriverLocation(
  driverId: string, lat: number, lng: number,
  heading: number, speed: number, available: boolean
): Promise<void> {
  await fetch(`${BASE}/drivers/${driverId}/location`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ lat, lng, heading, speed, available }),
  });
}

export async function requestRide(
  passengerId: string,
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number }
): Promise<RideResponse> {
  const res = await fetch(`${BASE}/rides`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ passengerId, pickup, dropoff }),
  });
  return res.json();
}

export async function proposeMatch(requestId: string, driverId: string): Promise<MatchResponse> {
  const res = await fetch(`${BASE}/rides/${requestId}/match`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ driverId }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'propose_failed'); }
  return res.json();
}

export async function confirmMatch(matchId: string, driverId: string): Promise<void> {
  const res = await fetch(`${BASE}/rides/matches/${matchId}/confirm`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ driverId }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'confirm_failed'); }
}

export async function rejectMatch(matchId: string, driverId: string): Promise<void> {
  const res = await fetch(`${BASE}/rides/matches/${matchId}/reject`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ driverId }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? 'reject_failed'); }
}

export async function checkHealth(): Promise<{ status: string; drivers: number }> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}
