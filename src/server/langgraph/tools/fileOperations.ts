import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import viteManager from '../../viteManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');

// Helper function to detect errors in tool results
export function hasErrors(toolResult: string): boolean {
  if (!toolResult || typeof toolResult !== 'string') {
    return false;
  }
  
  // Specific patterns that indicate actual errors (not just warnings)
  const errorPatterns = [
    /❌/,
    /\b(error|Error|ERROR)\b/,
    /\b(failed|Failed|FAILED)\b/,
    /\b(Could not|could not|cannot|Cannot)\b/,
    /\b(missing|Missing)\b/,
    /\b(removed|Removed)\b/,
    /\b(CRITICAL|critical)\b/,
  ];
  
  // Check for error patterns, but exclude false positives
  // Exclude normal HMR messages that contain "⚠" but aren't errors
  const hasErrorPattern = errorPatterns.some(pattern => pattern.test(toolResult));
  
  // Exclude false positives: normal HMR updates, successful operations
  const falsePositives = [
    '⚠ HMR full-reload', // Normal HMR behavior
    '⚠ Warning:', // Vite warnings that aren't errors
    '⚠ Error capturing', // Our own warning prefix, not an actual error
    '✓ HMR', // Successful HMR updates
  ];
  
  const isFalsePositive = falsePositives.some(fp => toolResult.includes(fp));
  
  return hasErrorPattern && !isFalsePositive;
}

