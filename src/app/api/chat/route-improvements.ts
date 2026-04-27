import { Edit } from '@/lib/ai-assistant/api/error-handler';
import { ErrorType } from '@/lib/ai-assistant/types/error.types';

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          code: "UNAUTHORIZED",
          type: ErrorType.AUTHENTICATION
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const rateLimit = checkRateLimit({
      key: `chat:${session.user.id}`,
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
      return new Response(
        JSON.stringify({
          error: "Too Many Requests",
          code: "RATE_LIMITED",
          type: ErrorType.RATE_LIMIT,
          retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSeconds),
          },
        },
      );
    }

    const json = await req.json();

    // ... rest of the existing code ...

  } catch (err: unknown) {
    const error = err as Error;
    console.error("[Chat API Critical Error]:", error?.message || err);
    console.error("[Chat API Stack]:", error?.stack);

    // Classify error type
    let errorType = ErrorType.UNKNOWN;
    let statusCode = 500;

    if (error instanceof ChatProxyTimeoutError) {
      errorType = ErrorType.TIMEOUT;
      statusCode = 504;
    } else if (error?.message?.includes('network') || error?.message?.includes('fetch')) {
      errorType = ErrorType.NETWORK;
      statusCode = 503;
    } else if (error?.message?.includes('rate limit') || error?.message?.includes('429')) {
      errorType = ErrorType.RATE_LIMIT;
      statusCode = 429;
    }

    return new Response(
      JSON.stringify({
        error: error?.message || "Failed to connect to AI service",
        code: error?.name || "INTERNAL_ERROR",
        type: errorType,
        retryable: statusCode >= 500 || statusCode === 429
      }),
      {
        status: statusCode,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
