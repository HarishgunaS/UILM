import React, { useState, useEffect } from 'react';
import SessionSelector from './components/SessionSelector';
import SessionViewer from './components/SessionViewer';
import './App.css';

interface Session {
  id: string;
  name: string;
}

interface ActiveSession {
  id: string;
  url: string;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchSessions();
    fetchActiveSession();
  }, []);

  const fetchSessions = async () => {
    try {
      const response = await fetch('/api/sessions');
      const data = await response.json();
      setSessions(data);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveSession = async () => {
    try {
      const response = await fetch('/api/active-session');
      if (response.ok) {
        const data = await response.json();
        if (data.id) {
          setActiveSession(data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch active session:', error);
    }
  };

  const handleSessionSelect = async (sessionId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/sessions/${sessionId}/start`, {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        setActiveSession({ id: sessionId, url: data.url });
      } else {
        console.error('Failed to start session');
      }
    } catch (error) {
      console.error('Failed to start session:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSessionStop = async () => {
    if (!activeSession) return;
    try {
      const response = await fetch(`/api/sessions/${activeSession.id}/stop`, {
        method: 'POST',
      });
      if (response.ok) {
        setActiveSession(null);
      }
    } catch (error) {
      console.error('Failed to stop session:', error);
    }
  };

  const handleSessionCreate = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/sessions/create', {
        method: 'POST',
      });
      if (response.ok) {
        const newSession = await response.json();
        // Refresh sessions list
        await fetchSessions();
        // Automatically start the new session
        await handleSessionSelect(newSession.id);
      } else {
        const error = await response.json();
        console.error('Failed to create session:', error);
        alert(`Failed to create session: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      alert('Failed to create session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && activeSession && !submitting) {
      setSubmitting(true);
      try {
        const response = await fetch('/api/agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text_input: inputValue,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Agent response:', data);
          setInputValue('');
        } else {
          const error = await response.json();
          console.error('Agent error:', error);
          alert(`Error: ${error.error || 'Failed to process request'}`);
        }
      } catch (error) {
        console.error('Failed to submit to agent:', error);
        alert('Failed to submit request. Please try again.');
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="app">
      <div className="app-header">
        <h1>UILM</h1>
        <SessionSelector
          sessions={sessions}
          activeSessionId={activeSession?.id}
          onSelect={handleSessionSelect}
          onStop={handleSessionStop}
          onCreate={handleSessionCreate}
          loading={loading}
        />
      </div>
      <div className="app-content">
        {activeSession ? (
          <>
            <SessionViewer url={activeSession.url} />
            <div className="app-input-container">
              <form onSubmit={handleSubmit} className="app-input-form">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Enter text..."
                  className="app-input"
                />
                <button 
                  type="submit" 
                  className="app-submit-button"
                  disabled={submitting || !inputValue.trim()}
                >
                  {submitting ? 'Processing...' : 'Submit'}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="no-session">
            <p>No active session. Select a session to begin.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
