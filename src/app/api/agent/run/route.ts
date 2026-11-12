import { NextRequest, NextResponse } from "next/server";
import { AgentOrchestrator } from "@/lib/agent/orchestrator";
import { isDatabaseConfigured, prisma } from "@/lib/db/prisma";
import { getOrCreateSessionToken } from "@/lib/session";
import { StartAgentRunRequestSchema } from "@/lib/types/agent";

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

    // Attempt DB persistence if PostgreSQL is connected
    if (isDatabaseConfigured()) {
      try {
        let dbSession = await prisma.guestSession.findUnique({
        where: { tokenHash: session.tokenHash },
      });
      if (!dbSession) {
        dbSession = await prisma.guestSession.create({
          data: {
            tokenHash: session.tokenHash,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
      }

      const agentRun = await prisma.agentRun.create({
        data: {
          id: runId,
          guestSessionId: dbSession.id,
          query,
          constraints: constraints as object,
          status: result.success ? "COMPLETED" : "FAILED",
          completedAt: new Date(),
        },
      });

      // Save events
      for (const evt of result.events) {
        await prisma.agentEvent.create({
          data: {
            runId: agentRun.id,
            sequence: evt.sequence,
            stage: evt.stage,
            eventType: evt.eventType,
            message: evt.message,
            payload: evt.payload ? (evt.payload as object) : undefined,
          },
        });
      }
    } catch (dbErr) {
      console.warn("[PostgreSQL Persistence Warning]:", dbErr instanceof Error ? dbErr.message : dbErr);
    }
  }

    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (error) {
    console.error("[AgentRun API Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Agent run execution failed",
      },
      { status: 500 }
    );
  }
}
