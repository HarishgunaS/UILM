import { AgentState } from './types.js';
import { createGraph } from './graph.js';
import { HumanMessage } from '@langchain/core/messages';
import abortRegistry from './abortRegistry.js';

class GraphManager {
  // Use ReturnType to infer the correct graph type from createGraph
  private graphs: Map<string, ReturnType<typeof createGraph>> = new Map();

  getOrCreateGraph(sessionId: string): ReturnType<typeof createGraph> {
    if (!this.graphs.has(sessionId)) {
      const graph = createGraph(sessionId);
      this.graphs.set(sessionId, graph);
    }
    
    return this.graphs.get(sessionId)!;
  }

  async invoke(sessionId: string, input: any, abortSignal?: AbortSignal): Promise<AgentState> {
    const graph = this.getOrCreateGraph(sessionId);

    // Clear any stale abort signal and store new one for this session
    abortRegistry.delete(sessionId);
    if (abortSignal) {
      abortRegistry.set(sessionId, abortSignal);
    }

    // Prepare state update (delta) based on input type
    // LangGraph will merge this with the checkpointed state
    const stateUpdate: Partial<AgentState> = {
      sessionId,
    };

    // Form 1: text_input from UI
    if (input.text_input) {
      stateUpdate.messages = [new HumanMessage(input.text_input)];
    }
    // Form 2: API call with type/route/params
    else if (input.type || input.route) {
      stateUpdate.apiContext = {
        type: input.type,
        route: input.route,
        params: input.params || {},
      };
      // Also add a message for context
      stateUpdate.messages = [
        new HumanMessage(`API call: ${input.type} ${input.route}`),
      ];
    }

    try {
      // Invoke the graph with checkpointing
      // thread_id is the sessionId - LangGraph uses this to track state
      const config = { configurable: { thread_id: sessionId } };
      const result = await graph.invoke(stateUpdate, config);
      
      // result is AgentState when invoked with checkpointing
      return result as AgentState;
    } finally {
      // Clean up abort signal after invocation
      if (abortSignal) {
        abortRegistry.delete(sessionId);
      }
    }
  }

  async getState(sessionId: string): Promise<AgentState | null> {
    const graph = this.getOrCreateGraph(sessionId);
    const config = { configurable: { thread_id: sessionId } };
    
    try {
      // Get the current state from checkpoint
      const state = await graph.getState(config);
      // state.values contains the AgentState
      return (state?.values as AgentState) || null;
    } catch (error) {
      // If no checkpoint exists yet, return null
      return null;
    }
  }

  async clearState(sessionId: string): Promise<void> {
    // Remove the graph from our cache
    // Note: MemorySaver doesn't have a direct delete method in the API
    // The checkpoint will remain in memory but won't be accessible through this manager
    this.graphs.delete(sessionId);
    
    // For a more complete implementation, you might want to use a checkpoint
    // that supports deletion (like SqliteSaver), or implement a custom checkpoint saver
  }

  hasGraph(sessionId: string): boolean {
    return this.graphs.has(sessionId);
  }
}

export default new GraphManager();
