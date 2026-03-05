import { Router, Request, Response } from 'express';
import graphManager from '../langgraph/manager.js';
import viteManager from '../viteManager.js';

const router = Router();

// Main entry point for LangGraph agent
router.post('/', async (req: Request, res: Response) => {
  try {
    // Get active session
    const activeSession = viteManager.getActiveSession();
    if (!activeSession) {
      return res.status(400).json({ 
        error: 'No active session. Please start a session first.' 
      });
    }

    const sessionId = activeSession.sessionId;
    const input = req.body;

    // Validate input format
    if (!input.text_input && !input.type && !input.route) {
      return res.status(400).json({ 
        error: 'Invalid input. Expected either {text_input: string} or {type, route, params}' 
      });
    }

    // Invoke the graph
    const result = await graphManager.invoke(sessionId, input);

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
    
    res.status(500).json({ 
      error: errorMessage,
      details: error instanceof Error ? error.message : String(error),
      isRetryable,
    });
  }
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
