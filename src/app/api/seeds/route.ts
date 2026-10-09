import { NextResponse } from "next/server";
import { getRanked, runSeeds } from "@/lib/service";

export const dynamic = "force-dynamic";

/** Paid (not in demo mode). Body: { seeds, confirmedMaxMicros }. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { seeds?: unknown; confirmedMaxMicros?: unknown } | null;
  if (typeof b?.seeds !== "string" || typeof b.confirmedMaxMicros !== "number" || !(b.confirmedMaxMicros > 0)) return NextResponse.json({ error: "seeds and confirmedMaxMicros are required." }, { status: 400 });
  try {
    const r = await runSeeds(b.seeds, b.confirmedMaxMicros);
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.code === "input" ? 422 : r.code === "no_token" ? 503 : 409 });
    return NextResponse.json({ session: r.session, ranked: await getRanked(r.session) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
