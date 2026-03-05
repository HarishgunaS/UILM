import React from 'react';
import './SessionSelector.css';

interface Session {
  id: string;
  name: string;
}

interface SessionSelectorProps {
  sessions: Session[];
  activeSessionId: string | undefined;
  onSelect: (sessionId: string) => void;
  onStop: () => void;
  onCreate: () => void;
  loading: boolean;
}

const SessionSelector: React.FC<SessionSelectorProps> = ({
  sessions,
  activeSessionId,
  onSelect,
  onStop,
  onCreate,
  loading,
}) => {
  return (
    <div className="session-selector">
      <button
        onClick={onCreate}
        disabled={loading}
        className="session-selector-create"
        title="Create a new session"
      >
        + New Session
      </button>
      <select
        value={activeSessionId || ''}
        onChange={(e) => {
          if (e.target.value) {
            onSelect(e.target.value);
          }
        }}
        disabled={loading}
        className="session-selector-select"
      >
        <option value="">Select a session</option>
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.name || session.id}
          </option>
        ))}
      </select>
      {activeSessionId && (
        <button
          onClick={onStop}
          disabled={loading}
          className="session-selector-stop"
        >
          Stop Session
        </button>
      )}
    </div>
  );
};

export default SessionSelector;
