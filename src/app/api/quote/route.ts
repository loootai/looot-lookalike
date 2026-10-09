import { NextResponse } from "next/server";
import { InputError } from "@/lib/engine";
import { quote } from "@/lib/service";

export const dynamic = "force-dynamic";

/** Free. Body: { step: "seeds" | "search", seeds?: string }. The price of the step right now. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { step?: string; seeds?: string } | null;
  if (b?.step !== "seeds" && b?.step !== "search") return NextResponse.json({ error: "step must be seeds or search." }, { status: 400 });
  try {
    return NextResponse.json(await quote(b.step, b.seeds));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof InputError ? 422 : 500 });
  }
}
