export interface Location {
  lat: number;
  lng: number;
}

export interface Candidate {
  driverId: string;
  score: number;
  distance: number;
  eta: number;
  explanation: string;
  currentLocation: Location;
}

export interface RideResponse {
  requestId: string;
  candidates: Candidate[];
  message?: string;
}

export interface MatchResponse {
  matchId: string;
  requestId: string;
  driverId: string;
  status: string;
  timestamp: number;
  expiresAt: number;
}

export interface Driver {
  driverId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  available: boolean;
}
