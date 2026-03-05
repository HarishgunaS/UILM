// Load environment variables from .env file first
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import sessionsRouter from './routes/sessions.js';
import agentRouter from './routes/agent.js';
import viteManager from './viteManager.js';
import graphManager from './langgraph/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
// Main app always runs in production mode (built static files)
// Only sessions run with Vite dev servers
const isProduction = true;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/sessions', sessionsRouter);
app.use('/api/agent', agentRouter);

// Convenience route for active session (matches frontend expectation)
app.get('/api/active-session', (req, res) => {
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

// Always serve built static files (main app is always in production mode)
const distPath = path.join(rootDir, 'dist');
app.use(express.static(distPath));

// Serve index.html for all non-API routes (SPA routing)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await viteManager.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await viteManager.shutdown();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Main app served from built static files');
  console.log('Sessions run with Vite dev servers (HMR enabled)');
});
