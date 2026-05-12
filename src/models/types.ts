export interface Location {
  lat: number;
  lng: number;
}

export interface DriverLocation extends Location {
  driverId: string;
  heading: number;
  speed: number;
  timestamp: number;
  available: boolean;
  geohash?: string;
}

export interface RideRequest {
  requestId: string;
  passengerId: string;
  pickup: Location;
  dropoff: Location;
  timestamp: number;
}

export interface MatchCandidate {
  driverId: string;
  score: number;
  distance: number;
  eta: number;
  explanation: string;
  currentLocation: Location;
}

export interface MatchConfirmation {
  matchId: string;
  requestId: string;
  driverId: string;
  status: 'pending' | 'confirmed' | 'expired' | 'rejected';
  timestamp: number;
  expiresAt: number;
}

export enum EventType {
  DRIVER_LOCATION_UPDATED = 'DriverLocationUpdated',
  RIDE_REQUESTED = 'RideRequested',
  MATCH_PROPOSED = 'MatchProposed',
  MATCH_CONFIRMED = 'MatchConfirmed',
  MATCH_EXPIRED = 'MatchExpired',
  MATCH_REJECTED = 'MatchRejected'
}

export interface Event {
  eventId: string;
  type: EventType;
  timestamp: number;
  payload: any;
}
