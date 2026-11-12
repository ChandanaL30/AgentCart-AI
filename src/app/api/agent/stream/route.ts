import { NextRequest } from "next/server";
import { AgentOrchestrator } from "@/lib/agent/orchestrator";
import { agentRunsStore } from "@/lib/agent/runs-store";
import { getOrCreateSessionToken } from "@/lib/session";
import { AgentActivityEvent, ShoppingConstraintsSchema } from "@/lib/types/agent";

/**
 * GET /api/agent/stream
 * Server-Sent Events (SSE) stream for real-time agent execution and event reconnection.
 *
 * Supports two modes:
 * 1. Reconnection Mode: Pass ?runId=<id>&lastSequence=<n> (or Last-Event-ID header) to replay
 *    persisted events and subscribe to active events with session ownership verification.
 * 2. Execution Mode: Pass ?query=<search> and constraint params to launch a run and stream events live.
 */
export async function GET(request: NextRequest) {
  const session = await getOrCreateSessionToken();
  const searchParams = request.nextUrl.searchParams;
  const existingRunId = searchParams.get("runId");

  const encoder = new TextEncoder();

  function formatSseEvent(event: AgentActivityEvent): string {
    return `id: ${event.sequence}\nevent: agent-event\ndata: ${JSON.stringify(event)}\n\n`;
  }

  // --------------------------------------------------------------------------
  // Mode 1: Reconnection to Existing Run
  // --------------------------------------------------------------------------
  if (existingRunId) {
    const run = agentRunsStore.getRun(existingRunId);
    if (!run) {
      return new Response(JSON.stringify({ error: `Run "${existingRunId}" not found.` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Strict session ownership verification
    if (run.guestSessionTokenHash !== session.tokenHash) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Run belongs to a different session." }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const lastEventIdHeader = request.headers.get("last-event-id");
    const lastSequenceParam = searchParams.get("lastSequence");
    const lastSequence = parseInt(lastEventIdHeader || lastSequenceParam || "0", 10);

    const stream = new ReadableStream({
      start(controller) {
        // Replay missed events
        const missedEvents = agentRunsStore.getEventsAfterSequence(existingRunId, lastSequence);
        for (const evt of missedEvents) {
          controller.enqueue(encoder.encode(formatSseEvent(evt)));
        }

        // If run is already completed or failed, close stream
        if (run.status === "COMPLETED" || run.status === "FAILED") {
          controller.close();
          return;
        }

        // Subscribe to live future events
        const unsubscribe = agentRunsStore.subscribeToRun(existingRunId, (evt) => {
          try {
            controller.enqueue(encoder.encode(formatSseEvent(evt)));
            if (evt.stage === "READY_FOR_REVIEW" || evt.eventType === "ERROR") {
              unsubscribe();
              controller.close();
            }
          } catch {
            unsubscribe();
          }
        });

        // Clean up on client abort
        request.signal.addEventListener("abort", () => {
          unsubscribe();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // --------------------------------------------------------------------------
  // Mode 2: Direct Execution Stream
  // --------------------------------------------------------------------------
  const query = searchParams.get("query") || "wireless headphones under $150";
  const maxBudget = parseFloat(searchParams.get("maxBudget") || "200");
  const maxDeliveryDays = parseInt(searchParams.get("maxDeliveryDays") || "5", 10);
  const minRating = parseFloat(searchParams.get("minRating") || "4.0");
  const preferredBrand = searchParams.get("preferredBrand") || "";
  const optimizationPreference = (searchParams.get("optimizationPreference") || "BEST_VALUE") as
    | "BEST_VALUE"
    | "LOWEST_PRICE"
    | "PREFERRED_BRAND";

  const constraintsParsed = ShoppingConstraintsSchema.safeParse({
    maxBudget,
    maxDeliveryDays,
    minRating,
    preferredBrand: preferredBrand || undefined,
    optimizationPreference,
  });

  const constraints = constraintsParsed.success
    ? constraintsParsed.data
    : {
        maxBudget: 200,
        maxDeliveryDays: 5,
        minRating: 4.0,
        preferredBrand: undefined,
        optimizationPreference: "BEST_VALUE" as const,
      };

  const runId = `run_stream_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      const safeClose = () => {
        if (!isClosed) {
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Controller may already be closed
          }
        }
      };

      request.signal.addEventListener("abort", () => {
        safeClose();
      });

      try {
        await AgentOrchestrator.execute({
          query,
          constraints,
          runId,
          guestSessionTokenHash: session.tokenHash,
          onEvent: (event) => {
            if (!isClosed) {
              controller.enqueue(encoder.encode(formatSseEvent(event)));
            }
          },
        });
        safeClose();
      } catch (err) {
        if (!isClosed) {
          const errorEvent: AgentActivityEvent = {
            id: `evt_err_${Date.now()}`,
            runId,
            sequence: 999,
            stage: "ERROR",
            eventType: "ERROR",
            message: err instanceof Error ? err.message : "Stream processing error",
            createdAt: new Date().toISOString(),
          };
          controller.enqueue(encoder.encode(formatSseEvent(errorEvent)));
        }
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
