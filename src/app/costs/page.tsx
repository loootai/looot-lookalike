import type { Metadata } from "next";
import { BudgetForm } from "@/components/BudgetForm";
import { BudgetPanel } from "@/components/BudgetPanel";
import { requireAdminPage } from "@/lib/auth/guard";
import { IS_DEMO } from "@/lib/clock";
import { MICROS, usd } from "@/lib/money";
import { budgetStatus, capMicros, getSession } from "@/lib/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Costs and budget" };

export default async function CostsPage() {
  await requireAdminPage();
  const [status, session] = await Promise.all([budgetStatus(), getSession()]);
  return (
    <div className="grid max-w-4xl grid-cols-1 gap-6">
      <div>
        <h1 className="text-20 font-medium tracking-tight">Costs and budget</h1>
        <p className="mt-1 max-w-3xl text-13 text-mute">
          Every step is held to a cap per step ({usd(capMicros())}, set on the server), then to a daily and a monthly budget. Each call reserves its list price first and settles to the real cost.
          {session ? ` This session has spent ${usd(session.spentMicros)}.` : ""}
        </p>
      </div>
      <BudgetPanel status={status} />
      <BudgetForm key={`${status.limits.dailyMicros}:${status.limits.monthlyMicros}`} dailyUsd={status.limits.dailyMicros / MICROS} monthlyUsd={status.limits.monthlyMicros / MICROS} disabled={IS_DEMO} />
    </div>
  );
}
