import prisma from "@/lib/db/prisma";
import {
  AgentActivityEvent,
  PurchaseProposalDto,
  ShoppingConstraints,
} from "@/lib/types/agent";

export interface PersistedAgentRun {
  id: string;
  guestSessionTokenHash: string;
  query: string;
  constraints: ShoppingConstraints;
  status: "INITIALIZING" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  completedAt?: string;
  error?: string;
  proposal?: PurchaseProposalDto;
  noEligibleProducts?: boolean;
  noExactMatch?: boolean;
  suggestedCategory?: string;
  violationBreakdown?: Record<string, number>;
  suggestedAdjustments?: string[];
  explanation?: string;
  closestAlternative?: unknown;
  events: AgentActivityEvent[];
  toolHistory: Array<{
    toolName: string;
    input: Record<string, unknown>;
    outputSummary: string;
    durationMs: number;
  }>;
}

// Global in-memory storage for active runs (preserves state across hot reloads)
declare global {
  var __agentcartRunsStore: Map<string, PersistedAgentRun> | undefined;
  var __agentcartRunListeners: Map<string, Set<(event: AgentActivityEvent) => void>> | undefined;
}

const runsMap: Map<string, PersistedAgentRun> =
  global.__agentcartRunsStore || new Map<string, PersistedAgentRun>();

const runListeners: Map<string, Set<(event: AgentActivityEvent) => void>> =
  global.__agentcartRunListeners || new Map<string, Set<(event: AgentActivityEvent) => void>>();

if (process.env.NODE_ENV !== "production") {
  global.__agentcartRunsStore = runsMap;
  global.__agentcartRunListeners = runListeners;
}

export const agentRunsStore = {
  createRun(params: {
    id: string;
    guestSessionTokenHash: string;
    query: string;
    constraints: ShoppingConstraints;
  }): PersistedAgentRun {
    const run: PersistedAgentRun = {
      id: params.id,
      guestSessionTokenHash: params.guestSessionTokenHash,
      query: params.query,
      constraints: params.constraints,
      status: "RUNNING",
      createdAt: new Date().toISOString(),
      events: [],
      toolHistory: [],
    };
    runsMap.set(run.id, run);

    // Attempt Prisma DB insert if PostgreSQL database URL is configured
    if (process.env.DATABASE_URL) {
      prisma.guestSession
        .findUnique({ where: { tokenHash: params.guestSessionTokenHash } })
        .then(async (dbSession) => {
          if (dbSession) {
            await prisma.agentRun.create({
              data: {
                id: run.id,
                guestSessionId: dbSession.id,
                query: run.query,
                constraints: run.constraints as object,
                status: "PLANNING",
              },
            });
          }
        })
        .catch(() => {});
    }

    return run;
  },

  getOrCreateRun(params: {
    id: string;
    guestSessionTokenHash: string;
    query: string;
    constraints: ShoppingConstraints;
  }): PersistedAgentRun {
    const existing = runsMap.get(params.id);
    if (existing) return existing;
    return this.createRun(params);
  },

  getRun(runId: string): PersistedAgentRun | undefined {
    return runsMap.get(runId);
  },

  get(runId: string): PersistedAgentRun | undefined {
    return runsMap.get(runId);
  },

  getRunsForSession(guestSessionTokenHash: string): PersistedAgentRun[] {
    return Array.from(runsMap.values())
      .filter((r) => r.guestSessionTokenHash === guestSessionTokenHash)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  addEvent(runId: string, event: AgentActivityEvent): void {
    const run = runsMap.get(runId);
    if (run) {
      run.events.push(event);
    }

    // Notify active SSE stream listeners for this run
    const listeners = runListeners.get(runId);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch {
          // Ignore listener delivery errors
        }
      });
    }

    // Attempt Prisma event persistence
    if (process.env.DATABASE_URL) {
      prisma.agentEvent
        .create({
          data: {
            runId,
            sequence: event.sequence,
            stage: event.stage,
            eventType: event.eventType,
            message: event.message,
            payload: event.payload ? (event.payload as object) : undefined,
            createdAt: new Date(event.createdAt),
          },
        })
        .catch(() => {});
    }
  },

  subscribeToRun(
    runId: string,
    callback: (event: AgentActivityEvent) => void
  ): () => void {
    if (!runListeners.has(runId)) {
      runListeners.set(runId, new Set());
    }
    const set = runListeners.get(runId)!;
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        runListeners.delete(runId);
      }
    };
  },

  getEventsAfterSequence(runId: string, lastSequence: number): AgentActivityEvent[] {
    const run = runsMap.get(runId);
    if (!run) return [];
    return run.events.filter((e) => e.sequence > lastSequence);
  },

  recordToolExecution(
    runId: string,
    record: {
      toolName: string;
      input: Record<string, unknown>;
      outputSummary: string;
      durationMs: number;
    }
  ): void {
    const run = runsMap.get(runId);
    if (run) {
      run.toolHistory.push(record);
    }
  },

  completeRun(
    runId: string,
    data: {
      proposal?: PurchaseProposalDto;
      noEligibleProducts?: boolean;
      noExactMatch?: boolean;
      suggestedCategory?: string;
      violationBreakdown?: Record<string, number>;
      suggestedAdjustments?: string[];
      explanation?: string;
      closestAlternative?: unknown;
    }
  ): void {
    const run = runsMap.get(runId);
    if (run) {
      run.status = data.noEligibleProducts ? "FAILED" : "COMPLETED";
      run.completedAt = new Date().toISOString();
      run.proposal = data.proposal;
      run.noEligibleProducts = data.noEligibleProducts;
      run.noExactMatch = data.noExactMatch;
      run.suggestedCategory = data.suggestedCategory;
      run.violationBreakdown = data.violationBreakdown;
      run.suggestedAdjustments = data.suggestedAdjustments;
      run.explanation = data.explanation;
      run.closestAlternative = data.closestAlternative;
    }

    // Attempt Prisma run status update
    if (process.env.DATABASE_URL) {
      prisma.agentRun
        .update({
          where: { id: runId },
          data: {
            status: data.noEligibleProducts ? "FAILED" : "COMPLETED",
            completedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  },

  failRun(runId: string, error: string): void {
    const run = runsMap.get(runId);
    if (run) {
      run.status = "FAILED";
      run.completedAt = new Date().toISOString();
      run.error = error;
    }

    if (process.env.DATABASE_URL) {
      prisma.agentRun
        .update({
          where: { id: runId },
          data: {
            status: "FAILED",
            error,
            completedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  },
};
