import React, { useState } from 'react';
import './SessionViewer.css';

interface SessionViewerProps {
  url: string;
}

const SessionViewer: React.FC<SessionViewerProps> = ({ url }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = () => {
    setLoading(false);
    setError(null);
  };

  const handleError = () => {
    setLoading(false);
    setError('Failed to load session');
  };

  return (
    <div className="session-viewer">
      {loading && (
        <div className="session-viewer-loading">
          <p>Loading session...</p>
        </div>
      )}
      {error && (
        <div className="session-viewer-error">
          <p>{error}</p>
        </div>
      )}
      <iframe
        src={url}
        className="session-viewer-iframe"
        onLoad={handleLoad}
        onError={handleError}
        title="Session Viewer"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      />
    </div>
  );
};

export default SessionViewer;
