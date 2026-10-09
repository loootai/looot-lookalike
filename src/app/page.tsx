import { Workbench } from "@/components/Workbench";
import { IS_DEMO } from "@/lib/clock";
import { DEMO_SEEDS } from "@/demo/fixtures";
import { getRanked, getSession } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const session = await getSession();
  return <Workbench demo={IS_DEMO} initialSession={session} initialRanked={await getRanked(session)} defaultSeeds={IS_DEMO ? DEMO_SEEDS.map((s) => s.domain).join("\n") : ""} openFirst={p.open === "1"} />;
}
