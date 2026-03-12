import { Router, Request, Response } from 'express';
import graphManager from '../langgraph/manager.js';
import viteManager from '../viteManager.js';

const router = Router();

// Helper function to handle agent invocation (shared by GET and POST)
async function handleAgentRequest(req: Request, res: Response, input: any) {
  // Check if request is already aborted - if so, don't set up cancellation
  if (req.aborted || req.destroyed) {
    console.log(`[agent route] Request already aborted/destroyed, skipping cancellation setup`);
    return res.status(499).json({ 
      error: 'Request was cancelled',
      cancelled: true,
    });
  }
  
  // Create an AbortController to handle client-side cancellation
  const abortController = new AbortController();
  let requestCompleted = false;
  
  // Mark request as completed when response is sent
  res.on('finish', () => {
    requestCompleted = true;
  });
  
  // Listen for abort event - this fires when client explicitly aborts the request
  req.on('aborted', () => {
    if (!requestCompleted && !res.headersSent) {
      console.log('[agent route] Request aborted by client - aborting controller');
      abortController.abort();
    }
  });
  
  // Note: We don't listen to 'close' event because it can fire for various reasons
  // and req.aborted check in the 'aborted' event handler is sufficient

  try {
    // Get active session
    const activeSession = viteManager.getActiveSession();
    if (!activeSession) {
      return res.status(400).json({ 
        error: 'No active session. Please start a session first.' 
      });
    }

    const sessionId = activeSession.sessionId;

    // Validate input format
    if (!input.text_input && !input.type && !input.route) {
      return res.status(400).json({ 
        error: 'Invalid input. Expected either {text_input: string} or {type, route, params}' 
      });
    }

    // Invoke the graph with cancellation support
    const result = await graphManager.invoke(sessionId, input, abortController.signal);

    // Extract the last message as the response
    const lastMessage = result.messages[result.messages.length - 1];
    const responseContent = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : JSON.stringify(lastMessage.content);

    // Return response
    res.json({
      success: true,
      message: responseContent,
      state: {
        messageCount: result.messages.length,
        metadata: result.metadata,
        apiContext: result.apiContext,
      },
    });
  } catch (error) {
    // Check if request was cancelled
    if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      console.log('Agent request cancelled by client');
      if (!res.headersSent) {
        return res.status(499).json({ 
          error: 'Request cancelled',
          cancelled: true,
        });
      }
      return;
    }

    console.error('Error in agent route:', error);
    
    // Check if this is an OpenAI API error
    let errorMessage = 'Failed to process agent request';
    let isRetryable = false;
    
    if (error && typeof error === 'object' && 'status' in error) {
      const apiError = error as any;
      if (apiError.status === 500 || apiError.status === 503) {
        errorMessage = 'OpenAI API server error: The service is temporarily unavailable. Please try again in a few moments.';
        isRetryable = true;
      } else if (apiError.status === 429) {
        errorMessage = 'OpenAI API rate limit exceeded: Please wait a moment before trying again.';
        isRetryable = true;
      } else {
        errorMessage = apiError.message || `OpenAI API error (${apiError.status})`;
      }
    } else {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: errorMessage,
        details: error instanceof Error ? error.message : String(error),
        isRetryable,
      });
    }
  }
}

// GET endpoint - accepts prompt as query parameter
router.get('/', async (req: Request, res: Response) => {
  const prompt = req.query.prompt as string;
  
  if (!prompt) {
    return res.status(400).json({ 
      error: 'Missing required query parameter: prompt' 
    });
  }

  // Convert GET request to appropriate input format
  const input = {
    type: 'GET',
    route: '/query',
    params: { prompt },
  };

  await handleAgentRequest(req, res, input);
});

// Main entry point for LangGraph agent (POST)
router.post('/', async (req: Request, res: Response) => {
  const input = req.body;
  await handleAgentRequest(req, res, input);
});

// Get current state for active session
router.get('/state', async (req: Request, res: Response) => {
  try {
    const activeSession = viteManager.getActiveSession();
    if (!activeSession) {
      return res.status(400).json({ 
        error: 'No active session' 
      });
    }

    const state = await graphManager.getState(activeSession.sessionId);
    if (!state) {
      return res.json({ 
        messages: [],
        metadata: {},
      });
    }

    res.json({
      messages: state.messages.map(msg => ({
        type: msg.constructor.name,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      })),
      metadata: state.metadata,
      apiContext: state.apiContext,
    });
  } catch (error) {
    console.error('Error getting agent state:', error);
    res.status(500).json({ 
      error: 'Failed to get agent state',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
