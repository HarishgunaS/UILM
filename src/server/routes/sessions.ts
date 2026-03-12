import { Router, Request, Response } from 'express';
import { readdir, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import viteManager from '../viteManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const sessionsDir = path.join(rootDir, 'sessions');

const router = Router();

// Get all available sessions
router.get('/', async (req: Request, res: Response) => {
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const sessions = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: entry.name,
        name: entry.name,
      }));
    res.json(sessions);
  } catch (error) {
    console.error('Failed to list sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Start a session (spawn Vite server)
router.post('/:sessionId/start', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const url = await viteManager.startSession(sessionId);
    res.json({ id: sessionId, url });
  } catch (error) {
    console.error(`Failed to start session ${req.params.sessionId}:`, error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// Stop a session
router.post('/:sessionId/stop', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    await viteManager.stopSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error(`Failed to stop session ${req.params.sessionId}:`, error);
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

// Get active session info
router.get('/active-session', (req: Request, res: Response) => {
  const activeSession = viteManager.getActiveSession();
  if (activeSession) {
    res.json({
      id: activeSession.sessionId,
      url: activeSession.url,
    });
  } else {
    res.json({});
  }
});

// Create a new session with boilerplate
router.post('/create', async (req: Request, res: Response) => {
  try {
    // Get existing sessions to determine next session ID
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const existingSessions = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^\d+$/.test(name)) // Only numeric session IDs
      .map((name) => parseInt(name, 10))
      .sort((a, b) => a - b);

    // Find next available session ID
    let newSessionId = '001';
    if (existingSessions.length > 0) {
      const maxId = existingSessions[existingSessions.length - 1];
      newSessionId = String(maxId + 1).padStart(3, '0');
    }

    const sessionPath = path.join(sessionsDir, newSessionId);
    
    // Check if session already exists
    if (existsSync(sessionPath)) {
      return res.status(400).json({ error: `Session ${newSessionId} already exists` });
    }

    // Create session directory structure
    await mkdir(sessionPath, { recursive: true });
    await mkdir(path.join(sessionPath, 'src'), { recursive: true });

    // Create package.json
    const packageJson = {
      name: `uilm-session-${newSessionId}`,
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
      },
      devDependencies: {
        '@types/react': '^18.2.45',
        '@types/react-dom': '^18.2.18',
        '@vitejs/plugin-react': '^4.2.1',
        typescript: '^5.3.3',
        vite: '^5.0.8',
      },
    };
    await writeFile(
      path.join(sessionPath, 'package.json'),
      JSON.stringify(packageJson, null, 2),
      'utf-8'
    );

    // Create vite.config.ts
    const apiEndpoint = process.env.VITE_API_ENDPOINT || 'http://localhost:3000';
    const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: {
    port: parseInt(process.env.VITE_SESSION_PORT || '5173', 10),
    cors: true,
    hmr: {
      port: parseInt(process.env.VITE_SESSION_PORT || '5173', 10),
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../../shared'),
    },
  },
  define: {
    'import.meta.env.VITE_API_ENDPOINT': JSON.stringify('${apiEndpoint.replace(/'/g, "\\'")}'),
  },
});
`;
    await writeFile(path.join(sessionPath, 'vite.config.ts'), viteConfig, 'utf-8');

    // Create index.html
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Session ${newSessionId}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
    await writeFile(path.join(sessionPath, 'index.html'), indexHtml, 'utf-8');

    // Create tsconfig.json
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        forceConsistentCasingInFileNames: true,
        baseUrl: '.',
        paths: {
          '@shared/*': ['../../shared/*'],
        },
      },
      include: ['src'],
      exclude: ['node_modules'],
    };
    await writeFile(
      path.join(sessionPath, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2),
      'utf-8'
    );

    // Create src/main.tsx
    const mainTsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
    await writeFile(path.join(sessionPath, 'src/main.tsx'), mainTsx, 'utf-8');

    // Create src/App.tsx
    const appTsx = `import React, { useState } from 'react';
import './App.css';
// Example: Import shared components when needed
// import { Button } from '@shared/components/Button';

function App() {
  const [loading, setLoading] = useState(false);

  const handleAskQuestion = async () => {
    setLoading(true);
    try {
      const apiEndpoint = import.meta.env.VITE_API_ENDPOINT || 'http://localhost:3000';
      const response = await fetch(\`\${apiEndpoint}/api/agent\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'POST',
          route: '/query',
          params: { prompt: 'what can you do?' }
        })
      });
      if (!response.ok) {
        console.error('Request failed:', response.status);
      }
    } catch (error) {
      console.error('Error making request:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="container">
        <h1>Session ${newSessionId}</h1>
        <p>Welcome to your new session! Start building your React application.</p>
        <p style={{ fontSize: '0.9rem', opacity: 0.8, marginTop: '0.5rem' }}>
          Click the button below—the agent will update this page to show what it can do.
        </p>
        <button 
          className="interactive-button"
          onClick={handleAskQuestion}
          disabled={loading}
        >
          {loading ? 'Sending...' : 'What can you do?'}
        </button>
      </div>
    </div>
  );
}

export default App;
`;
    await writeFile(path.join(sessionPath, 'src/App.tsx'), appTsx, 'utf-8');

    // Create src/index.css
    const indexCss = `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --gradient-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --gradient-secondary: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  --gradient-accent: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  --color-text-light: #ffffff;
  --color-text-dark: #333333;
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#root {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}
`;
    await writeFile(path.join(sessionPath, 'src/index.css'), indexCss, 'utf-8');

    // Create src/App.css
    const appCss = `.app {
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: var(--gradient-primary);
  overflow: hidden;
}

.container {
  max-width: 800px;
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

h1 {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
  color: var(--color-text-light);
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.3s ease;
}

h1:hover {
  transform: scale(1.05);
}

p {
  font-size: 1.2rem;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
}

.interactive-button {
  padding: 0.75rem 2rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-light);
  background: var(--gradient-secondary);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition: all 0.3s ease;
  margin-top: 1rem;
}

.interactive-button:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

.interactive-button:active {
  transform: translateY(0);
  box-shadow: var(--shadow-sm);
}
`;
    await writeFile(path.join(sessionPath, 'src/App.css'), appCss, 'utf-8');

    console.log(`✓ Created new session: ${newSessionId}`);

    res.json({
      id: newSessionId,
      name: newSessionId,
    });
  } catch (error) {
    console.error('Failed to create session:', error);
    res.status(500).json({
      error: 'Failed to create session',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
