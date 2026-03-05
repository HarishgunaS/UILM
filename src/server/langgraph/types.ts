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
}

export interface GraphInput {
  text_input?: string;
  type?: string;
  route?: string;
  params?: Record<string, any>;
}
