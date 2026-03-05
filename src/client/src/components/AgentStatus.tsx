import React from 'react';
import './AgentStatus.css';

interface AgentStatusProps {
  onPause: () => void;
}

const AgentStatus: React.FC<AgentStatusProps> = ({ onPause }) => {
  return (
    <div className="agent-status">
      <div className="agent-status-content">
        <div className="agent-status-spinner">
          <div className="spinner"></div>
        </div>
        <span className="agent-status-text">Agent working...</span>
        <button 
          className="agent-status-pause-button"
          onClick={onPause}
          title="Pause agent"
        >
          ⏸
        </button>
      </div>
    </div>
  );
};

export default AgentStatus;
