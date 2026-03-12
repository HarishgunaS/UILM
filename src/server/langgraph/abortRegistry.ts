// Simple registry to store abort signals per session
// This avoids circular dependencies between manager.ts and graph.ts

class AbortRegistry {
  private abortSignals: Map<string, AbortSignal> = new Map();

  set(sessionId: string, signal: AbortSignal): void {
    this.abortSignals.set(sessionId, signal);
  }

  get(sessionId: string): AbortSignal | undefined {
    return this.abortSignals.get(sessionId);
  }

  delete(sessionId: string): void {
    this.abortSignals.delete(sessionId);
  }
}

export default new AbortRegistry();
