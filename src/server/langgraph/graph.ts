import { StateGraph, END, START } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, BaseMessage, ToolMessage, SystemMessage } from '@langchain/core/messages';
import { AgentState } from './types.js';
import { createFileOperationTools, hasErrors } from './tools/fileOperations.js';
import abortRegistry from './abortRegistry.js';

// Shared checkpoint memory for all graphs (in-memory storage)
// In production, you might want to use a persistent checkpoint like SqliteSaver
const checkpointMemory = new MemorySaver();

export function createGraph(sessionId: string) {
  // Initialize LLM - using OpenAI, can be configured via environment variables
  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || 'gpt-5.2',
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
    // Configure retry behavior for transient errors
    maxRetries: parseInt(process.env.OPENAI_MAX_RETRIES || '7'),
    timeout: parseInt(process.env.OPENAI_TIMEOUT || '60000'), // 60 seconds default
  });

  // Create file operation tools for this session
  const fileTools = createFileOperationTools(sessionId);

  // Routing function to determine which node to go to
  const routeInput = (state: AgentState): string => {
    // Check if this is an API call (has apiContext with type/route/params)
    if (state.apiContext?.type || state.apiContext?.route) {
      return 'api_handler_agent';
    }
    
    // Check messages for text input
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof HumanMessage) {
      // If it's a text input, route to coding agent
      return 'coding_agent';
    }
    
    // Default to coding agent
    return 'coding_agent';
  };

  // Coding agent node - handles text input and modifies code
  const codingAgentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const nodeStartTime = Date.now();
    
    // Bind tools to the model for OpenAI function calling
    const bindToolsStartTime = Date.now();
    const modelWithTools = model.bindTools(fileTools);
    const bindToolsTime = Date.now() - bindToolsStartTime;
    console.log(`[coding_agent] ⏱️  Tool binding took ${bindToolsTime}ms`);

    // Extract input from the last human message
    const lastMessage = state.messages[state.messages.length - 1];
    const userInput = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : JSON.stringify(lastMessage.content);

    // Build messages array from state (excluding the last message which we're processing)
    const buildMessagesStartTime = Date.now();
    const messages: BaseMessage[] = [
      new SystemMessage({
        content: `You are a coding assistant that helps modify React code in a session folder.

CRITICAL: Your text output will NEVER be seen by the user. To communicate with the user, you MUST always use tools to edit the code. The user will see the results rendered by the code, not your text responses.

IMPORTANT: You must INTERPRET and RESPOND to user requests, not just echo them back. For example:
- If the user asks "how are you?", you should modify the code to display a friendly response like "I'm doing well, thank you for asking!" or "Hello! I'm here to help you build React applications."
- If the user says "hello", you should modify the code to display a greeting response, not just the word "hello"
- If the user asks a question, you should modify the code to display an appropriate answer
- If the user makes a request, you should modify the code to fulfill that request

Your task is to understand what the user is asking or saying, and then modify the React code to respond appropriately. The code should show YOUR response to the user, not just repeat their input.

CRITICAL: INCREMENTAL CHANGES REQUIRED - USER SEES CHANGES IN REAL-TIME
The user sees changes appear LIVE as you make them. Making one large change makes the UI feel frozen and unresponsive.

BAD: Making one huge diff with all content at once → User waits 20+ seconds seeing nothing, then everything appears at once (feels broken)
GOOD: Making 10+ tiny tool calls in sequence → User sees content appear piece by piece in real-time (feels responsive and alive)

YOU MUST:
1. Make MANY tiny tool calls (one per iteration), each changing only 1-2 lines or adding 1-2 sentences
2. Continue making incremental changes across multiple iterations
3. Only call complete_task when you've finished ALL the incremental changes for the user's request
4. Each iteration should make ONE small change, then continue to the next iteration

EXAMPLE WORKFLOW for "teach me about organic chemistry":
  Iteration 1: Change title from "Session 010" to "Organic Chemistry" → continue to next iteration
  (User sees title change immediately via HMR)
  
  Iteration 2: Add first sentence "Organic chemistry is..." → continue to next iteration  
  (User sees first sentence appear)
  
  Iteration 3: Add second sentence "It explains..." → continue to next iteration
  (User sees second sentence appear)
  
  Iteration 4: Add heading "1) Why carbon is special" → continue to next iteration
  (User sees heading appear)
  
  Iteration 5: Add first bullet point → continue to next iteration
  (User sees first bullet appear)
  
  Iteration 6-15: Continue adding content piece by piece → finally call complete_task when done
  (User sees content building incrementally)

ABSOLUTE RULES:
- NEVER make a diff/patch that changes more than 1-3 lines at once
- NEVER add more than 1-2 sentences of content in one tool call
- NEVER add more than 1 heading or 1-2 list items at once
- Make MANY iterations (10-15+) with tiny changes each, not 1-2 iterations with huge changes
- Only call complete_task ONCE at the very end when all incremental changes are complete

TOOL SELECTION FOR INCREMENTAL CHANGES:
1. find_and_replace: Change 1 word or 1 short phrase (max 1-2 sentences)
2. patch_file: Replace exact match of 1-2 lines max
3. apply_unified_diff: ONLY for adding/changing 1-2 lines total
4. write_file: NEVER use for existing files - only for creating brand new empty files

You have access to read_file, write_file, list_files, find_and_replace, patch_file, apply_unified_diff, and complete_task tools to interact with the session codebase.
Always read relevant files first to understand the current code structure before making changes.
Be precise and only modify what is necessary based on the user's request.

CRITICAL: After writing files, ALWAYS check the tool response for errors or warnings. If you see error messages (like "❌", "Error", "Could not Fast Refresh", "export removed", etc.), you MUST fix them immediately by reading the file, understanding the issue, and writing a corrected version. Common issues:
- Missing "export default" statement in React components
- Syntax errors
- Import/export mismatches
- Fast Refresh failures

CRITICAL: Make MANY tiny changes across multiple iterations, then call complete_task ONCE at the end.
- Make one tiny change per iteration (change title, add one sentence, add one heading, etc.)
- Continue to the next iteration to make the next tiny change
- Keep making incremental changes until the user's request is fulfilled
- Only call complete_task ONCE at the very end when all incremental changes are done
- The UI updates in real-time via HMR after each tool call, so the user sees progress as you work

Remember: Never respond with text alone. Always use tools to edit code so the user can see your response rendered in the UI. The code should show YOUR response to the user's input, not echo their input back.`,
      }),
      new HumanMessage({
        content: userInput,
      }),
    ];

    // Add previous messages (excluding the last one)
    const previousMessages = state.messages.slice(0, -1);
    messages.unshift(...previousMessages);
    const buildMessagesTime = Date.now() - buildMessagesStartTime;
    console.log(`[coding_agent] ⏱️  Building messages took ${buildMessagesTime}ms (${messages.length} total messages)`);

    const intermediateSteps: any[] = [];
    let finalResponse: AIMessage | null = null;
    let iterationCount = 0;
    const maxIterations = 200; // High limit to allow many incremental changes
    const iterationTimings: Array<{ iteration: number; totalTime: number; modelTime: number; toolsTime: number; toolCount: number }> = [];

    try {
      console.log(`[coding_agent] Starting agent loop for session ${sessionId} with input: ${userInput.substring(0, 100)}...`);

      while (iterationCount < maxIterations) {
        const iterationStartTime = Date.now();
        iterationCount++;
        console.log(`[coding_agent] Iteration ${iterationCount}/${maxIterations}`);

        // Check for cancellation before calling the model
        // Only check if a signal exists (meaning a request is active) and is actually aborted
        const abortSignal = abortRegistry.get(sessionId);
        if (abortSignal && abortSignal.aborted) {
          console.log(`[coding_agent] Cancellation detected (signal aborted: true), exiting agent loop`);
          finalResponse = new AIMessage('Agent execution cancelled by user.');
          break;
        }
        
        // If no signal exists, this might be a stale/old request, but continue anyway
        // (the signal should be set by the time we get here, but if not, proceed)

        // Call the model
        const modelInvokeStartTime = Date.now();
        const response = await modelWithTools.invoke(messages);
        const modelInvokeTime = Date.now() - modelInvokeStartTime;
        console.log(`[coding_agent] ⏱️  Model invocation took ${modelInvokeTime}ms. Tool calls: ${response.tool_calls?.length || 0}`);

        // Add the AI response to messages
        const addResponseStartTime = Date.now();
        messages.push(response);
        const addResponseTime = Date.now() - addResponseStartTime;
        if (addResponseTime > 1) {
          console.log(`[coding_agent] ⏱️  Adding response to messages took ${addResponseTime}ms`);
        }

        // Check if there are tool calls
        if (response.tool_calls && response.tool_calls.length > 0) {
          console.log(`[coding_agent] Executing ${response.tool_calls.length} tool call(s)`);
          const toolsStartTime = Date.now();

          // Check if complete_task was called - if so, execute it and break
          const completionCall = response.tool_calls.find(tc => tc.name === 'complete_task');
          if (completionCall) {
            console.log(`[coding_agent] Completion signal received. Executing complete_task...`);
            const tool = fileTools.find(t => t.name === 'complete_task');
            if (tool) {
              try {
                const completeTaskStartTime = Date.now();
                const result = await tool.invoke(completionCall.args);
                const completeTaskTime = Date.now() - completeTaskStartTime;
                console.log(`[coding_agent] ⏱️  complete_task execution took ${completeTaskTime}ms`);
                
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                console.log(`[coding_agent] ${resultStr}`);
                
                // Add tool result to messages for tracking
                messages.push(
                  new ToolMessage({
                    content: resultStr,
                    tool_call_id: completionCall.id,
                  })
                );
                
                finalResponse = new AIMessage(resultStr);
                const toolsTime = Date.now() - toolsStartTime;
                const iterationTime = Date.now() - iterationStartTime;
                iterationTimings.push({
                  iteration: iterationCount,
                  totalTime: iterationTime,
                  modelTime: modelInvokeTime,
                  toolsTime: toolsTime,
                  toolCount: 1,
                });
                console.log(`[coding_agent] ⏱️  Iteration ${iterationCount} total time: ${iterationTime}ms (model: ${modelInvokeTime}ms, tools: ${toolsTime}ms)`);
                break;
              } catch (error) {
                console.error(`[coding_agent] Error executing complete_task:`, error);
                const errorMsg = `Error executing complete_task: ${error instanceof Error ? error.message : String(error)}`;
                messages.push(
                  new ToolMessage({
                    content: errorMsg,
                    tool_call_id: completionCall.id,
                  })
                );
                // Continue loop if completion failed
              }
            }
          }

          // Execute each tool call
          for (const toolCall of response.tool_calls) {
            const toolName = toolCall.name;
            const toolArgs = toolCall.args;
            const toolCallId = toolCall.id;

            // Skip complete_task if we already handled it above
            if (toolName === 'complete_task' && completionCall) {
              continue;
            }

            console.log(`[coding_agent] Executing tool: ${toolName}`, toolArgs);

            // Find the tool
            const findToolStartTime = Date.now();
            const tool = fileTools.find(t => t.name === toolName);
            const findToolTime = Date.now() - findToolStartTime;
            if (findToolTime > 1) {
              console.log(`[coding_agent] ⏱️  Finding tool ${toolName} took ${findToolTime}ms`);
            }
            
            if (!tool) {
              const errorMsg = `Tool ${toolName} not found`;
              console.error(`[coding_agent] ${errorMsg}`);
              messages.push(
                new ToolMessage({
                  content: errorMsg,
                  tool_call_id: toolCallId,
                })
              );
              continue;
            }

            // Execute the tool
            try {
              const toolInvokeStartTime = Date.now();
              const toolResult = await tool.invoke(toolArgs);
              const toolInvokeTime = Date.now() - toolInvokeStartTime;
              console.log(`[coding_agent] ⏱️  Tool ${toolName} execution took ${toolInvokeTime}ms`);
              
              const toolResultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
              
              // Check for errors in tool result
              const errorCheckStartTime = Date.now();
              const hasError = hasErrors(toolResultStr);
              const errorCheckTime = Date.now() - errorCheckStartTime;
              if (errorCheckTime > 1) {
                console.log(`[coding_agent] ⏱️  Error checking for ${toolName} took ${errorCheckTime}ms`);
              }
              
              if (hasError) {
                console.log(`[coding_agent] ⚠ Errors detected in tool ${toolName} result`);
              } else {
                console.log(`[coding_agent] Tool ${toolName} completed successfully`);
              }
              
              // Add tool result to messages
              messages.push(
                new ToolMessage({
                  content: toolResultStr,
                  tool_call_id: toolCallId,
                })
              );

              // Track intermediate step
              intermediateSteps.push({
                action: { tool: toolName, toolInput: toolArgs },
                observation: toolResultStr,
                hasError,
              });
            } catch (toolError) {
              const errorMsg = `Error executing ${toolName}: ${toolError instanceof Error ? toolError.message : String(toolError)}`;
              console.error(`[coding_agent] ${errorMsg}`);
              messages.push(
                new ToolMessage({
                  content: errorMsg,
                  tool_call_id: toolCallId,
                })
              );
              
              // Track intermediate step with error
              intermediateSteps.push({
                action: { tool: toolName, toolInput: toolArgs },
                observation: errorMsg,
                hasError: true,
              });
            }
          }

          const toolsTime = Date.now() - toolsStartTime;
          const errorCheckStartTime = Date.now();
          // Check if any tool results contained errors
          const hasAnyErrors = intermediateSteps.some(step => step.hasError);
          const errorCheckTime = Date.now() - errorCheckStartTime;
          if (errorCheckTime > 1) {
            console.log(`[coding_agent] ⏱️  Checking for errors in all tool results took ${errorCheckTime}ms`);
          }
          
          if (hasAnyErrors) {
            console.log(`[coding_agent] ⚠ Errors detected in tool results. Continuing iteration to fix issues...`);
            // Add a message prompting the model to fix errors
            messages.push(
              new HumanMessage({
                content: 'The previous tool execution resulted in errors or warnings. Please read the error messages carefully and fix the issues by modifying the code appropriately.',
              })
            );
            
            const iterationTime = Date.now() - iterationStartTime;
            iterationTimings.push({
              iteration: iterationCount,
              totalTime: iterationTime,
              modelTime: modelInvokeTime,
              toolsTime: toolsTime,
              toolCount: response.tool_calls.length,
            });
            console.log(`[coding_agent] ⏱️  Iteration ${iterationCount} total time: ${iterationTime}ms (model: ${modelInvokeTime}ms, tools: ${toolsTime}ms)`);
            // Continue the loop to fix errors
            continue;
          }

          const iterationTime = Date.now() - iterationStartTime;
          iterationTimings.push({
            iteration: iterationCount,
            totalTime: iterationTime,
            modelTime: modelInvokeTime,
            toolsTime: toolsTime,
            toolCount: response.tool_calls.length,
          });
          console.log(`[coding_agent] ⏱️  Iteration ${iterationCount} total time: ${iterationTime}ms (model: ${modelInvokeTime}ms, tools: ${toolsTime}ms)`);
          // Continue the loop to let the model process tool results
          continue;
        } else {
          // No tool calls - check if we have any errors from previous steps
          const errorCheckStartTime = Date.now();
          const hasAnyErrors = intermediateSteps.some(step => step.hasError);
          const errorCheckTime = Date.now() - errorCheckStartTime;
          if (errorCheckTime > 1) {
            console.log(`[coding_agent] ⏱️  Checking for errors took ${errorCheckTime}ms`);
          }
          
          if (hasAnyErrors) {
            // We have errors but model didn't make tool calls - prompt it to fix
            console.log(`[coding_agent] ⚠ Errors exist but no tool calls made. Prompting model to fix...`);
            messages.push(
              new HumanMessage({
                content: 'There are still errors from previous tool executions. Please use tools to read the files and fix the issues.',
              })
            );
            
            const iterationTime = Date.now() - iterationStartTime;
            iterationTimings.push({
              iteration: iterationCount,
              totalTime: iterationTime,
              modelTime: modelInvokeTime,
              toolsTime: 0,
              toolCount: 0,
            });
            console.log(`[coding_agent] ⏱️  Iteration ${iterationCount} total time: ${iterationTime}ms (model: ${modelInvokeTime}ms, no tools)`);
            // Continue iteration to give model a chance to fix errors
            continue;
          }
          
          // No tool calls and no errors - this is the final response
          finalResponse = response;
          const iterationTime = Date.now() - iterationStartTime;
          iterationTimings.push({
            iteration: iterationCount,
            totalTime: iterationTime,
            modelTime: modelInvokeTime,
            toolsTime: 0,
            toolCount: 0,
          });
          console.log(`[coding_agent] ⏱️  Iteration ${iterationCount} total time: ${iterationTime}ms (model: ${modelInvokeTime}ms, no tools)`);
          console.log(`[coding_agent] Final response received: ${response.content?.substring(0, 200)}...`);
          break;
        }
      }

      if (iterationCount >= maxIterations) {
        console.warn(`[coding_agent] Reached max iterations (${maxIterations})`);
        finalResponse = new AIMessage('Maximum iterations reached. Please try a simpler request.');
      }

      if (!finalResponse) {
        finalResponse = new AIMessage('No response generated.');
      }

      const nodeTotalTime = Date.now() - nodeStartTime;
      const totalModelTime = iterationTimings.reduce((sum, t) => sum + t.modelTime, 0);
      const totalToolsTime = iterationTimings.reduce((sum, t) => sum + t.toolsTime, 0);
      const avgIterationTime = iterationTimings.length > 0 
        ? iterationTimings.reduce((sum, t) => sum + t.totalTime, 0) / iterationTimings.length 
        : 0;
      const avgModelTime = iterationTimings.length > 0 
        ? iterationTimings.reduce((sum, t) => sum + t.modelTime, 0) / iterationTimings.length 
        : 0;
      const avgToolsTime = iterationTimings.length > 0 
        ? iterationTimings.reduce((sum, t) => sum + t.toolsTime, 0) / iterationTimings.length 
        : 0;

      console.log(`[coding_agent] ⏱️  ===== TIMING SUMMARY =====`);
      console.log(`[coding_agent] ⏱️  Total node execution time: ${nodeTotalTime}ms`);
      console.log(`[coding_agent] ⏱️  Setup time (bind tools + build messages): ${bindToolsTime + buildMessagesTime}ms`);
      console.log(`[coding_agent] ⏱️  Total iterations: ${iterationCount}`);
      console.log(`[coding_agent] ⏱️  Total tool calls: ${intermediateSteps.length}`);
      console.log(`[coding_agent] ⏱️  Total model invocation time: ${totalModelTime}ms (${(totalModelTime / nodeTotalTime * 100).toFixed(1)}%)`);
      console.log(`[coding_agent] ⏱️  Total tools execution time: ${totalToolsTime}ms (${(totalToolsTime / nodeTotalTime * 100).toFixed(1)}%)`);
      console.log(`[coding_agent] ⏱️  Average iteration time: ${avgIterationTime.toFixed(0)}ms`);
      console.log(`[coding_agent] ⏱️  Average model time per iteration: ${avgModelTime.toFixed(0)}ms`);
      console.log(`[coding_agent] ⏱️  Average tools time per iteration: ${avgToolsTime.toFixed(0)}ms`);
      if (iterationTimings.length > 0) {
        const slowestIteration = iterationTimings.reduce((max, t) => t.totalTime > max.totalTime ? t : max);
        const fastestIteration = iterationTimings.reduce((min, t) => t.totalTime < min.totalTime ? t : min);
        console.log(`[coding_agent] ⏱️  Slowest iteration: #${slowestIteration.iteration} (${slowestIteration.totalTime}ms, model: ${slowestIteration.modelTime}ms, tools: ${slowestIteration.toolsTime}ms, ${slowestIteration.toolCount} tools)`);
        console.log(`[coding_agent] ⏱️  Fastest iteration: #${fastestIteration.iteration} (${fastestIteration.totalTime}ms, model: ${fastestIteration.modelTime}ms, tools: ${fastestIteration.toolsTime}ms, ${fastestIteration.toolCount} tools)`);
      }
      console.log(`[coding_agent] ⏱️  ===========================`);
      console.log(`[coding_agent] Agent completed. Total iterations: ${iterationCount}, Tool calls: ${intermediateSteps.length}`);

    } catch (error) {
      console.error(`[coding_agent] Error in agent loop:`, error);
      
      // Check if this is an OpenAI API error
      let errorMessage: string;
      let isApiError = false;
      
      if (error && typeof error === 'object' && 'status' in error) {
        const apiError = error as any;
        isApiError = true;
        
        // Check for specific error types
        if (apiError.status === 500 || apiError.status === 503) {
          errorMessage = 'OpenAI API server error: The service is temporarily unavailable. This is usually a transient issue. Please try again in a few moments.';
        } else if (apiError.status === 429) {
          errorMessage = 'OpenAI API rate limit exceeded: Too many requests. Please wait a moment before trying again.';
        } else if (apiError.status === 401) {
          errorMessage = 'OpenAI API authentication error: Invalid API key. Please check your OPENAI_API_KEY environment variable.';
        } else if (apiError.status === 400) {
          errorMessage = `OpenAI API request error: ${apiError.message || 'Invalid request format'}`;
        } else {
          errorMessage = `OpenAI API error (${apiError.status}): ${apiError.message || 'Unknown error'}`;
        }
        
        // Log additional details for debugging
        console.error(`[coding_agent] API Error Details:`, {
          status: apiError.status,
          type: apiError.type,
          code: apiError.code,
          request_id: apiError.request_id,
          attemptNumber: apiError.attemptNumber,
          retriesLeft: apiError.retriesLeft,
        });
      } else {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      
      return {
        messages: [
          ...state.messages,
          new AIMessage(`Error: ${errorMessage}${isApiError ? ' You can try submitting your request again.' : ''}`),
        ],
        metadata: {
          ...state.metadata,
          lastModified: Date.now(),
          error: errorMessage,
          isApiError,
        },
      };
    }

    // Update metadata with file operations
    const metadata = {
      ...state.metadata,
      fileOperations: [
        ...(state.metadata?.fileOperations || []),
        ...intermediateSteps.map(step => ({
          type: step.action.tool === 'write_file' ? 'write' as const : 'read' as const,
          path: step.action.toolInput?.filePath || step.action.toolInput?.dirPath || 'unknown',
          timestamp: Date.now(),
        })),
      ],
      lastModified: Date.now(),
    };

    return {
      messages: [
        ...state.messages,
        finalResponse,
      ],
      metadata,
    };
  };

  // API handler agent node - handles API calls from session apps
  const apiHandlerAgentNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const apiContext = state.apiContext;
    
    if (!apiContext) {
      return {
        messages: [
          ...state.messages,
          new AIMessage('No API context provided'),
        ],
      };
    }

    // Handle different API call types
    const { type, route, params } = apiContext;
    
    // For now, this agent can read/write to state and perform operations
    // You can extend this to handle specific routes and operations
    let response: any = {
      success: true,
      message: 'API call processed',
      type,
      route,
      params,
    };

    // Example: Handle GET requests to read state
    if (type === 'GET') {
      if (route === '/state') {
        response = {
          success: true,
          data: {
            messages: state.messages.map(msg => ({
              type: msg.constructor.name,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            })),
            metadata: state.metadata,
          },
        };
      }
    }

    // Example: Handle POST requests to update state
    if (type === 'POST') {
      if (route === '/state') {
        // Update state based on params
        response = {
          success: true,
          message: 'State updated',
        };
      }
    }

    return {
      messages: [
        ...state.messages,
        new AIMessage(JSON.stringify(response)),
      ],
      apiContext: {
        ...apiContext,
        response,
      },
    };
  };

  // Build the graph with proper type-safe reducers
  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: {
        reducer: (x: BaseMessage[] = [], y: BaseMessage[] = []) => [...x, ...y],
        default: () => [],
      },
      sessionId: {
        reducer: (x: string = sessionId, y?: string) => y || x,
        default: () => sessionId,
      },
      metadata: {
        reducer: (
          x: AgentState['metadata'] = {},
          y: AgentState['metadata'] = {}
        ) => ({ ...x, ...y }),
        default: () => ({}),
      },
      apiContext: {
        reducer: (
          x: AgentState['apiContext'] = {},
          y: AgentState['apiContext'] = {}
        ) => ({ ...x, ...y }),
        default: () => ({}),
      },
    },
  })
    .addNode('coding_agent', codingAgentNode)
    .addNode('api_handler_agent', apiHandlerAgentNode)
    .addConditionalEdges(START, routeInput, {
      coding_agent: 'coding_agent',
      api_handler_agent: 'api_handler_agent',
    })
    .addEdge('coding_agent', END)
    .addEdge('api_handler_agent', END);

  // Compile with checkpointing - thread_id will be the sessionId
  return workflow.compile({ checkpointer: checkpointMemory });
}
