import { NextResponse } from "next/server";
import { getOrCreateSessionToken } from "@/lib/session";

export async function POST() {
  try {
    const session = await getOrCreateSessionToken();
    return NextResponse.json({
      success: true,
      sessionId: session.token.substring(0, 12) + "...",
      isNew: session.isNew,
      expiresInDays: 30,
    });
  } catch (error) {
    console.error("[Session API Error]:", error);
    return NextResponse.json(
      { success: false, error: "Failed to establish guest session" },
      { status: 500 }
    );
  }
}
