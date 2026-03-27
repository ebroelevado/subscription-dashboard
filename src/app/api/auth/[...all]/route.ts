import { auth } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

// Vinext-compatible auth handler for better-auth
// The catch-all route handles all /api/auth/* requests
export async function GET(request: NextRequest) {
  try {
    const response = await auth.handler(request);
    return response;
  } catch (error) {
    console.error("Auth GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const response = await auth.handler(request);
    return response;
  } catch (error) {
    console.error("Auth POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
