import { MatchResponse } from '../types';

interface Props {
  match: MatchResponse;
  onConfirm: () => void;
  onReject: () => void;
  loading: boolean;
  status: string | null;
}

export default function MatchPanel({ match, onConfirm, onReject, loading, status }: Props) {
  const expiresIn = Math.max(0, Math.round((match.expiresAt - Date.now()) / 1000));

  return (
    <div className="card match-panel">
      <h3>Match Proposed</h3>
      <div className="match-details">
        <div><span className="label">Match ID</span><span className="value mono">{match.matchId.slice(0, 8)}…</span></div>
        <div><span className="label">Driver</span><span className="value">{match.driverId}</span></div>
        <div><span className="label">Status</span><span className={`value status-${status ?? match.status}`}>{status ?? match.status}</span></div>
        <div><span className="label">Expires in</span><span className="value">{expiresIn}s</span></div>
      </div>

      {(status ?? match.status) === 'pending' && (
        <div className="match-actions">
          <button className="btn btn-success" onClick={onConfirm} disabled={loading}>
            {loading ? '…' : '✓ Confirm'}
          </button>
          <button className="btn btn-danger" onClick={onReject} disabled={loading}>
            {loading ? '…' : '✗ Reject'}
          </button>
        </div>
      )}

      {status === 'confirmed' && <p className="status-msg success">✅ Ride confirmed!</p>}
      {status === 'rejected' && <p className="status-msg warning">❌ Match rejected. Driver freed for re-matching.</p>}
    </div>
  );
}
