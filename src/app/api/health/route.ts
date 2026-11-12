import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { env } from "@/lib/env";

export async function GET() {
  let dbStatus = "disconnected";
  let dbError: string | null = null;

  if (process.env.DATABASE_URL) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = "connected";
    } catch (e: unknown) {
      dbError = e instanceof Error ? e.message : "Database connection failed";
    }
  } else {
    dbStatus = "disconnected";
    dbError = "DATABASE_URL not configured (in-memory demo stores active)";
  }

  const paypalConfigured =
    env.NEXT_PUBLIC_PAYPAL_CLIENT_ID !== "sandbox_paypal_client_id_placeholder" &&
    env.PAYPAL_CLIENT_SECRET !== "sandbox_paypal_client_secret_placeholder";

  const llmStatus = {
    provider: env.LLM_PROVIDER,
    ready:
      env.LLM_PROVIDER === "mock" ||
      (env.LLM_PROVIDER === "openai" && !!env.OPENAI_API_KEY) ||
      (env.LLM_PROVIDER === "gemini" && !!env.GEMINI_API_KEY),
  };

  return NextResponse.json({
    status: "ok",
    app: "AgentCart AI",
    version: "0.1.0",
    mode: env.NODE_ENV,
    database: {
      status: dbStatus,
      engine: "PostgreSQL",
      error: dbError,
    },
    paypal: {
      environment: env.PAYPAL_ENVIRONMENT,
      isConfigured: paypalConfigured,
      clientIdConfigured: env.NEXT_PUBLIC_PAYPAL_CLIENT_ID.length > 0,
    },
    llm: llmStatus,
    timestamp: new Date().toISOString(),
  });
}
