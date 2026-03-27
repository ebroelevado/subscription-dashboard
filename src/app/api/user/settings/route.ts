import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { currency, disciplinePenalty, companyName, whatsappSignatureMode } = await req.json();

  const data: Record<string, unknown> = {};

  if (currency) {
    if (!['EUR', 'USD', 'GBP', 'CNY'].includes(currency)) {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }
    data.currency = currency;
  }

  if (typeof disciplinePenalty === 'number') {
    if (!Number.isFinite(disciplinePenalty) || disciplinePenalty < 0 || disciplinePenalty > 5) {
       return NextResponse.json({ error: "Invalid discipline penalty range" }, { status: 400 });
    }
    data.disciplinePenalty = disciplinePenalty;
  }

  if (companyName !== undefined) {
    if (companyName && companyName.length > 100) {
      return NextResponse.json({ error: "Company name too long" }, { status: 400 });
    }
    data.companyName = companyName || null;
  }

  if (whatsappSignatureMode !== undefined) {
    if (!['none', 'name', 'company'].includes(whatsappSignatureMode)) {
      return NextResponse.json({ error: "Invalid WhatsApp signature mode" }, { status: 400 });
    }
    data.whatsappSignatureMode = whatsappSignatureMode;
  }

  try {
    const [user] = await db.update(users).set(data).where(eq(users.id, session.user.id)).returning();

    return NextResponse.json({ 
      ok: true, 
      data: {
        success: true, 
        currency: user.currency,
        disciplinePenalty: user.disciplinePenalty,
        companyName: user.companyName,
        whatsappSignatureMode: user.whatsappSignatureMode
      }
    });
  } catch (error) {
    console.error("Settings update error:", error);
    return NextResponse.json({ 
      ok: false, 
      error: "Failed to update settings" 
    }, { status: 500 });
  }
}
