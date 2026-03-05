import { createServer, ViteDevServer } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync } from 'fs';
import react from '@vitejs/plugin-react';
import graphManager from './langgraph/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// From src/server, go up two levels to reach UILM root
const rootDir = path.resolve(__dirname, '../..');

interface SessionServer {
  server: ViteDevServer;
  sessionId: string;
  url: string;
}

class ViteManager {
  private activeServer: SessionServer | null = null;

  async startSession(sessionId: string): Promise<string> {
    // Stop existing server if any
    if (this.activeServer) {
      await this.stopSession(this.activeServer.sessionId);
    }

    const sessionPath = path.join(rootDir, 'sessions', sessionId);
    const port = parseInt(process.env.VITE_SESSION_PORT || '5173', 10);
    const viteConfigPath = path.join(sessionPath, 'vite.config.ts');
    const indexHtmlPath = path.join(sessionPath, 'index.html');
    
    // Verify session folder exists and has required files
    if (!existsSync(sessionPath)) {
      throw new Error(`Session folder does not exist: ${sessionPath}`);
    }
    if (!existsSync(indexHtmlPath)) {
      throw new Error(`Session index.html does not exist: ${indexHtmlPath}`);
    }

    // Load the session's vite.config.ts if it exists
    // The key issue: Vite needs to resolve dependencies from workspace root
    // With npm workspaces, dependencies are hoisted to root node_modules
    
    console.log(`Starting Vite server for session ${sessionId} at ${sessionPath}`);
    
    // Ensure sessionPath is absolute
    const absoluteSessionPath = path.resolve(sessionPath);
    
    // Base config with our required settings
    const serverConfig: any = {
      root: absoluteSessionPath, // CRITICAL: Set root to session path
      // configFile will be set below if it exists
      server: {
        port,
        cors: true,
        strictPort: false,
        hmr: {
          port,
        },
        fs: {
          // Allow serving files from workspace root (for shared components)
          allow: ['..'],
        },
      },
      resolve: {
        alias: {
          '@shared': path.join(rootDir, 'shared'),
        },
        dedupe: ['react', 'react-dom'],
        preserveSymlinks: false,
      },
      optimizeDeps: {
        entries: [path.join(absoluteSessionPath, 'index.html')],
        // Let Vite discover and optimize dependencies naturally
        // It should find React in workspace root node_modules
        force: false, // Don't force re-optimization
      },
      // Use a cache directory that won't trigger tsx watch restarts
      cacheDir: path.join(rootDir, 'node_modules/.vite-sessions', sessionId),
      clearScreen: false,
    };

    // Don't load the config file - manually configure everything to avoid issues
    // This prevents React Refresh duplication and timestamp file creation
    serverConfig.configFile = false;
    serverConfig.plugins = [react()]; // Single React plugin instance
    
    console.log(`Server config root: ${serverConfig.root}`);
    console.log(`Index.html exists: ${existsSync(path.join(absoluteSessionPath, 'index.html'))}`);

    try {
      console.log('Creating Vite server...');
      console.log('Server config:', JSON.stringify({
        root: serverConfig.root,
        port: serverConfig.server.port,
        hasConfigFile: !!serverConfig.configFile,
        plugins: serverConfig.plugins?.length || 0,
      }, null, 2));
      
      const server = await createServer(serverConfig);
      console.log('Vite server created successfully');
      
      // Set up error handlers to prevent crashes
      server.ws.on('error', (error) => {
        console.error(`[Vite WS] Error for session ${sessionId}:`, error);
      });
      
      server.httpServer?.on('error', (error: any) => {
        console.error(`[Vite HTTP] Error for session ${sessionId}:`, error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
      });
      
      server.httpServer?.on('close', () => {
        console.warn(`[Vite HTTP] Server closed for session ${sessionId}`);
      });
      
      console.log(`Starting to listen on port ${port}...`);
      
      try {
        await server.listen();
        console.log(`✓ Vite server started for session ${sessionId} on port ${port}`);
        console.log(`✓ Server URL: http://localhost:${port}`);
        
        // Verify server is actually listening
        if (!server.httpServer?.listening) {
          throw new Error('Server httpServer is not listening after listen() call');
        }
        
        console.log(`✓ Server is listening: ${server.httpServer.listening}`);
        console.log(`✓ Server address: ${JSON.stringify(server.httpServer.address())}`);
      } catch (listenError) {
        console.error(`Failed during server.listen() for session ${sessionId}:`, listenError);
        if (listenError instanceof Error) {
          console.error('Listen error details:', listenError.message);
          console.error('Listen error stack:', listenError.stack);
        }
        throw listenError;
      }
      
      const url = `http://localhost:${port}`;

      this.activeServer = {
        server,
        sessionId,
        url,
      };

      // Initialize graph for this session
      graphManager.getOrCreateGraph(sessionId);

      return url;
    } catch (error) {
      console.error(`✗ Failed to start Vite server for session ${sessionId}:`, error);
      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      // Log the full error object
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      throw error;
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    if (this.activeServer && this.activeServer.sessionId === sessionId) {
      await this.activeServer.server.close();
      this.activeServer = null;
      // Clear graph state for this session
      graphManager.clearState(sessionId);
    }
  }

  getActiveSession(): SessionServer | null {
    return this.activeServer;
  }

  async shutdown(): Promise<void> {
    if (this.activeServer) {
      await this.activeServer.server.close();
      const sessionId = this.activeServer.sessionId;
      this.activeServer = null;
      // Clear graph state
      if (sessionId) {
        graphManager.clearState(sessionId);
      }
    }
  }
}

export default new ViteManager();
