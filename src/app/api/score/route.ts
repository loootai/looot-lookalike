import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRoute } from "@/lib/auth/guard";
import { getRanked, saveTraits } from "@/lib/service";

export const dynamic = "force-dynamic";

const Value = z.object({ value: z.string().trim().min(1).max(60), share: z.number().min(0).max(1) });
const TraitsSchema = z.object({ industries: z.array(Value).max(20), technologies: z.array(Value).max(30), keywords: z.array(Value).max(30), countries: z.array(Value).max(20), size: z.object({ min: z.number().min(0), max: z.number().min(0) }).nullable() });

/** Admin. Free. Body: edited traits. Saves them and scores the candidates again. No looot call. */
export async function POST(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const parsed = TraitsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Traits are not valid." }, { status: 422 });
  const t = parsed.data;
  if (t.size && t.size.min > t.size.max) return NextResponse.json({ error: "Minimum size is above maximum size." }, { status: 422 });
  const session = await saveTraits(t);
  if (!session) return NextResponse.json({ error: "No session yet." }, { status: 409 });
  return NextResponse.json({ ranked: await getRanked(session) });
}
