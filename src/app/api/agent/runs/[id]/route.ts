import { NextRequest, NextResponse } from "next/server";
import { agentRunsStore } from "@/lib/agent/runs-store";
import { getOrCreateSessionToken } from "@/lib/session";

/**
 * GET /api/agent/runs/[id]
 * Retrieves details, status, and event sequence for a specific agent run.
 * Strictly verifies guest session ownership (returns 403 if unauthorized).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getOrCreateSessionToken();

    const run = agentRunsStore.getRun(id);
    if (!run) {
      return NextResponse.json(
        {
          success: false,
          error: `Agent run "${id}" not found.`,
        },
        { status: 404 }
      );
    }

    // Strict session ownership check
    if (run.guestSessionTokenHash !== session.tokenHash) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Run belongs to a different guest session.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      run,
    });
  } catch (error) {
    console.error("[AgentRun Detail Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load agent run details",
      },
      { status: 500 }
    );
  }
}
