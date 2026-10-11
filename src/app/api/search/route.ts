import { NextResponse } from "next/server";
import { checkAdmin, denied, requireAdminRoute } from "@/lib/auth/guard";
import { budgetFieldError } from "@/lib/budget";
import { getRanked, runSearch, SpendLimitError } from "@/lib/service";

export const dynamic = "force-dynamic";

/** Admin. Paid (not in demo mode). Needs the session and the CSRF token. Body: { confirmedMaxMicros }. The cap is the server's, and a session has a limit on paid steps. */
export async function POST(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const check = await checkAdmin(req.method, req.headers);
  if (!check.ok) return denied(check);
  const b = (await req.json().catch(() => null)) as { confirmedMaxMicros?: unknown } | null;
  if (typeof b?.confirmedMaxMicros !== "number" || !(b.confirmedMaxMicros > 0)) return NextResponse.json({ error: "confirmedMaxMicros is required." }, { status: 400 });
  const refused = budgetFieldError(b);
  if (refused) return NextResponse.json({ error: refused }, { status: 400 });
  try {
    const r = await runSearch(b.confirmedMaxMicros, check.sid);
    if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.code === "input" ? 422 : r.code === "no_token" ? 503 : 409 });
    return NextResponse.json({ session: r.session, ranked: await getRanked(r.session) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof SpendLimitError ? 429 : 500 });
  }
}
