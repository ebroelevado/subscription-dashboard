import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { currency, disciplinePenalty } = await req.json();

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

  try {
    const user = await (prisma.user as any).update({
      where: { id: session.user.id },
      data,
    });

    return NextResponse.json({ 
      ok: true, 
      data: {
        success: true, 
        currency: user.currency,
        disciplinePenalty: user.disciplinePenalty
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
