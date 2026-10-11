import { now } from "@/lib/clock";
import { requireAdminRoute } from "@/lib/auth/guard";
import { toCsv } from "@/lib/export";
import { getRanked, getSession } from "@/lib/service";

export const dynamic = "force-dynamic";

/** Admin. The ranked list as CSV. Never cached. */
export async function GET(req: Request) {
  const gate = await requireAdminRoute(req);
  if (gate) return gate;
  const s = await getSession();
  return new Response(toCsv(await getRanked(s)), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lookalikes-${now().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
