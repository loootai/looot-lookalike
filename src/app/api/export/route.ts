import { now } from "@/lib/clock";
import { toCsv } from "@/lib/export";
import { getRanked, getSession } from "@/lib/service";

export const dynamic = "force-dynamic";

/** The ranked list as CSV. */
export async function GET() {
  const s = await getSession();
  return new Response(toCsv(await getRanked(s)), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lookalikes-${now().toISOString().slice(0, 10)}.csv"` } });
}
