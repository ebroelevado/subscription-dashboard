import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { mutationAuditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return Response.json(
        {
          success: false,
          status: "unauthorized",
          code: "UNAUTHORIZED",
          error: "Unauthorized",
          retryable: false,
        },
        { status: 401 }
      );
    }

    const { token } = await req.json();
    if (!token || typeof token !== "string") {
      return Response.json(
        {
          success: false,
          status: "invalid",
          code: "MISSING_TOKEN",
          error: "Missing token",
          retryable: false,
        },
        { status: 400 }
      );
    }

    const auditLog = await db.query.mutationAuditLogs.findFirst({
      where: eq(mutationAuditLogs.token, token),
    });

    if (!auditLog) {
      return Response.json(
        {
          success: false,
          status: "invalid",
          code: "TOKEN_NOT_FOUND",
          error: "Invalid or not found token.",
          retryable: false,
        },
        { status: 404 }
      );
    }

    if (auditLog.userId !== session.user.id) {
      return Response.json(
        {
          success: false,
          status: "forbidden",
          code: "TOKEN_FORBIDDEN",
          error: "Access denied.",
          retryable: false,
        },
        { status: 403 }
      );
    }

    if (auditLog.executedAt) {
      return Response.json({
        success: true,
        status: "executed",
        code: "EXECUTED",
        retryable: false,
        auditLogId: auditLog.id,
        toolName: auditLog.toolName,
      });
    }

    if (new Date() > new Date(auditLog.expiresAt)) {
      return Response.json({
        success: false,
        status: "expired",
        code: "TOKEN_EXPIRED",
        error: "Token has expired. Propose the change again.",
        retryable: false,
      }, { status: 400 });
    }

    return Response.json({
      success: true,
      status: "pending",
      code: "PENDING",
      retryable: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error checking mutation status";
    return Response.json(
      {
        success: false,
        status: "failed_transient",
        code: "STATUS_CHECK_FAILED",
        error: message,
        retryable: true,
      },
      { status: 500 }
    );
  }
}