// Helper function to capture Vite server output after file write
async function captureViteOutput(sessionId: string, filePath: string): Promise<string> {
  const activeSession = viteManager.getActiveSession();
  if (!activeSession || activeSession.sessionId !== sessionId) {
    return 'No active Vite server for this session';
  }

  const viteServer = activeSession.server;
  const sessionPath = path.join(rootDir, 'sessions', sessionId);
  const fullPath = path.resolve(path.join(sessionPath, filePath));
  
  // Normalize the path for Vite (use forward slashes)
  const relativePath = path.relative(sessionPath, fullPath).replace(/\\/g, '/');
  const viteUrl = `/${relativePath}`;

  const output: string[] = [];
  
  try {
    // Wait a bit for Vite's file watcher to detect the change
    await new Promise(resolve => setTimeout(resolve, 150));

    // Try to transform the file to trigger Vite's processing and capture any errors
    try {
      const result = await viteServer.transformRequest(viteUrl, { ssr: false });
      if (result) {
        output.push(`✓ File processed successfully by Vite`);
        
        // Check for warnings in the result
        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach((warning: any) => {
            output.push(`⚠ Warning: ${warning.message || String(warning)}`);
          });
        }
      }
    } catch (transformError: any) {
      // Capture transform/compile errors
      const errorMsg = transformError.message || String(transformError);
      output.push(`❌ Vite error: ${errorMsg}`);
      
      // Extract error location if available
      if (transformError.loc) {
        output.push(`   Location: line ${transformError.loc.line}, column ${transformError.loc.column}`);
      }
      
      // Include error code frame if available
      if (transformError.frame) {
        output.push(`   Code:\n${transformError.frame}`);
      }
      
      // Include stack trace for debugging (first few lines)
      if (transformError.stack) {
        const stackLines = transformError.stack.split('\n').slice(0, 5);
        output.push(`   Stack: ${stackLines.join('\n   ')}`);
      }
    }

    // Check Vite's module graph for this file to see if it was processed
    try {
      // Try to find the module in the graph by URL or file path
      const moduleNode = viteServer.moduleGraph.urlToModuleMap.get(viteUrl) ||
                        viteServer.moduleGraph.getModuleById(fullPath) ||
                        viteServer.moduleGraph.getModuleById(viteUrl);
      
      if (moduleNode) {
        // Check for transform errors in the module
        if (moduleNode.transformResult) {
          if ('error' in moduleNode.transformResult) {
            const error = (moduleNode.transformResult as any).error;
            output.push(`❌ Module transform error: ${error?.message || String(error)}`);
          } else {
            output.push(`✓ Module successfully transformed`);
          }
        }
        
        // Check HMR status
        if (moduleNode.lastHMRTimestamp) {
          output.push(`✓ HMR update timestamp: ${new Date(moduleNode.lastHMRTimestamp).toISOString()}`);
        }
      }
    } catch (moduleError) {
      // Module graph lookup failed, but that's okay
      // This might happen for new files or files not yet in the graph
    }

    // Listen for HMR updates via WebSocket
    // Use AbortController to properly clean up listeners and prevent memory leaks
    const abortController = new AbortController();
    const signal = abortController.signal;
    
    return new Promise((resolve) => {
      let resolved = false;
      
      // Cleanup function to remove listeners
      const cleanup = () => {
        try {
          viteServer.ws.off('update', handleUpdate);
          viteServer.ws.off('error', handleError);
        } catch (e) {
          // Ignore errors during cleanup
        }
      };
      
      // Safe resolve wrapper that prevents double resolution
      const safeResolve = (value: string) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(value);
        }
      };

      const timeout = setTimeout(() => {
        const finalOutput = output.length > 0 
          ? output.join('\n') 
          : 'File written. Vite detected the change.';
        safeResolve(finalOutput);
      }, 1200); // Increased timeout to capture more Vite output

      const handleUpdate = (payload: any) => {
        if (signal.aborted || resolved) return;
        
        if (payload.updates) {
          const relevantUpdate = payload.updates.find((update: any) => 
            update.path && (update.path === viteUrl || update.path.includes(relativePath))
          );
          
          if (relevantUpdate) {
            const updateType = relevantUpdate.type || 'update';
            const updatePath = relevantUpdate.path;
            
            // Check for error indicators in update type
            // Note: 'full-reload' is normal for certain changes, only treat 'error' as actual error
            if (updateType === 'error') {
              output.push(`⚠ HMR error: ${updatePath}`);
              
              // Extract error message if available
              if (relevantUpdate.err) {
                const errorMsg = relevantUpdate.err.message || String(relevantUpdate.err);
                output.push(`❌ Error details: ${errorMsg}`);
              }
              
              // Check for common error patterns in the update
              if (relevantUpdate.err?.message) {
                const errMsg = relevantUpdate.err.message.toLowerCase();
                if (errMsg.includes('export') && errMsg.includes('removed')) {
                  output.push(`❌ CRITICAL: Export statement removed. React components must have 'export default' statement.`);
                }
                if (errMsg.includes('fast refresh')) {
                  output.push(`❌ CRITICAL: Fast Refresh failed. This usually means the component structure was broken.`);
                }
              }
            } else if (updateType === 'full-reload') {
              // Full reload is normal, just log it without error indicator
              output.push(`✓ HMR full-reload: ${updatePath}`);
            } else {
              output.push(`✓ HMR update sent: ${updateType} for ${updatePath}`);
            }
            
            // Extract additional error/warning information from update metadata (only if there's an actual error)
            if (relevantUpdate.err && updateType === 'error') {
              output.push(`❌ Update error: ${JSON.stringify(relevantUpdate.err)}`);
            }
            
            clearTimeout(timeout);
            abortController.abort();
            safeResolve(output.join('\n'));
          }
        }
      };

      const handleError = (error: any) => {
        if (signal.aborted || resolved) return;
        
        if (error.message && error.message.includes(relativePath)) {
          output.push(`❌ HMR error: ${error.message}`);
          
          // Extract more error details
          if (error.stack) {
            const stackLines = error.stack.split('\n').slice(0, 3);
            output.push(`   Stack: ${stackLines.join('\n   ')}`);
          }
          
          clearTimeout(timeout);
          abortController.abort();
          safeResolve(output.join('\n'));
        }
      };

      // Add event listeners - cleanup function ensures they're removed properly
      try {
        viteServer.ws.on('update', handleUpdate);
        viteServer.ws.on('error', handleError);
      } catch (error) {
        // If adding listeners fails, resolve immediately without HMR monitoring
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[captureViteOutput] Failed to add WebSocket listeners: ${errorMsg}`);
        safeResolve('File written. Vite detected the change. (HMR monitoring unavailable)');
      }
      
      // Ensure cleanup on abort
      signal.addEventListener('abort', cleanup);
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return output.length > 0 
      ? output.join('\n') + `\n⚠ Error capturing Vite output: ${errorMsg}`
      : `⚠ Error capturing Vite output: ${errorMsg}`;
  }
}

export function createFileOperationTools(sessionId: string) {
  const sessionPath = path.join(rootDir, 'sessions', sessionId);

  const readFileTool = new DynamicStructuredTool({
    name: 'read_file',
    description: 'Read the contents of a file from the session folder. Provide a relative path from the session root.',
    schema: z.object({
      filePath: z.string().describe('Relative path to the file from the session root (e.g., "src/App.tsx")'),
    }),
    func: async ({ filePath }) => {
      try {
        const fullPath = path.join(sessionPath, filePath);
        // Security: Ensure the path is within the session directory
        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(sessionPath))) {
          return `Error: Path outside session directory: ${filePath}`;
        }
        
        if (!existsSync(resolvedPath)) {
          return `Error: File does not exist: ${filePath}`;
        }
        
        const content = await readFile(resolvedPath, 'utf-8');
        return content;
      } catch (error) {
        return `Error reading file ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });

  const writeFileTool = new DynamicStructuredTool({
    name: 'write_file',
    description: 'Write or modify a file in the session folder. Provide a relative path from the session root and the content to write. The Vite server will automatically detect the change and the console output will be included in the response.',
    schema: z.object({
      filePath: z.string().describe('Relative path to the file from the session root (e.g., "src/App.tsx")'),
      content: z.string().describe('The content to write to the file'),
    }),
    func: async ({ filePath, content }) => {
      try {
        console.log(`[write_file] Tool called for session ${sessionId}, file: ${filePath}`);
        const fullPath = path.join(sessionPath, filePath);
        // Security: Ensure the path is within the session directory
        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(sessionPath))) {
          const error = `Error: Path outside session directory: ${filePath}`;
          console.error(`[write_file] ${error}`);
          return error;
        }
        
        // Ensure directory exists
        const dir = path.dirname(resolvedPath);
        if (!existsSync(dir)) {
          const error = `Error: Directory does not exist: ${path.dirname(filePath)}`;
          console.error(`[write_file] ${error}`);
          return error;
        }
        
        console.log(`[write_file] Writing file to: ${resolvedPath}`);
        // Write the file
        await writeFile(resolvedPath, content, 'utf-8');
        console.log(`[write_file] File written successfully: ${filePath}`);
        
        // Verify file was written
        if (!existsSync(resolvedPath)) {
          const error = `Error: File was not created: ${filePath}`;
          console.error(`[write_file] ${error}`);
          return error;
        }
        
        // Capture Vite server output
        const viteOutput = await captureViteOutput(sessionId, filePath);
        console.log(`[write_file] Vite output captured for ${filePath}`);
        
        // Combine the success message with Vite output
        const baseMessage = `Successfully wrote to ${filePath}`;
        if (viteOutput && viteOutput !== 'File written. Vite detected the change.') {
          return `${baseMessage}\n\nVite Server Output:\n${viteOutput}`;
        }
        return `${baseMessage}\n\n${viteOutput}`;
      } catch (error) {
        const errorMsg = `Error writing file ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[write_file] ${errorMsg}`, error);
        return errorMsg;
      }
    },
  });

  const listFilesTool = new DynamicStructuredTool({
    name: 'list_files',
    description: 'List files and directories in a directory within the session folder. Provide a relative path from the session root, or "." for the root.',
    schema: z.object({
      dirPath: z.string().optional().nullable().default('.').describe('Relative path to the directory from the session root (default: ".")'),
    }),
    func: async ({ dirPath }) => {
      try {
        const actualDirPath = dirPath ?? '.';
        const fullPath = path.join(sessionPath, actualDirPath);
        // Security: Ensure the path is within the session directory
        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(sessionPath))) {
          return `Error: Path outside session directory: ${actualDirPath}`;
        }
        
        if (!existsSync(resolvedPath)) {
          return `Error: Directory does not exist: ${actualDirPath}`;
        }
        
        const entries = await readdir(resolvedPath, { withFileTypes: true });
        const result = entries.map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        }));
        
        return JSON.stringify(result, null, 2);
      } catch (error) {
        const actualDirPath = dirPath ?? '.';
        return `Error listing directory ${actualDirPath}: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });

  const getRenderedHtmlTool = new DynamicStructuredTool({
    name: 'get_rendered_html',
    description: 'Fetch the rendered HTML content from the Vite dev server to verify the UI looks correct. This helps detect if there are runtime errors or if the UI is not rendering properly.',
    schema: z.object({}),
    func: async () => {
      try {
        const activeSession = viteManager.getActiveSession();
        if (!activeSession || activeSession.sessionId !== sessionId) {
          return 'Error: No active Vite server for this session';
        }

        const url = activeSession.url;
        console.log(`[get_rendered_html] Fetching HTML from ${url}`);

        // Fetch the HTML from the Vite dev server
        const response = await fetch(url, {
          headers: {
            'Accept': 'text/html',
          },
        });

        if (!response.ok) {
          return `Error: Failed to fetch HTML. Status: ${response.status} ${response.statusText}`;
        }

        const html = await response.text();
        console.log(`[get_rendered_html] Successfully fetched HTML (${html.length} characters)`);

        // Extract just the body content if possible, or return the full HTML
        // Look for the root div to see if React rendered properly
        const rootDivMatch = html.match(/<div[^>]*id=["']root["'][^>]*>([\s\S]*?)<\/div>/i);
        if (rootDivMatch) {
          const rootContent = rootDivMatch[1].trim();
          if (rootContent.length === 0) {
            return `⚠ Warning: Root div is empty. The React app may not be rendering.\n\nFull HTML preview (first 1000 chars):\n${html.substring(0, 1000)}`;
          }
          return `✓ HTML fetched successfully. Root content:\n${rootContent}\n\nFull HTML preview (first 2000 chars):\n${html.substring(0, 2000)}`;
        }

        return `✓ HTML fetched successfully (${html.length} characters). Preview (first 2000 chars):\n${html.substring(0, 2000)}`;
      } catch (error) {
        const errorMsg = `Error fetching rendered HTML: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[get_rendered_html] ${errorMsg}`, error);
        return errorMsg;
      }
    },
  });

  const completeTaskTool = new DynamicStructuredTool({
    name: 'complete_task',
    description: 'Signal that the task is complete and you are done making changes. Call this when you have finished all necessary code modifications and there are no errors. This will stop the agent loop.',
    schema: z.object({
      message: z.string().nullable().optional().describe('Optional completion message summarizing what was accomplished'),
    }),
    func: async ({ message }) => {
      const completionMsg = message || 'Task completed successfully.';
      console.log(`[complete_task] Task completion signaled: ${completionMsg}`);
      return `✓ ${completionMsg}`;
    },
  });

  // Note: getRenderedHtmlTool is available but not exposed to LLM to prevent verification loops
  return [readFileTool, writeFileTool, listFilesTool, completeTaskTool];
}
