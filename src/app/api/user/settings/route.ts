import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { currency, disciplinePenalty, companyName, whatsappSignatureMode } = await req.json();

  const data: any = {};

  if (currency) {
    if (!['EUR', 'USD', 'GBP', 'CNY'].includes(currency)) {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }
    data.currency = currency;
  }

  if (typeof disciplinePenalty === 'number') {
    if (disciplinePenalty < 0 || disciplinePenalty > 5) {
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
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data,
    });

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
