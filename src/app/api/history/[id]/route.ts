import { getAuthSession } from "@/lib/auth-utils";
import { getConversation, deleteConversation } from "@/lib/r2";

// GET /api/history/[id] — Load a specific conversation
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  try {
    const conversation = await getConversation(session.user.id, id);
    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    return Response.json(conversation);
  } catch (err) {
    console.error("[History] Failed to load:", err);
    return Response.json({ error: "Failed to load conversation" }, { status: 500 });
  }
}

// DELETE /api/history/[id] — Delete a conversation
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteConversation(session.user.id, id);
    return Response.json({ success: true });
  } catch (err) {
    console.error("[History] Failed to delete:", err);
    return Response.json({ error: "Failed to delete conversation" }, { status: 500 });
  }
}
