import { Candidate } from '../types';

interface Props {
  candidates: Candidate[];
  selectedDriverId: string | null;
  onSelect: (driverId: string) => void;
  onPropose: () => void;
  proposing: boolean;
}

export default function CandidateList({ candidates, selectedDriverId, onSelect, onPropose, proposing }: Props) {
  if (candidates.length === 0) return null;

  return (
    <div className="card">
      <h3>Top Candidates</h3>
      <ul className="candidate-list">
        {candidates.map((c, i) => (
          <li
            key={c.driverId}
            className={`candidate-item ${selectedDriverId === c.driverId ? 'selected' : ''}`}
            onClick={() => onSelect(c.driverId)}
          >
            <div className="candidate-rank">#{i + 1}</div>
            <div className="candidate-info">
              <strong>{c.driverId}</strong>
              <span className="candidate-explanation">{c.explanation}</span>
            </div>
            <div className="candidate-score">
              <span className="score-badge">{c.score.toFixed(2)}</span>
            </div>
          </li>
        ))}
      </ul>
      {selectedDriverId && (
        <button className="btn btn-primary" onClick={onPropose} disabled={proposing}>
          {proposing ? 'Proposing…' : `Propose Match → ${selectedDriverId}`}
        </button>
      )}
    </div>
  );
}
