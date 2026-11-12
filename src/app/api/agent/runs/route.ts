import { NextRequest, NextResponse } from "next/server";
import { AgentOrchestrator } from "@/lib/agent/orchestrator";
import { agentRunsStore } from "@/lib/agent/runs-store";
import { getOrCreateSessionToken } from "@/lib/session";
import { StartAgentRunRequestSchema } from "@/lib/types/agent";

/**
 * GET /api/agent/runs
 * Retrieves all persisted agent runs for the active guest session.
 */
export async function GET() {
  try {
    const session = await getOrCreateSessionToken();
    const runs = agentRunsStore.getRunsForSession(session.tokenHash);

    return NextResponse.json({
      success: true,
      runs,
    });
  } catch (error) {
    console.error("[AgentRuns API Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch session runs",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agent/runs
 * Canonical API endpoint to initiate and execute an agentic shopping run.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = StartAgentRunRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid agent request payload",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { query, constraints } = parsed.data;
    const session = await getOrCreateSessionToken();
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const result = await AgentOrchestrator.execute({
      query,
      constraints,
      runId,
      guestSessionTokenHash: session.tokenHash,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    console.error("[AgentRuns API Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Agent run execution failed",
      },
      { status: 500 }
    );
  }
}
