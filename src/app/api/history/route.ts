import { getAuthSession } from "@/lib/auth-utils";
import { getIndex, putConversation, type ConversationData } from "@/lib/r2";

// GET /api/history — List all conversation metadata for the user
export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const index = await getIndex(session.user.id);
    return Response.json(index);
  } catch (err) {
    console.error("[History] Failed to list:", err);
    return Response.json({ error: "Failed to list conversations" }, { status: 500 });
  }
}

// POST /api/history — Save/update a conversation
export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, title, messages, executedMutations } = body;

    if (!id || !messages) {
      return Response.json({ error: "Missing id or messages" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const data: ConversationData = {
      id,
      title: title || "Untitled",
      messages,
      createdAt: body.createdAt || now,
      updatedAt: now,
      messageCount: messages.length,
      executedMutations: executedMutations || undefined,
    };

    await putConversation(session.user.id, data);
    return Response.json({ success: true, id: data.id });
  } catch (err) {
    console.error("[History] Failed to save:", err);
    return Response.json({ error: "Failed to save conversation" }, { status: 500 });
  }
}
