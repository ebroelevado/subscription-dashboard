import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Standard JSON success response
 */
export function success<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

/**
 * Standard JSON error response
 */
export function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Wraps an async route handler with try/catch and Zod error formatting
 */
export async function withErrorHandling(
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NextResponse) {
      return err;
    }

    if (err instanceof Response) {
      return NextResponse.json({ ok: false, error: err.statusText || "Request failed" }, { status: err.status || 500 });
    }

    if (err instanceof ZodError) {
      const messages = err.issues.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => `${(e.path as (string | number)[]).join(".")}: ${e.message as string}`
      );
      return error(`Validation error: ${messages.join(", ")}`, 422);
    }

    console.error("[API Error]", err);
    
    let errorMessage = "Unknown error";
    if (err instanceof Error) {
      errorMessage = err.message;
      if (err.name === "NotFoundError" || err.message.includes("No")) {
        return error(errorMessage, 404);
      }
    } else if (typeof err === "string") {
      errorMessage = err;
    } else if (err && typeof err === "object") {
        try {
            errorMessage = JSON.stringify(err, Object.getOwnPropertyNames(err));
        } catch {
            errorMessage = String(err);
        }
    }

    return error(errorMessage, 500);
  }
}
