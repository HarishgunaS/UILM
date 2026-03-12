import { BaseMessage } from '@langchain/core/messages';

export interface AgentState {
  messages: BaseMessage[];
  sessionId: string;
  metadata?: {
    fileOperations?: Array<{
      type: 'read' | 'write' | 'list' | 'delete';
      path: string;
      timestamp: number;
    }>;
    lastModified?: number;
  };
  apiContext?: {
    type?: string;
    route?: string;
    params?: Record<string, any>;
    response?: any;
  };
  // Routing signal: when api_handler_agent wants to call coding_agent
  nextNode?: 'coding_agent' | 'end';
}

export interface GraphInput {
  text_input?: string;
  type?: string;
  route?: string;
  params?: Record<string, any>;
}
