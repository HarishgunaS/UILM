# UILM

A React + Node.js application that manages multiple independent React sessions, each running in its own Vite dev server with HMR support.

## Architecture

- **Main App** (`src/`): Production-built React app with Express backend
- **Sessions** (`sessions/`): Independent React programs, each in its own folder
- **Shared** (`shared/`): React components shared across sessions

The main app spawns a Vite dev server pointing to the active session folder, which is rendered in an iframe with HMR support.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables (optional):
```bash
export VITE_SESSION_PORT=5173  # Port for spawned Vite dev servers
export PORT=3000                # Port for Express server
```

## Development

Run the main app:
```bash
npm run dev
```

This will:
- Build the main app (production build)
- Start the Express server on port 3000 serving the built app
- The server spawns Vite dev servers for sessions on demand (with HMR)
- Only session code has hot refresh - main app requires rebuild to see changes

## Production

Build and run in production mode:
```bash
npm run build
npm start
```

In production:
- Express server serves the built static files
- Express server handles API routes
- Sessions still run as Vite dev servers (spawned on demand)

## Usage

1. Start the application (`npm run dev`)
2. Open the main app in your browser (http://localhost:3000)
3. Select a session from the dropdown
4. The selected session will start a Vite dev server and render in an iframe
5. Edit session files to see HMR in action
6. To see changes to the main app, stop the server, rebuild (`npm run build`), and restart

## Creating a New Session

1. Create a new folder in `sessions/` (e.g., `sessions/002`)
2. Copy the structure from `sessions/001/`:
   - `package.json`
   - `vite.config.ts`
   - `index.html`
   - `tsconfig.json`
   - `src/` directory with your React code
3. The session will automatically appear in the session selector

## Shared Components

Place shared React components in `shared/components/` and import them in sessions using:
```typescript
import { ComponentName } from '@shared/components/ComponentName';
```

## Project Structure

```
UILM/
├── src/                    # Main React + Node.js app
│   ├── client/            # React frontend (production build)
│   ├── server/            # Express backend
│   ├── package.json
│   └── vite.config.ts     # Build config for main app
├── sessions/              # Session folders
│   └── {sessionId}/      # Each session is independent React code
│       ├── src/
│       ├── package.json
│       └── vite.config.ts # Vite config for this session
├── shared/                # Shared React components
│   └── components/
└── package.json           # Root workspace package.json
```
