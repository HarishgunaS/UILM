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
    const appTsx = `import React from 'react';
import './App.css';

function App() {
  return (
    <div className="app">
      <div className="container">
        <h1>Session ${newSessionId}</h1>
        <p>Welcome to your new session! Start building your React application.</p>
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

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: #fafafa;
}

#root {
  width: 100%;
  min-height: 100vh;
}
`;
    await writeFile(path.join(sessionPath, 'src/index.css'), indexCss, 'utf-8');

    // Create src/App.css
    const appCss = `.app {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.container {
  max-width: 800px;
  width: 100%;
  text-align: center;
}

h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
  color: #333;
}

p {
  font-size: 1.2rem;
  color: #666;
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
